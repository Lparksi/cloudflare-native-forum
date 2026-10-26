import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { resolveBuildInfo } from './scripts/build-info.mjs';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
    ...(process.env.FORUM_STATE_PATH
      ? { persistState: { path: process.env.FORUM_STATE_PATH } }
      : {}),
  }),
  integrations: [react()],
  session: false,
  vite: {
    // Hidden maps are local evidence for the license inventory, never uploaded.
    build: { sourcemap: process.env.LICENSE_AUDIT === '1' ? 'hidden' : false },
    plugins: [tailwindcss()],
    define: { __BUILD_INFO__: JSON.stringify(resolveBuildInfo()) },
  },
});
