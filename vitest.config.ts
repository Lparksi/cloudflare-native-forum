import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';
export default defineConfig({
  plugins: [
    {
      name: 'test-compiled-wasm',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('/vendor/webp/codec.wasm?module'))
          return `export default await WebAssembly.compile(Uint8Array.from(atob('${readFileSync(id.slice(0, -7)).toString('base64')}'), c=>c.charCodeAt(0)));`;
      },
    },
  ],
  test: {
    include: ['tests/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
