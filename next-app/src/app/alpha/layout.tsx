import { notFound } from "next/navigation";
import { isV1AlphaUiEnabled } from "@/v1/http/featureGate";
import { AlphaNav } from "@/components/alpha/AlphaNav";

export const dynamic = "force-dynamic";

export default function AlphaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isV1AlphaUiEnabled()) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#faf7f2] via-[#f7f1e8] to-[#efe6d8] text-[#3d2a1f]">
      <AlphaNav />
      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:px-6">
        {children}
      </main>
    </div>
  );
}
