#!/usr/bin/env node
/**
 * T056 — responsive proof at 375x812 (FR-024).
 *
 * Serves the production build with `vite preview`, opens `/`, `/create` and
 * `/dashboard` in headless Chromium at phone width, and asserts for each:
 *   - no horizontal scrolling: documentElement.scrollWidth <= innerWidth
 *   - no console errors and no uncaught page errors
 * plus, for a DIRECT load of `/dashboard`, that the app shell came back
 * (HTTP 200 + the React root and header actually rendered).
 *
 * Usage:  npm run build && node scripts/responsive-check.mjs
 * Exits non-zero on the first failed assertion.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.RESPONSIVE_CHECK_PORT ?? 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 375, height: 812 };
const ROUTES = ['/', '/create', '/dashboard'];

/**
 * Browser network-resource log lines are NOT page-logic errors: during a
 * static preview there is no local chain (ECONNREFUSED on the anvil RPC)
 * and no wallet-relay credentials (400/403 from external services).
 * Uncaught page exceptions (pageerror) and real console.error calls still
 * fail the check — and the ignored count is printed per route.
 */
const IGNORED_CONSOLE = [/^Failed to load resource/i];

/**
 * The preview child's stdout/stderr are captured (and drained — an unread
 * pipe eventually back-pressures the child) so that a startup timeout can
 * report WHY instead of a bare "did not come up".
 */
const serverOutput = [];

function startPreviewServer() {
  const child = spawn(
    process.execPath,
    [resolve(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: frontendDir, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const capture = (chunk) => {
    serverOutput.push(String(chunk));
    if (serverOutput.length > 400) serverOutput.shift();
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (error) => serverOutput.push(`spawn error: ${error.message}\n`));
  return child;
}

/** Listening TCP sockets, so a bind/address mismatch is visible in the log. */
function listeningSockets() {
  try {
    return execFileSync('ss', ['-ltn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || '(ss: no output)';
  } catch (error) {
    return `(ss failed: ${error.message})`;
  }
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // server not accepting connections yet
    }
    if (Date.now() > deadline) {
      throw new Error(
        `vite preview did not come up at ${BASE_URL}\n` +
          `--- vite preview output ---\n${serverOutput.join('') || '(no output)'}\n` +
          `--- listening TCP sockets ---\n${listeningSockets()}`,
      );
    }
    await delay(250);
  }
}

function collectErrors(page) {
  const errors = [];
  const ignored = { network: 0 };
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) {
      ignored.network += 1;
      return;
    }
    errors.push(`console.error: ${text}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return { errors, ignored };
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
  return condition;
}

async function main() {
  if (!existsSync(resolve(frontendDir, 'dist'))) {
    throw new Error('dist/ missing — run `npm run build` first');
  }

  const server = startPreviewServer();
  const failures = [];
  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });

    try {
      for (const route of ROUTES) {
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        const { errors, ignored } = collectErrors(page);

        const response = await page.goto(`${BASE_URL}${route}`, {
          waitUntil: 'networkidle',
        });

        // direct navigation must return the app shell (SPA fallback)
        assert(
          response?.status() === 200,
          `${route}: expected HTTP 200, got ${response?.status()}`,
          failures,
        );
        const shell = await page.evaluate(() => ({
          rootChildren: document.getElementById('root')?.childElementCount ?? 0,
          header: document.querySelector('header') !== null,
          main: document.querySelector('main') !== null,
        }));
        assert(
          shell.rootChildren > 0 && shell.header && shell.main,
          `${route}: app shell did not render (${JSON.stringify(shell)})`,
          failures,
        );

        // the whole page must fit the 375px viewport — no h-scroll
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        assert(
          layout.scrollWidth <= layout.innerWidth,
          `${route}: horizontal scroll — scrollWidth ${layout.scrollWidth} > innerWidth ${layout.innerWidth}`,
          failures,
        );

        // no console/page errors while loading
        assert(
          errors.length === 0,
          `${route}: ${errors.length} console error(s):\n    ${errors.join('\n    ')}`,
          failures,
        );

        console.log(
          `${route.padEnd(11)} shell ok | scrollWidth ${layout.scrollWidth} <= innerWidth ${layout.innerWidth} | ${errors.length} console errors (${ignored.network} network-resource lines ignored)`,
        );
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill('SIGTERM');
  }

  if (failures.length > 0) {
    console.error(`\nRESPONSIVE CHECK FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nResponsive check PASSED: all routes fit 375x812 with no console errors.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
