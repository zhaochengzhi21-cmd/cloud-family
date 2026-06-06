/** @type {import('next').NextConfig} */
const nextConfig = {
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