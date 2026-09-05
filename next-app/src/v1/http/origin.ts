/**
 * Shared origin helpers for V1 HTTP mutations.
 */

import { isAllowedOrigin } from "@/v1/http/auth/config";

export {
  getAllowedOrigins,
  isAllowedOrigin,
  noStoreHeaders,
} from "@/v1/http/auth/config";

export function privateNoStoreHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store",
  };
}

export class HttpForbiddenOriginError extends Error {
  constructor() {
    super("FORBIDDEN_ORIGIN");
    this.name = "HttpForbiddenOriginError";
  }
}

export function assertMutationOrigin(origin: string | null): void {
  if (!isAllowedOrigin(origin)) {
    throw new HttpForbiddenOriginError();
  }
}
