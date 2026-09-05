"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { FamilyWorkspace } from "@/components/alpha/FamilyWorkspace";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";
import { ERROR_COPY } from "@/v1/ui/copy";
import { userMessageForApiError, v1api, V1ApiError } from "@/v1/client/api";

export default function AlphaFamilyPage() {
  const params = useParams();
  const router = useRouter();
  const familyId = String(params.familyId || "");
  const [role, setRole] = useState<"OWNER" | "ADMIN" | "EDITOR" | "VIEWER">(
    "VIEWER"
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await v1api.listFamilies();
        if (cancelled) return;
        const mine = list.families.find((f) => f.id === familyId);
        if (!mine) {
          setError(ERROR_COPY.notFound);
          setReady(true);
          return;
        }
        setRole(mine.role);
        setReady(true);
      } catch (e) {
        if (handleAuthRedirect(e, router)) return;
        if (e instanceof V1ApiError && e.status === 404) {
          setError(ERROR_COPY.notFound);
        } else {
          setError(userMessageForApiError(e));
        }
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [familyId, router]);

  if (!ready) {
    return (
      <p className="py-12 text-center text-[#8a6a4a]" role="status">
        正在打开家族档案…
      </p>
    );
  }

  if (error) {
    return (
      <p className="py-12 text-center text-[#7a1f1f]" role="alert">
        {error}
      </p>
    );
  }

  return <FamilyWorkspace familyId={familyId} initialRole={role} />;
}
