"use client";

import { useParams } from "next/navigation";
import { InviteLanding } from "@/components/alpha/InviteLanding";

export default function AlphaInvitePage() {
  const params = useParams();
  return <InviteLanding token={String(params.token || "")} />;
}
