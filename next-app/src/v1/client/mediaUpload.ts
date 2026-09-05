/**
 * Thin browser helper for V1 private media direct upload.
 * No UI — reserve → @vercel/blob/client.upload → poll status.
 */

import { upload } from "@vercel/blob/client";
import {
  MEDIA_MULTIPART_THRESHOLD_BYTES,
} from "@/v1/domain/media/types";

export type ReserveUploadResponse = {
  media: {
    id: string;
    status: "PENDING_UPLOAD";
    mimeType: string;
    byteSize: number;
    visibility: string;
  };
  upload: {
    pathname: string;
    handleUploadUrl: string;
    multipartRecommended: boolean;
  };
};

export type MediaStatusResponse = {
  mediaId: string;
  status: string;
  mimeType?: string | null;
  byteSize?: number | null;
  visibility?: string;
};

export type DirectUploadOptions = {
  familyId: string;
  file: File | Blob;
  mimeType: string;
  byteSize: number;
  originalFilename?: string | null;
  visibility?: "PRIVATE" | "FAMILY" | "PUBLIC";
  /** Absolute origin for Same-Origin + handleUploadUrl (e.g. window.location.origin). */
  origin: string;
  /** Cookie header value including cf_v1_session=... */
  cookie: string;
  /** Poll interval ms after upload() returns. */
  pollMs?: number;
  pollTimeoutMs?: number;
  fetchImpl?: typeof fetch;
};

async function jsonFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/**
 * Full direct-upload flow. File bytes go Browser → Vercel Blob only.
 */
export async function uploadFamilyMediaDirect(
  opts: DirectUploadOptions
): Promise<{ mediaId: string; status: string }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const origin = opts.origin.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie: opts.cookie,
    origin,
  };

  const reserved = await jsonFetch(
    `${origin}/api/v1/families/${opts.familyId}/media/upload-intents`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        originalFilename: opts.originalFilename ?? null,
        mimeType: opts.mimeType,
        byteSize: opts.byteSize,
        visibility: opts.visibility,
      }),
    },
    fetchImpl
  );
  if (reserved.status !== 201) {
    throw new Error(`reserve failed status=${reserved.status}`);
  }
  const reserveBody = reserved.body as ReserveUploadResponse;
  const mediaId = reserveBody.media.id;
  const pathname = reserveBody.upload.pathname;
  const handleUploadUrl = reserveBody.upload.handleUploadUrl.startsWith("http")
    ? reserveBody.upload.handleUploadUrl
    : `${origin}${reserveBody.upload.handleUploadUrl}`;

  const multipart =
    opts.byteSize > MEDIA_MULTIPART_THRESHOLD_BYTES ||
    reserveBody.upload.multipartRecommended;

  await upload(pathname, opts.file, {
    access: "private",
    handleUploadUrl,
    clientPayload: JSON.stringify({ mediaId }),
    contentType: opts.mimeType,
    multipart,
    headers: {
      cookie: opts.cookie,
      // Same-Origin for token issuance
      // (upload() may not forward Origin; callers should ensure browser context)
    },
  });

  const pollMs = opts.pollMs ?? 500;
  const timeout = opts.pollTimeoutMs ?? 60_000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const st = await jsonFetch(
      `${origin}/api/v1/families/${opts.familyId}/media/${mediaId}/status`,
      { method: "GET", headers: { cookie: opts.cookie } },
      fetchImpl
    );
    const body = st.body as MediaStatusResponse;
    if (st.status === 200 && body.status === "ACTIVE") {
      return { mediaId, status: "ACTIVE" };
    }
    if (st.status === 200 && body.status === "FAILED") {
      throw new Error("upload finalized as FAILED");
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("upload status poll timeout");
}
