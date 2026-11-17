"use client";

import { useParams } from "next/navigation";
import { FamilyPrintBook } from "@/components/alpha/FamilyPrintBook";

export default function AlphaFamilyPrintPage() {
  const params = useParams();
  return <FamilyPrintBook familyId={String(params.familyId || "")} />;
}
