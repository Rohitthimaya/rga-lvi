import { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const fileId = url.searchParams.get('fileId');
  if (!fileId) {
    return new Response(JSON.stringify({ error: 'Missing fileId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Proxy to server endpoint (we'll add /files/:id/download on the server next if needed).
  // For now, return 501 so the UI can fall back to "no preview" gracefully.
  return new Response(JSON.stringify({ error: 'PDF proxy not implemented yet' }), {
    status: 501,
    headers: { 'content-type': 'application/json' },
  });
}

