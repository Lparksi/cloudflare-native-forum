import { expect, it } from 'vitest';
import { measuredResponse, timingMarker } from '../src/lib/timing';
it('uses one measured duration for the fully consumed SSR body and header', async () => {
  const response = await measuredResponse(
    new Response(`<footer>${timingMarker}</footer>`, {
      headers: { 'Content-Type': 'text/html', 'Content-Length': '10' },
    }),
    10,
    () => 28.4,
  );
  expect(response.headers.get('server-timing')).toBe(
    'app;dur=18.4;desc="SSR body ready"',
  );
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.has('content-length')).toBe(false);
  expect(await response.text()).toContain('Server 18.4ms');
});
it('preserves API status and body', async () => {
  const response = await measuredResponse(
    Response.json({ error: 'forbidden' }, { status: 403 }),
    1,
    () => 2,
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'forbidden' });
});
it('replaces the development footer with Astro source attributes', async () => {
  const response = await measuredResponse(
    new Response(
      '<span data-server-timing data-astro-source-loc="82:34">Server —</span>',
      { headers: { 'Content-Type': 'text/html' } },
    ),
    0,
    () => 5,
  );
  expect(await response.text()).toContain('Server 5.0ms');
});
