/**
 * Bridge injectable AuthHttpResponse → NextResponse.
 */

import { NextRequest, NextResponse } from "next/server";
import type { AuthHttpRequest, AuthHttpResponse } from "./handlers";

export function toAuthHttpRequest(req: NextRequest): AuthHttpRequest {
  return {
    method: req.method,
    headers: {
      get: (name: string) => req.headers.get(name),
    },
    json: () => req.json(),
  };
}

export function toNextResponse(res: AuthHttpResponse): NextResponse {
  const next = NextResponse.json(res.body, {
    status: res.status,
    headers: res.headers,
  });
  for (const c of res.cookies) {
    next.headers.append("Set-Cookie", c);
  }
  return next;
}
