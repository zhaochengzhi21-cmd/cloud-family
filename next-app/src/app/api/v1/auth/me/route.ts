import { NextRequest } from "next/server";
import { defaultAuthHttpDeps, handleMe } from "@/v1/http/auth/handlers";
import { toAuthHttpRequest, toNextResponse } from "@/v1/http/auth/nextBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const res = await handleMe(toAuthHttpRequest(req), defaultAuthHttpDeps());
  return toNextResponse(res);
}
