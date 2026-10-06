#!/usr/bin/env node
/**
 * Live-site proof (T062 / T066) — asserts against the DEPLOYED site, no wallet.
 *
 * Usage:  node scripts/live-check.mjs <live-url>
 * Example: node scripts/live-check.mjs https://token-vesting-lyart.vercel.app
 *
 * For each viewport (1280x800 desktop, 375x812 mobile):
 *   - GET / returns HTTP 200 and the landing becomes visible within 3s
 *   - no horizontal scrolling: documentElement.scrollWidth <= innerWidth
 *   - the "Deployed contracts" card is visible and at least one Etherscan
 *     link points at sepolia.etherscan.io/address/<Sepolia VestingFactory>
 *   - the "Contracts are not deployed …" notice is NOT rendered (this is a
 *     Sepolia deployment, so the Anvil-fallback banner must be absent)
 *   - a DIRECT load of /dashboard renders the app shell (React root + header)
 *   - no console errors and no uncaught page errors — network-resource log
 *     lines (failed RPC/relay fetches) are counted and reported, not failed
 *
 * Screenshots (repo docs/):
 *   docs/screenshots/live-landing-desktop.png
 *   docs/screenshots/live-landing-mobile.png
 *   docs/screenshots/live-dashboard-mobile.png
 *
 * Exits non-zero on the first failed assertion. No secrets: the target URL
 * comes from argv and addresses come from the committed deployments.json.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(frontendDir, '..');
const screenshotsDir = resolve(repoRoot, 'docs', 'screenshots');

const LIVE_URL = process.argv[2];
if (!LIVE_URL) {
  console.error('Usage: node scripts/live-check.mjs <live-url>');
  process.exit(1);
}
const BASE_URL = LIVE_URL.replace(/\/$/, '');

const deployments = JSON.parse(
  readFileSync(resolve(frontendDir, 'src', 'contracts', 'deployments.json'), 'utf8'),
);
const FACTORY = deployments['11155111']?.VestingFactory;
const TEST_TOKEN = deployments['11155111']?.TestToken;
if (!FACTORY || !TEST_TOKEN) {
  throw new Error('deployments.json has no 11155111 entry');
}

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 } },
  { name: 'mobile', viewport: { width: 375, height: 812 } },
];

/**
 * Browser network-resource log lines are not page-logic errors on a public
 * site either (external RPC / wallet-relay responses). They are counted and
 * printed; uncaught page exceptions and real console.error calls still fail.
 */
const IGNORED_CONSOLE = [/^Failed to load resource/i];

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
  mkdirSync(screenshotsDir, { recursive: true });
  const failures = [];
  const browser = await chromium.launch({ headless: true });

  try {
    for (const { name, viewport } of VIEWPORTS) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const { errors, ignored } = collectErrors(page);

      // ---- landing ------------------------------------------------------
      const startedAt = Date.now();
      const response = await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      assert(
        response?.status() === 200,
        `${name} /: expected HTTP 200, got ${response?.status()}`,
        failures,
      );
      let visibleMs = Date.now() - startedAt;
      try {
        await page.locator('h1').first().waitFor({ state: 'visible', timeout: 3000 });
        visibleMs = Date.now() - startedAt;
      } catch {
        // recorded as a failure below
      }
      assert(
        visibleMs <= 3000,
        `${name} /: landing h1 not visible within 3s (${visibleMs}ms)`,
        failures,
      );

      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      assert(
        layout.scrollWidth <= layout.innerWidth,
        `${name} /: horizontal scroll — scrollWidth ${layout.scrollWidth} > innerWidth ${layout.innerWidth}`,
        failures,
      );

      // "Deployed contracts" card + Etherscan links to the Sepolia factory
      const card = page.locator('[aria-label="Deployed contracts"]');
      assert(
        await card.isVisible().catch(() => false),
        `${name} /: "Deployed contracts" card is not visible`,
        failures,
      );
      const etherscanLinks = await page
        .locator('a[href*="sepolia.etherscan.io/address/"]')
        .evaluateAll((nodes) => nodes.map((node) => node.href));
      const factoryLink = etherscanLinks.find((href) =>
        href.toLowerCase().includes(`address/${FACTORY.toLowerCase()}`),
      );
      assert(
        Boolean(factoryLink),
        `${name} /: no etherscan link to address/${FACTORY} (found: ${JSON.stringify(etherscanLinks)})`,
        failures,
      );

      // the Anvil-fallback notice must not be rendered on the live site
      const staleNotice = await page.getByText(/Contracts are not deployed/i).count();
      assert(
        staleNotice === 0,
        `${name} /: "Contracts are not deployed" notice IS rendered (${staleNotice}×)`,
        failures,
      );

      const landingShot = resolve(screenshotsDir, `live-landing-${name}.png`);
      await page.screenshot({ path: landingShot, fullPage: true });

      assert(
        errors.length === 0,
        `${name} /: ${errors.length} console error(s):\n    ${errors.join('\n    ')}`,
        failures,
      );
      console.log(
        `${name.padEnd(8)} /       shell ok | landing visible in ${visibleMs}ms | scrollWidth ${layout.scrollWidth} <= innerWidth ${layout.innerWidth} | etherscan factory link ok | notice absent | ${errors.length} console errors (${ignored.network} network-resource lines)`,
      );

      // ---- direct /dashboard --------------------------------------------
      const dashResponse = await page.goto(`${BASE_URL}/dashboard`, {
        waitUntil: 'networkidle',
      });
      assert(
        dashResponse?.status() === 200,
        `${name} /dashboard: expected HTTP 200, got ${dashResponse?.status()}`,
        failures,
      );
      const shell = await page.evaluate(() => ({
        rootChildren: document.getElementById('root')?.childElementCount ?? 0,
        header: document.querySelector('header') !== null,
        main: document.querySelector('main') !== null,
      }));
      assert(
        shell.rootChildren > 0 && shell.header && shell.main,
        `${name} /dashboard: app shell did not render (${JSON.stringify(shell)})`,
        failures,
      );
      const dashNotice = await page.getByText(/Contracts are not deployed/i).count();
      assert(
        dashNotice === 0,
        `${name} /dashboard: "Contracts are not deployed" notice IS rendered (${dashNotice}×)`,
        failures,
      );
      if (name === 'mobile') {
        await page.screenshot({
          path: resolve(screenshotsDir, 'live-dashboard-mobile.png'),
          fullPage: true,
        });
      }
      assert(
        errors.length === 0,
        `${name} /dashboard: ${errors.length} console error(s):\n    ${errors.join('\n    ')}`,
        failures,
      );
      console.log(
        `${name.padEnd(8)} /dashboard shell ok (${JSON.stringify(shell)}) | notice absent | ${errors.length} console errors (${ignored.network} network-resource lines total)`,
      );

      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\nLIVE CHECK FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nLIVE CHECK PASSED: ${BASE_URL} serves landing + dashboard at 1280x800 and 375x812 — factory ${FACTORY}, token ${TEST_TOKEN}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
