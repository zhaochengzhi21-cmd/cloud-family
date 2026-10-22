import { notFound } from "next/navigation";
import { Noto_Sans_SC, Noto_Serif_SC } from "next/font/google";
import { isV1AlphaUiEnabled } from "@/v1/http/featureGate";
import { AlphaNav } from "@/components/alpha/AlphaNav";
import "@/components/alpha/alpha-theme.css";

const display = Noto_Serif_SC({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-alpha-display",
  display: "swap",
});

const body = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-alpha-body",
  display: "swap",
});

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
    <div
      className={`alpha-shell alpha-font-body ${display.variable} ${body.variable}`}
    >
      <AlphaNav />
      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-5 sm:px-6">
        {children}
      </main>
    </div>
  );
}
