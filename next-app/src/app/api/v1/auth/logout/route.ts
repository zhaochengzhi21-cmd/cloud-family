import { NextRequest } from "next/server";
import { defaultAuthHttpDeps, handleLogout } from "@/v1/http/auth/handlers";
import { toAuthHttpRequest, toNextResponse } from "@/v1/http/auth/nextBridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = await handleLogout(toAuthHttpRequest(req), defaultAuthHttpDeps());
  return toNextResponse(res);
}
