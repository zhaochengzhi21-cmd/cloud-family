import { Suspense } from "react";
import AlphaLoginPage from "./LoginClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-[#8a6a4a]" role="status">
          正在载入…
        </p>
      }
    >
      <AlphaLoginPage />
    </Suspense>
  );
}
