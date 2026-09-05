import { NextRequest, NextResponse } from "next/server";
import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { getV1Db } from "@/db/client";
import { isV1AlphaAppEnabled } from "@/v1/http/featureGate";
import {
  requireUserAccessContext,
  HttpUnauthenticatedError,
} from "@/v1/http/authContext";
import {
  assertMutationOrigin,
  HttpForbiddenOriginError,
  privateNoStoreHeaders,
} from "@/v1/http/origin";
import {
  mapDomainErrorToResponse,
  notFound,
  unauthenticated,
} from "@/v1/http/errors";
import {
  authorizeClientUploadToken,
  finalizeClientUpload,
} from "@/v1/services/mediaService";
import { getObjectStorage } from "@/v1/storage/objectStorage";
import { isMediaDomainError } from "@/v1/domain/media/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicBaseUrl(req: NextRequest): string {
  const env =
    process.env.VERCEL_BLOB_CALLBACK_URL?.trim() ||
    process.env.V1_PUBLIC_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const host =
    req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/**
 * POST /api/v1/media/client-upload
 *
 * Handles:
 * 1) blob.generate-client-token — App Gate + Session + Same-Origin required
 * 2) blob.upload-completed — Vercel server callback; Gate may be OFF; verified via handleUpload()
 *
 * Never reads user file bytes from the request body.
 */
export async function POST(req: NextRequest) {
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json(
      { success: false, code: "INVALID_REQUEST" },
      { status: 400, headers: privateNoStoreHeaders() }
    );
  }

  const isToken = body?.type === "blob.generate-client-token";
  const isCompleted = body?.type === "blob.upload-completed";

  if (!isToken && !isCompleted) {
    return NextResponse.json(
      { success: false, code: "INVALID_REQUEST" },
      { status: 400, headers: privateNoStoreHeaders() }
    );
  }

  // Token issuance: fail closed on App Gate + Origin + Session
  if (isToken) {
    if (!isV1AlphaAppEnabled()) return notFound();
    try {
      assertMutationOrigin(req.headers.get("origin"));
    } catch (e) {
      if (e instanceof HttpForbiddenOriginError) {
        return mapDomainErrorToResponse(e);
      }
      throw e;
    }
  }

  const db = getV1Db();
  let actorContext: Awaited<
    ReturnType<typeof requireUserAccessContext>
  > | null = null;

  if (isToken) {
    try {
      actorContext = await requireUserAccessContext(req.headers.get("cookie"), {
        db,
      });
    } catch (e) {
      if (e instanceof HttpUnauthenticatedError) {
        return unauthenticated();
      }
      throw e;
    }
  }

  const callbackUrl = `${publicBaseUrl(req)}/api/v1/media/client-upload`;
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!actorContext) {
          throw new Error("UNAUTHENTICATED");
        }
        let mediaId: string | null = null;
        try {
          const parsed = clientPayload
            ? (JSON.parse(clientPayload) as { mediaId?: string })
            : null;
          mediaId =
            parsed && typeof parsed.mediaId === "string"
              ? parsed.mediaId
              : null;
        } catch {
          mediaId = null;
        }
        if (!mediaId) {
          throw new Error("INVALID_CLIENT_PAYLOAD");
        }

        const constraints = await authorizeClientUploadToken(
          {
            mediaId,
            requestedPathname: pathname,
            actorContext: actorContext.actorContext,
          },
          { db }
        );

        return {
          allowedContentTypes: constraints.allowedContentTypes,
          maximumSizeInBytes: constraints.maximumSizeInBytes,
          validUntil: constraints.validUntil,
          allowOverwrite: false,
          addRandomSuffix: false,
          tokenPayload: constraints.tokenPayload,
          callbackUrl,
          cacheControlMaxAge: 0,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Gate may be OFF — still finalize / cleanup to avoid orphans.
        let mediaId: string | null = null;
        try {
          const parsed = tokenPayload
            ? (JSON.parse(tokenPayload) as { mediaId?: string })
            : null;
          mediaId =
            parsed && typeof parsed.mediaId === "string"
              ? parsed.mediaId
              : null;
        } catch {
          mediaId = null;
        }
        if (!mediaId) {
          try {
            const storage = getObjectStorage();
            await storage.deleteObject(blob.pathname);
          } catch {
            /* best-effort */
          }
          return;
        }

        const storage = getObjectStorage();
        const head = await storage.headObject(blob.pathname);
        const actualByteSize = head?.contentLength ?? -1;
        const contentType = blob.contentType || head?.contentType || "";

        await finalizeClientUpload(
          {
            mediaId,
            pathname: blob.pathname,
            contentType,
            actualByteSize,
          },
          { db, storage }
        );
      },
    });

    return NextResponse.json(jsonResponse, {
      headers: privateNoStoreHeaders(),
    });
  } catch (e) {
    // handleUpload / auth failures — return 400 so webhook can retry when appropriate;
    // auth/gate failures for token issuance should not be 200.
    if (e instanceof HttpUnauthenticatedError) {
      return unauthenticated();
    }
    if (isMediaDomainError(e)) {
      return mapDomainErrorToResponse(e, {
        userId: actorContext?.userId,
        db,
        readPath: true,
      });
    }
    const msg = e instanceof Error ? e.message : "upload handler error";
    if (msg === "UNAUTHENTICATED") return unauthenticated();
    return NextResponse.json(
      { success: false, code: "INVALID_REQUEST" },
      { status: 400, headers: privateNoStoreHeaders() }
    );
  }
}
