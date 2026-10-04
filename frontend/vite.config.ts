// Vite + Vitest config — frontend (tasks T011)
// `npm run build` -> vite build; `npm test` -> vitest run (jsdom).
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Tests run against the committed anvil deployment (chain 31337) so
    // `contractAddress(activeChainId, ...)` resolves without a live chain.
    env: { VITE_CHAIN_ID: '31337' },
  },
});
