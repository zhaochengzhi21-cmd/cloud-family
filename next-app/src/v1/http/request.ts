/**
 * Workspace HTTP request helpers — Content-Type, body size, JSON parse.
 */

import { NextRequest } from "next/server";
import { invalidRequest, unsupportedMedia } from "@/v1/http/errors";

const BODY_MAX = 64 * 1024; // 64KB small JSON only

export async function readJsonBody(
  req: NextRequest
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: ReturnType<typeof invalidRequest> }
> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    return { ok: false, response: unsupportedMedia() };
  }
  if (!ct.includes("application/json")) {
    return { ok: false, response: unsupportedMedia() };
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: invalidRequest() };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, response: invalidRequest() };
  }

  const size = JSON.stringify(raw).length;
  if (size > BODY_MAX) {
    return { ok: false, response: invalidRequest() };
  }

  return { ok: true, value: raw as Record<string, unknown> };
}

/** DELETE may have empty body — ignore. */
export async function readOptionalJsonBody(
  req: NextRequest
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: ReturnType<typeof invalidRequest> }
> {
  const ct = req.headers.get("content-type");
  if (!ct || !ct.includes("application/json")) {
    return { ok: true, value: {} };
  }
  return readJsonBody(req);
}
