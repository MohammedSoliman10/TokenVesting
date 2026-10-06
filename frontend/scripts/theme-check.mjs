#!/usr/bin/env node
/**
 * T060 — theme fidelity proof in real Chromium (docs/design/theme.md).
 *
 * Serves the production build with `vite preview` on its own port and
 * asserts on the landing page:
 *   - h1 visible within 3000ms of navigation
 *   - h1 font-family starts "Space Grotesk", body starts "Inter",
 *     document.fonts.check passes for both
 *   - CSS vars --color-canvas/paper/ink/coral/soft = exact theme values
 *   - primary .press-tile link: 2px border, 12px radius, 100ms transition,
 *     box-shadow rgb(17,17,17) 0px 4px 0px 0px at rest → 0px 6px on hover
 *     → 0px 0px on mouse-down; background soft on hover, coral on mouse-down
 *     (sampled after the 100ms transition settles)
 *   - no dark-mode rule: with prefers-color-scheme: dark emulated the body
 *     stays rgb(255, 255, 255) and no prefers-color-scheme rule exists
 *   - no console/page errors
 * It also prints the transferred JS size and saves screenshots to
 * docs/screenshots/ (landing desktop/mobile, create mobile, dashboard mobile).
 *
 * Usage:  npm run build && node scripts/theme-check.mjs
 * Exits non-zero on the first failed assertion batch.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(frontendDir, '..');
const screenshotsDir = resolve(repoRoot, 'docs', 'screenshots');
const PORT = Number(process.env.THEME_CHECK_PORT ?? 4174);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PRIMARY_TILE = 'main a[href="/create"].press-tile';

/** Same network-resource filter as responsive-check.mjs. */
const IGNORED_CONSOLE = [/^Failed to load resource/i];

const THEME = {
  canvas: '#FFFFFF',
  paper: '#FAF7F2',
  ink: '#111111',
  coral: '#FD9898',
  soft: '#FFE2DB',
  restShadow: 'rgb(17, 17, 17) 0px 4px 0px 0px',
  hoverShadow: 'rgb(17, 17, 17) 0px 6px 0px 0px',
  pressShadow: 'rgb(17, 17, 17) 0px 0px 0px 0px',
  hoverBg: 'rgb(255, 226, 219)', // soft #FFE2DB
  pressBg: 'rgb(253, 152, 152)', // coral #FD9898
};

/** Captured preview-child output (see responsive-check.mjs). */
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
      // not accepting connections yet
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

const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

async function samplePressTile(page) {
  return page.locator(PRIMARY_TILE).evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      borderWidth: style.borderTopWidth,
      radius: style.borderRadius,
      shadow: style.boxShadow,
      bg: style.backgroundColor,
      transitionDuration: style.transitionDuration,
    };
  });
}

async function main() {
  if (!existsSync(resolve(frontendDir, 'dist'))) {
    throw new Error('dist/ missing — run `npm run build` first');
  }
  mkdirSync(screenshotsDir, { recursive: true });

  const server = startPreviewServer();
  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });

    try {
      // ---------------- landing, desktop 1280x800 ----------------
      const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await desktop.newPage();
      const { errors, ignored } = collectErrors(page);

      // h1 visible within 3000ms of navigation
      const navStart = Date.now();
      await page.goto(`${BASE_URL}/`, { waitUntil: 'commit' });
      const remaining = 3000 - (Date.now() - navStart);
      await page.waitForSelector('main h1', { state: 'visible', timeout: Math.max(1, remaining) });
      const h1Elapsed = Date.now() - navStart;
      assert(h1Elapsed <= 3000, `h1 visible after ${h1Elapsed}ms (budget 3000ms)`);
      console.log(`h1 visible after ${h1Elapsed}ms (budget 3000ms)`);

      // fonts (self-hosted @fontsource — loaded by the time check runs)
      await page.waitForFunction(
        () => document.fonts.check('700 16px "Space Grotesk"') && document.fonts.check('400 16px "Inter"'),
        undefined,
        { timeout: 5000 },
      );
      const fonts = await page.evaluate(() => ({
        h1: getComputedStyle(document.querySelector('main h1')).fontFamily,
        body: getComputedStyle(document.body).fontFamily,
        grotesk: document.fonts.check('700 16px "Space Grotesk"'),
        inter: document.fonts.check('400 16px "Inter"'),
      }));
      const strip = (family) => family.replace(/["']/g, '').trim();
      assert(strip(fonts.h1).startsWith('Space Grotesk'), `h1 font-family: ${fonts.h1}`);
      assert(strip(fonts.body).startsWith('Inter'), `body font-family: ${fonts.body}`);
      assert(fonts.grotesk, 'document.fonts.check Space Grotesk failed');
      assert(fonts.inter, 'document.fonts.check Inter failed');
      console.log(`h1 font: ${fonts.h1}`);
      console.log(`body font: ${fonts.body}`);
      console.log(`document.fonts.check: Space Grotesk=${fonts.grotesk} Inter=${fonts.inter}`);

      // exact CSS custom properties (built CSS may ship shorthand hex —
      // #FFFFFF → #FFF — so compare after normalizing case and length)
      const normalizeHex = (value) => {
        const hex = value.trim().toUpperCase().replace(/^#/, '');
        const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
        return `#${full}`;
      };
      const vars = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const get = (name) => style.getPropertyValue(name).trim();
        return {
          canvas: get('--color-canvas'),
          paper: get('--color-paper'),
          ink: get('--color-ink'),
          coral: get('--color-coral'),
          soft: get('--color-soft'),
        };
      });
      for (const name of ['canvas', 'paper', 'ink', 'coral', 'soft']) {
        assert(
          normalizeHex(vars[name]) === THEME[name],
          `--color-${name}: expected ${THEME[name]}, got ${vars[name]}`,
        );
      }
      console.log(`CSS vars: ${JSON.stringify(vars)} (compared as ${JSON.stringify(Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, normalizeHex(v)])))})`);

      // press-tile: rest → hover → mouse-down (sample after 100ms transitions)
      const rest = await samplePressTile(page);
      assert(rest.borderWidth === '2px', `press-tile border: ${rest.borderWidth} (expected 2px)`);
      assert(rest.radius === '12px', `press-tile radius: ${rest.radius} (expected 12px)`);
      assert(rest.shadow === THEME.restShadow, `press-tile rest shadow: ${rest.shadow}`);
      assert(
        rest.transitionDuration.split(',').every((d) => d.trim() === '0.1s'),
        `press-tile transition: ${rest.transitionDuration} (expected 100ms)`,
      );
      console.log(`rest:    shadow=${rest.shadow} bg=${rest.bg} border=${rest.borderWidth} radius=${rest.radius} transition=${rest.transitionDuration}`);

      await page.locator(PRIMARY_TILE).hover();
      await delay(150);
      const hover = await samplePressTile(page);
      assert(hover.shadow === THEME.hoverShadow, `press-tile hover shadow: ${hover.shadow}`);
      assert(hover.bg === THEME.hoverBg, `press-tile hover bg: ${hover.bg} (expected soft ${THEME.hoverBg})`);
      console.log(`hover:   shadow=${hover.shadow} bg=${hover.bg}`);

      await page.mouse.down();
      await delay(150);
      const pressed = await samplePressTile(page);
      assert(pressed.shadow === THEME.pressShadow, `press-tile press shadow: ${pressed.shadow}`);
      assert(pressed.bg === THEME.pressBg, `press-tile press bg: ${pressed.bg} (expected coral ${THEME.pressBg})`);
      console.log(`press:   shadow=${pressed.shadow} bg=${pressed.bg}`);
      await page.mouse.up();

      // dark mode must NOT apply anything (theme.md: no dark mode in v1)
      await page.emulateMedia({ colorScheme: 'dark' });
      const dark = await page.evaluate(() => {
        let hasDarkRule = false;
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.media && rule.media.mediaText.includes('prefers-color-scheme')) hasDarkRule = true;
            }
          } catch {
            // cross-origin sheet — none expected in this build
          }
        }
        return {
          matches: window.matchMedia('(prefers-color-scheme: dark)').matches,
          bodyBg: getComputedStyle(document.body).backgroundColor,
          hasDarkRule,
        };
      });
      assert(dark.matches, 'prefers-color-scheme: dark emulation did not apply');
      assert(!dark.hasDarkRule, 'a prefers-color-scheme media rule exists in the stylesheets');
      assert(dark.bodyBg === 'rgb(255, 255, 255)', `dark mode body bg: ${dark.bodyBg}`);
      console.log(`dark emulation: matchMedia=${dark.matches} bodyBg=${dark.bodyBg} prefers-color-scheme rules=${dark.hasDarkRule}`);
      await page.emulateMedia({ colorScheme: 'light' });

      // transferred JS size
      const js = await page.evaluate(() => {
        const entries = performance.getEntriesByType('resource').filter(
          (entry) => entry.initiatorType === 'script' || entry.name.endsWith('.js'),
        );
        return {
          count: entries.length,
          bytes: entries.reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
        };
      });
      console.log(`transferred JS: ${(js.bytes / 1024).toFixed(1)} kB across ${js.count} files`);

      await page.screenshot({ path: resolve(screenshotsDir, 'landing-desktop.png') });
      assert(errors.length === 0, `landing/desktop: ${errors.length} console error(s):\n    ${errors.join('\n    ')}`);
      console.log(`landing/desktop: ${errors.length} console errors (${ignored.network} network-resource lines ignored)`);
      await desktop.close();

      // ---------------- screenshots at 375x812 ----------------
      const mobileShots = [
        ['/', 'landing-mobile.png'],
        ['/create', 'create-mobile.png'],
        ['/dashboard', 'dashboard-mobile.png'],
      ];
      for (const [route, file] of mobileShots) {
        const mobile = await browser.newContext({ viewport: { width: 375, height: 812 } });
        const mobilePage = await mobile.newPage();
        const mobileErrors = collectErrors(mobilePage);
        const response = await mobilePage.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle' });
        assert(response?.status() === 200, `${route} (mobile): HTTP ${response?.status()}`);
        await mobilePage.evaluate(() => document.fonts.ready);
        await mobilePage.screenshot({ path: resolve(screenshotsDir, file) });
        assert(
          mobileErrors.errors.length === 0,
          `${route} (mobile): ${mobileErrors.errors.length} console error(s):\n    ${mobileErrors.errors.join('\n    ')}`,
        );
        console.log(`screenshot docs/screenshots/${file} | ${route} mobile 375x812 | ${mobileErrors.errors.length} console errors`);
        await mobile.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill('SIGTERM');
  }

  if (failures.length > 0) {
    console.error(`\nTHEME CHECK FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nTheme check PASSED: press-tile states, fonts, tokens and light-only mode match theme.md.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
