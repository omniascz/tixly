/** @type {import('next').NextConfig} */
const nextConfig = {
  // TypeScript strict build errors
  typescript: {
    ignoreBuildErrors: false,
  },
  // ESLint během build
  eslint: {
    ignoreDuringBuilds: false,
  },
  // Experimentální server actions (Next.js 14)
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
};

module.exports = nextConfig;
