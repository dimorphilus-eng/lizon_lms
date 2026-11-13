/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const api = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";
    return [{ source: "/backend/:path*", destination: `${api}/:path*` }];
  },
  transpilePackages: ["@lizon/shared"],
};

module.exports = nextConfig;
