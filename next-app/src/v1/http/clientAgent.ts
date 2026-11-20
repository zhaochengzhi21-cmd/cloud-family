/**
 * Optional AI/agent attribution header.
 * Does not replace session auth — only recorded in mutation metadata
 * so humans can see which assistant drafted a fact.
 */

import { NextRequest } from "next/server";

const AGENT_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/**
 * Reads X-Client-Agent. Invalid values are ignored (treated as absent).
 */
export function readClientAgent(req: NextRequest): string | null {
  const raw = req.headers.get("x-client-agent")?.trim() ?? "";
  if (!raw) return null;
  return AGENT_RE.test(raw) ? raw : null;
}
