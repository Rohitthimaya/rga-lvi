import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // Proxy API calls to Express server
      { source: '/upload', destination: 'http://localhost:3000/upload' },
      { source: '/files', destination: 'http://localhost:3000/files' },
      { source: '/files/:path*', destination: 'http://localhost:3000/files/:path*' },
      { source: '/search', destination: 'http://localhost:3000/search' },
      { source: '/ask', destination: 'http://localhost:3000/ask' },
      { source: '/feedback', destination: 'http://localhost:3000/feedback' },
      { source: '/queries', destination: 'http://localhost:3000/queries' },
      { source: '/health', destination: 'http://localhost:3000/health' }
    ];
  },
};

export default nextConfig;

