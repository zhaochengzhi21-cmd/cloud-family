import { Suspense } from "react";
import AlphaLoginPage from "./LoginClient";

export default function Page() {
  return (
    <Suspense
      fallback={
        <p
          className="py-16 text-center text-[color:var(--a-muted)]"
          role="status"
        >
          正在载入…
        </p>
      }
    >
      <AlphaLoginPage />
    </Suspense>
  );
}
