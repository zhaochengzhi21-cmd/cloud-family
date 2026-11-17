"use client";

import { useParams } from "next/navigation";
import { PersonProfile } from "@/components/alpha/PersonProfile";

export default function AlphaPersonPage() {
  const params = useParams();
  return (
    <PersonProfile
      familyId={String(params.familyId || "")}
      personId={String(params.personId || "")}
    />
  );
}
