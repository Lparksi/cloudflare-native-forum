import { handle } from '@astrojs/cloudflare/handler';
import { authRoutes } from './auth/handler';
import { api } from './lib/api';
import { measuredResponse } from './lib/timing';

export default {
  async fetch(request, env, ctx) {
    const startedAt = performance.now();
    try {
      const path = new URL(request.url).pathname;
      const response =
        path === '/api/auth' || path.startsWith('/api/auth/')
          ? await authRoutes.fetch(request, env, ctx)
          : path.startsWith('/api/')
            ? await api.fetch(request, env, ctx)
            : await handle(request, env, ctx);
      return await measuredResponse(response, startedAt);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'request_error',
          name: error instanceof Error ? error.name : 'Error',
        }),
      );
      return measuredResponse(
        new Response('服务暂时不可用', {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }),
        startedAt,
      );
    }
  },
} satisfies ExportedHandler<Env>;
