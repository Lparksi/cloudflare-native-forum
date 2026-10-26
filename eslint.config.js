import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
export default tseslint.config(
  {
    ignores: [
      'src/vendor/webp/codec.js',
      '.cache/**',
      'dist/**',
      '.astro/**',
      '.wrangler/**',
      'node_modules/**',
      'worker-configuration.d.ts',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx,astro}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        Env: 'readonly',
        D1Database: 'readonly',
        ExportedHandler: 'readonly',
      },
    },
  },
);
