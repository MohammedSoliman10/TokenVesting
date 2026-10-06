#!/usr/bin/env node
/**
 * Wallet-connect check — proving the RainbowKit connect modal still renders
 * its QR view instead of crashing the whole app.
 *
 * Background: `@rainbow-me/rainbowkit@2.2.11` → `cuer@0.0.3` → `qr`, and
 * `cuer/QrCode` hardcodes `border: 0` in its `encodeQR(...)` call.
 * `qr@0.6.0` introduced `if (border <= 0) throw` and `0.7.2` still has it, so
 * resolving to those versions made RainbowKit throw inside a `useMemo` render
 * pass. React 19 unmounts the whole tree on an uncaught render error, so
 * `#root` collapsed to an empty div and the live site served a BLANK WHITE
 * PAGE to anyone clicking "Rainbow", "WalletConnect" or "MetaMask" — the
 * options people reach for when they have no injected wallet. The lockfile
 * carried that breakage from day one because the e2e suite drives the
 * MetaMask row through a stub provider and never rendered a QR.
 *
 * `qr` is pinned to 0.5.5 in package.json (the last release whose `encodeQR`
 * accepts `border: 0`). This check has two phases:
 *
 *   1. DEPENDENCY — call `cuer/QrCode.create()`, the exact production call,
 *      with `border: 0`. No browser, no credentials, no chain: this is what
 *      CI asserts, and it throws on any `qr` that rejects `border: 0`.
 *
 *   2. BROWSER — click every row of the connect modal and assert the React
 *      tree survives and the QR panel appears. This needs a real
 *      VITE_WALLETCONNECT_PROJECT_ID (without one the relay refuses to
 *      subscribe, so no QR is ever produced), so the QR assertion is skipped
 *      with an explicit note when only the local placeholder is present.
 *
 * Usage:  npm run build && node scripts/wallet-connect-check.mjs
 * Exits non-zero on the first failed assertion.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.WALLET_CONNECT_CHECK_PORT ?? 4175);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 1280, height: 900 };

/** Rows to click in the "Connect a Wallet" modal. */
const WALLET_OPTIONS = ['WalletConnect', 'Rainbow', 'MetaMask'];

/** Placeholder used by src/lib/wagmi.ts when no project id is configured. */
const PLACEHOLDER_PROJECT_ID = 'token-vesting-local-dev';

/** Caused by a missing/invalid project id — not by our own code. */
const IGNORED_CONSOLE = [/^Failed to load resource/i];
const IGNORED_PAGE_ERRORS_WITHOUT_PROJECT_ID = [
  /Connection interrupted while trying to subscribe/i,
];

const serverOutput = [];

/* ------------------------------------------------------------------ *
 * Phase 1 — dependency: the exact call `cuer` makes at render time.
 * ------------------------------------------------------------------ */

function walkToPackage(dir, wantedName) {
  let current = dir;
  const root = parse(current).root;
  while (current !== root) {
    const candidate = join(current, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
        if (pkg.name === wantedName) return { path: candidate, version: pkg.version };
      } catch {
        // unreadable/invalid package.json — keep walking
      }
    }
    current = dirname(current);
  }
  return null;
}

function checkDependency(failures) {
  // Resolve `cuer` the way RainbowKit itself does, then `qr` the way `cuer`
  // does — so the assertion follows the real resolution chain rather than a
  // hard-coded node_modules layout (npm nests qr under cuer).
  const rootReq = createRequire(join(frontendDir, 'package.json'));
  const rainbowkitEntry = rootReq.resolve('@rainbow-me/rainbowkit');
  const rkReq = createRequire(rainbowkitEntry);

  const { create } = rkReq('cuer/QrCode');
  const cuerEntry = rkReq.resolve('cuer/QrCode');
  const qrInfo = walkToPackage(dirname(createRequire(cuerEntry).resolve('qr')), 'qr');
  const version = qrInfo?.version ?? 'unknown';

  let grid = null;
  let threw = null;
  try {
    // A syntactically valid WalletConnect pairing URI — border: 0 is what
    // cuer/QrCode hardcodes, which is precisely what qr >= 0.6.0 rejects.
    const qr = create('wc:0123456789abcdef0123456789abcdef@2?relay-protocol=irn&symKey=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    // create() returns { edgeLength, finderLength, grid, value }
    grid = Array.isArray(qr?.grid) ? qr.grid : qr;
  } catch (error) {
    threw = error;
  }

  if (threw) {
    failures.push(
      `cuer/QrCode.create() threw with qr@${version}: ${threw.message} — pin "qr": "0.5.5" in package.json overrides`,
    );
    console.log(`dependency  qr@${version} | create() THREW: ${threw.message}`);
    return;
  }
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
    failures.push(`cuer/QrCode.create() returned no usable grid (qr@${version})`);
    console.log(`dependency  qr@${version} | create() returned an unusable grid`);
    return;
  }
  console.log(
    `dependency  qr@${version} | create() ok — ${grid.length}x${grid[0].length} grid from border:0`,
  );
}

/* ------------------------------------------------------------------ *
 * Phase 2 — browser: the modal must survive every wallet row.
 * ------------------------------------------------------------------ */

function normalise(value) {
  return (value ?? '').trim().replace(/^["']|["']$/g, '');
}

function readProjectId() {
  // A configured-but-placeholder id is as useless as none: the relay rejects
  // it, so treat it exactly like "not configured".
  const fromEnv = normalise(process.env.VITE_WALLETCONNECT_PROJECT_ID);
  if (fromEnv && fromEnv !== PLACEHOLDER_PROJECT_ID) return fromEnv;
  try {
    const raw = readFileSync(join(frontendDir, '.env.local'), 'utf8');
    const match = raw.match(/^\s*VITE_WALLETCONNECT_PROJECT_ID\s*=\s*(.+?)\s*$/m);
    const fromFile = normalise(match?.[1]);
    if (fromFile && fromFile !== PLACEHOLDER_PROJECT_ID) return fromFile;
  } catch {
    // no .env.local — same situation as CI
  }
  return '';
}

function startPreviewServer() {
  const child = spawn(
    process.execPath,
    // --host 127.0.0.1 pins the bind to IPv4 loopback so it always matches
    // BASE_URL (on the CI runner `localhost` resolves to ::1 first, which made
    // the wait time out — see responsive-check.mjs).
    [
      resolve(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--port',
      String(PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
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

function listeningSockets() {
  try {
    return (
      execFileSync('ss', ['-ltn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() ||
      '(ss: no output)'
    );
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

function collectErrors(page, { hasProjectId }) {
  const errors = [];
  const ignored = { network: 0, relay: 0 };
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
    const text = error.message;
    if (!hasProjectId && IGNORED_PAGE_ERRORS_WITHOUT_PROJECT_ID.some((p) => p.test(text))) {
      // the placeholder project id is rejected by the relay — expected
      ignored.relay += 1;
      return;
    }
    errors.push(`pageerror: ${text}`);
  });
  return { errors, ignored };
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
  return condition;
}

async function openModal(page, option) {
  const connect = page.getByRole('button', { name: /Connect Wallet/i });
  await connect.waitFor({ state: 'visible', timeout: 15_000 });
  await connect.click();

  const row = page.getByRole('button', { name: new RegExp(`^${option}$`, 'i') }).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.click();
}

async function checkBrowser(failures) {
  const hasProjectId = Boolean(readProjectId());
  if (!hasProjectId) {
    console.log(
      '\nnote: no VITE_WALLETCONNECT_PROJECT_ID — the relay will refuse to subscribe, so only\n' +
        '      the crash assertions run (the QR render itself is asserted by phase 1 above).',
    );
  }

  const server = startPreviewServer();
  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });

    try {
      for (const option of WALLET_OPTIONS) {
        const context = await browser.newContext({ viewport: VIEWPORT });
        const page = await context.newPage();
        const { errors, ignored } = collectErrors(page, { hasProjectId });

        await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
        await openModal(page, option);

        // The QR renders asynchronously; a crash happens in that same pass.
        await delay(6_000);

        const state = await page.evaluate(() => {
          const root = document.getElementById('root');
          const dialog = document.querySelector('[role="dialog"]');
          return {
            rootChildren: root?.childElementCount ?? 0,
            rootHtmlLength: root?.innerHTML.length ?? 0,
            dialogPresent: dialog !== null,
            dialogText: (dialog?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          };
        });

        // 1. the tree must survive — this is exactly what the render throw broke
        assert(
          state.rootChildren > 0 && state.rootHtmlLength > 1_000,
          `${option}: React tree unmounted (#root ${state.rootHtmlLength} bytes, ${state.rootChildren} children) — the modal render threw`,
          failures,
        );

        // 2. the modal must still be open
        assert(
          state.dialogPresent,
          `${option}: connect modal disappeared — the app crashed`,
          failures,
        );

        // 3. the QR panel must actually be showing (needs a real project id)
        if (hasProjectId) {
          assert(
            /scan with/i.test(state.dialogText),
            `${option}: QR panel did not render — dialog text: "${state.dialogText.slice(0, 160)}"`,
            failures,
          );
        }

        // 4. nothing threw while rendering
        assert(
          errors.length === 0,
          `${option}: ${errors.length} error(s):\n    ${errors.join('\n    ')}`,
          failures,
        );

        // 5. the specific regression this check exists for
        assert(
          !errors.some((e) => /invalid border/i.test(e)),
          `${option}: "invalid border" regression — qr resolved to a version that rejects border: 0 (pin qr@0.5.5)`,
          failures,
        );

        const qrPanel = hasProjectId ? ' | QR panel ok' : ' | QR skipped (no project id)';
        console.log(
          `${option.padEnd(14)} root ${String(state.rootHtmlLength).padStart(6)}B | modal ok${qrPanel} | ${errors.length} errors (${ignored.network} network, ${ignored.relay} relay lines ignored)`,
        );
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill('SIGTERM');
  }
}

async function main() {
  const failures = [];

  console.log('--- phase 1: dependency (cuer → qr, border: 0) ---');
  try {
    checkDependency(failures);
  } catch (error) {
    failures.push(`could not resolve cuer/qr: ${error.message}`);
    console.log(`dependency  resolution failed: ${error.message}`);
  }

  if (!existsSync(resolve(frontendDir, 'dist'))) {
    failures.push('dist/ missing — run `npm run build` first');
  } else {
    console.log('\n--- phase 2: browser (connect modal) ---');
    try {
      await checkBrowser(failures);
    } catch (error) {
      failures.push(`browser phase failed: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nWALLET CONNECT CHECK FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    '\nWallet connect check PASSED: qr accepts border:0 and every wallet row renders its QR view without crashing.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
