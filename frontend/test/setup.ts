// Vitest setup (task T011): jest-dom matchers + Testing Library cleanup.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  // T054: useTxStatus persists a pending tx — never leak it across tests.
  localStorage.clear();
});
