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
    plugins: [tailwindcss()],
    define: { __BUILD_INFO__: JSON.stringify(resolveBuildInfo()) },
  },
});
