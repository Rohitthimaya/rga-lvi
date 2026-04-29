import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    // In dev, we proxy to the local Express server.
    // In prod (Vercel), set API_URL to your deployed AICanGrow API origin.
    const rawApi = process.env.API_URL ?? 'http://localhost:3000';
    const api =
      rawApi.startsWith('http://') || rawApi.startsWith('https://')
        ? rawApi
        : `https://${rawApi}`;
    return [
      // Proxy API calls to Express server
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/upload', destination: `${api}/upload` },
      { source: '/files', destination: `${api}/files` },
      { source: '/files/:path*', destination: `${api}/files/:path*` },
      { source: '/search', destination: `${api}/search` },
      { source: '/ask', destination: `${api}/ask` },
      { source: '/feedback', destination: `${api}/feedback` },
      { source: '/queries', destination: `${api}/queries` },
      { source: '/health', destination: `${api}/health` },
    ];
  },
};

export default nextConfig;

