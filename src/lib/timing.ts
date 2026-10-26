export const timingMarker = '<span data-server-timing>Server —</span>';

// Boundary: request entry through full, bounded SSR body consumption.
// Excludes footer substitution, response transmission and network RTT.
export async function measuredResponse(
  response: Response,
  startedAt: number,
  now = () => performance.now(),
) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Cache-Control', 'private, no-store');
  const html = headers.get('content-type')?.includes('text/html');
  const body = html ? await response.text() : null;
  const duration = Math.max(0, now() - startedAt).toFixed(1);
  headers.set('Server-Timing', `app;dur=${duration};desc="SSR body ready"`);
  if (body !== null) {
    headers.delete('content-length');
    headers.delete('etag');
    return new Response(
      body.replace(
        /<span data-server-timing(?:\s[^>]*)?>Server —<\/span>/,
        `<span data-server-timing title="请求入口至 SSR 正文读取完成；不含网络传输">Server ${duration}ms</span>`,
      ),
      { status: response.status, statusText: response.statusText, headers },
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
