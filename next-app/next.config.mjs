/** @type {import('next').NextConfig} */

/**
 * Fail-closed for Production: writes disabled unless LEGACY_WRITES_ENABLED=true.
 * Preview / local: enabled unless LEGACY_WRITES_ENABLED=false.
 */
const vercelEnv = process.env.VERCEL_ENV;
const explicit = process.env.LEGACY_WRITES_ENABLED;
let legacyWritesEnabled;
if (vercelEnv === "production") {
  legacyWritesEnabled = explicit === "true";
} else if (explicit === "false") {
  legacyWritesEnabled = false;
} else {
  legacyWritesEnabled = true;
}

const nextConfig = {
  env: {
    NEXT_PUBLIC_LEGACY_WRITES_ENABLED: legacyWritesEnabled ? "true" : "false",
  },
  eslint: {
    // 忽略 ESLint 错误，避免构建失败
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 忽略 TypeScript 错误
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
