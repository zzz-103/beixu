import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The repository's deploy date can be ahead of the local workerd release.
  // Pin the test runtime to a supported date; deploy keeps wrangler.jsonc's date.
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { compatibilityDate: '2025-01-01' },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    sequence: { concurrent: false },
  },
});
