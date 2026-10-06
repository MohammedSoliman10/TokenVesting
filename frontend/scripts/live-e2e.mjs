#!/usr/bin/env node
/**
 * Live end-to-end proof with a STUB injected wallet (T066 best effort).
 *
 * Usage (env + argv — no secrets in the repo):
 *   E2E_RPC=<sepolia-rpc> [E2E_PK=<key>] E2E_ADDRESS=<addr> \
 *     node scripts/live-e2e.mjs <live-url> <deployer|owner>
 *
 *   run "deployer": E2E_PK + E2E_ADDRESS=DEPLOYER — connects through the real
 *     RainbowKit modal, tries the faucet (cooldown message also acceptable),
 *     creates a 10 TEST schedule (cliff 3, duration 9, start now) to OWNER and
 *     asserts the pending chip, the "Schedule created" confirmation view with
 *     a schedule id bound to OUR tx hash, and the on-chain receipt status 1
 *     (the create flow's terminal state is the confirmation view — T030 — the
 *     form's "…: Confirmed" chip is replaced in the same React commit); then
 *     asserts the dashboard's stage-3 card.
 *
 *   run "owner": E2E_ADDRESS=OWNER, NO key — eth_sendTransaction must throw;
 *     read-only dashboard assertions over OWNER's schedules.
 *
 * The injected provider (window.ethereum, isMetaMask) answers eth_requestAccounts
 * / eth_accounts with E2E_ADDRESS, eth_chainId 0xaa36a7, switch/add chain null;
 * eth_sendTransaction is forwarded to a Node-side signer (viem privateKeyToAccount
 * + createWalletClient over E2E_RPC) and every other method is proxied to E2E_RPC.
 *
 * Screenshots: docs/screenshots/live-e2e-*.png
 * Exits non-zero on the first failed assertion.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { chromium } from '@playwright/test';

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(frontendDir, '..');
const screenshotsDir = resolve(repoRoot, 'docs', 'screenshots');

const LIVE_URL = (process.argv[2] ?? '').replace(/\/$/, '');
const MODE = process.argv[3] ?? '';
const RPC = process.env.E2E_RPC;
const PK = process.env.E2E_PK;
const ADDRESS = process.env.E2E_ADDRESS;
const OWNER = '0x8E691e5252a61e3f74E4e1e9759b73F27140DB47';
const TEST_TOKEN = '0xaC6a0FC000d2A3aD4d5dD03811BdF100dc18067e';

if (!LIVE_URL || !['deployer', 'owner'].includes(MODE)) {
  console.error('Usage: node scripts/live-e2e.mjs <live-url> <deployer|owner>');
  process.exit(1);
}
if (!RPC) {
  console.error('E2E_RPC is required');
  process.exit(1);
}
if (MODE === 'deployer' && !PK) {
  console.error('E2E_PK is required for the deployer run');
  process.exit(1);
}
if (!ADDRESS) {
  console.error('E2E_ADDRESS is required');
  process.exit(1);
}

const failures = [];
function ok(message) {
  console.log(`  [ok] ${message}`);
}
function check(condition, message) {
  if (condition) {
    ok(message);
  } else {
    failures.push(message);
    console.log(`  [FAIL] ${message}`);
  }
  return condition;
}

// Node-side signer: only exists for runs that provide a key.
const walletClient = PK
  ? createWalletClient({
      account: privateKeyToAccount(PK),
      chain: sepolia,
      transport: http(RPC),
    })
  : null;

async function rpcCall(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
  });
  const json = await response.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error.message}`);
  }
  return json.result;
}

async function main() {
  mkdirSync(screenshotsDir, { recursive: true });
  const consoleErrors = [];
  const sentTxHashList = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // Injected BEFORE any page script so wagmi/RainbowKit see it on load.
    await context.addInitScript(
      ({ address, hasKey }) => {
        const KEY = 'e2e:approved';
        const isApproved = () => {
          try {
            return localStorage.getItem(KEY) === '1';
          } catch {
            return false;
          }
        };
        const provider = {
          isMetaMask: true,
          isBraveWallet: false,
          selectedAddress: address,
          on() {
            return provider;
          },
          off() {
            return provider;
          },
          removeListener() {
            return provider;
          },
          removeAllListeners() {
            return provider;
          },
          async request({ method, params }) {
            const p = params ?? [];
            switch (method) {
              case 'eth_requestAccounts':
                // real MetaMask: accounts appear only AFTER user approval
                try {
                  localStorage.setItem(KEY, '1');
                } catch {
                  /* ignore */
                }
                return [address];
              case 'eth_accounts':
                // [] until approved — this is what blocks wagmi auto-connect
                return isApproved() ? [address] : [];
              case 'eth_chainId':
                return '0xaa36a7'; // 11155111
              case 'net_version':
                return '11155111';
              case 'wallet_switchEthereumChain':
              case 'wallet_addEthereumChain':
                return null;
              case 'wallet_getPermissions':
                return isApproved()
                  ? [
                      {
                        parentCapability: 'eth_accounts',
                        caveats: [{ type: 'restrictReturnedAccounts', value: [address] }],
                      },
                    ]
                  : [];
              case 'eth_sendTransaction':
                if (!hasKey) throw new Error('E2E stub wallet is read-only (no key)');
                return await window.__e2e_sendTx(p[0]);
              default:
                return await window.__e2e_rpc(method, p);
            }
          },
        };
        window.ethereum = provider;
        const info = {
          uuid: '2b049a30-0000-4000-8000-00000000e2e1',
          name: 'MetaMask',
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='8' fill='%23FFE2BF'/%3E%3C/svg%3E",
          rdns: 'io.metamask',
        };
        const announce = () =>
          window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info, provider } }));
        window.addEventListener('eip6963:requestProvider', announce);
        announce();
      },
      { address: ADDRESS, hasKey: Boolean(PK) },
    );

    const page = await context.newPage();

    // Node-side JSON-RPC proxy (avoids browser CORS for every non-wallet method).
    await page.exposeFunction('__e2e_rpc', async (method, params) => {
      try {
        return await rpcCall(method, params);
      } catch (error) {
        return { __e2e_error: String(error?.message ?? error) };
      }
    });

    // Node-side signer for eth_sendTransaction.
    await page.exposeFunction('__e2e_sendTx', async (params) => {
      if (!walletClient) throw new Error('E2E stub wallet is read-only (no key)');
      const hash = await walletClient.sendTransaction({
        to: params.to,
        data: params.data ?? '0x',
        value: params.value ? BigInt(params.value) : 0n,
        gas: params.gas ? BigInt(params.gas) : undefined,
      });
      sentTxHashList.push(hash);
      console.log(`  [tx] eth_sendTransaction -> ${hash}`);
      return hash;
    });

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    console.log(`\n=== live-e2e run "${MODE}" on ${LIVE_URL} as ${ADDRESS} ===`);

    // --- owner run: read-only guard proof ---------------------------------
    if (MODE === 'owner') {
      await page.goto(`${LIVE_URL}/`, { waitUntil: 'domcontentloaded' });
      const guard = await page.evaluate(async () => {
        try {
          await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [{ from: window.ethereum.selectedAddress, to: '0x' + '0'.repeat(40), data: '0x' }],
          });
          return { threw: false, message: '' };
        } catch (error) {
          return { threw: true, message: String(error?.message ?? error) };
        }
      });
      check(guard.threw, `eth_sendTransaction throws without a key (got: ${guard.message})`);
    }

    // --- connect through the real RainbowKit modal ------------------------
    await page.goto(`${LIVE_URL}/`, { waitUntil: 'networkidle' });
    const connectBtn = page.getByRole('button', { name: /Connect Wallet/i });
    await connectBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await connectBtn.click();

    // Approve the injected provider the moment the USER opens the modal —
    // mirrors MetaMask's "approved origin" state (and the MetaMask SDK row
    // reads `selectedAddress` instead of calling eth_requestAccounts, so the
    // approval flag is what lets wagmi's eth_accounts + reconnect see us).
    // On a fresh load before this click eth_accounts returns [] — that is
    // exactly what prevents auto-connect and forces the modal flow below.
    await page.evaluate(() => {
      try {
        localStorage.setItem('e2e:approved', '1');
      } catch {
        /* ignore */
      }
    });

    // RainbowKit modal — pick the injected/MetaMask entry (candidates logged).
    const candidates = [/MetaMask/i, /Browser Wallet/i, /Injected/i];
    let walletOption = null;
    let matchedPattern = null;
    const modalDeadline = Date.now() + 12_000;
    while (!walletOption && Date.now() < modalDeadline) {
      for (const pattern of candidates) {
        const option = page.getByRole('button', { name: pattern }).first();
        if (await option.isVisible().catch(() => false)) {
          walletOption = option;
          matchedPattern = pattern;
          break;
        }
      }
      if (!walletOption) await delay(250);
    }
    check(Boolean(walletOption), 'injected wallet row visible in the RainbowKit modal');
    if (walletOption) {
      console.log(`  [info] modal wallet option matched ${matchedPattern}`);
      await walletOption.click();
    }

    // connected = the header shows the truncated address (0x5b…e7B4)
    const truncated = `${ADDRESS.slice(0, 4)}…${ADDRESS.slice(-4)}`;
    await page.getByText(truncated).first().waitFor({ timeout: 20_000 });
    ok(`wallet connected — header shows ${truncated}`);

    let createdId = null;

    if (MODE === 'deployer') {
      // --- /create --------------------------------------------------------
      await page.goto(`${LIVE_URL}/create`, { waitUntil: 'networkidle' });
      check(
        (await page.locator('#cs-token').inputValue()) === TEST_TOKEN,
        'token field prefilled with the Sepolia TestToken address',
      );

      // faucet (cooldown message also accepted)
      await page.getByRole('button', { name: /Get test tokens/i }).click();
      let faucetOutcome = null;
      const faucetDeadline = Date.now() + 90_000;
      while (Date.now() < faucetDeadline) {
        const alert = await page.getByRole('alert').allTextContents();
        const chip = await page.getByRole('status').allTextContents();
        const failedChip = chip.find((text) => /Test tokens: Failed/i.test(text));
        const confirmedChip = chip.find((text) => /Test tokens: Confirmed/i.test(text));
        if (confirmedChip) {
          faucetOutcome = `confirmed (${confirmedChip.trim()})`;
          break;
        }
        if (failedChip || alert.some((text) => text.trim().length > 0)) {
          faucetOutcome = `not granted — friendly message: ${JSON.stringify([...alert, ...chip].map((t) => t.trim()).filter(Boolean))}`;
          break;
        }
        await delay(500);
      }
      check(Boolean(faucetOutcome), `faucet outcome: ${faucetOutcome ?? 'no outcome within 90s'}`);
      if (faucetOutcome?.startsWith('not granted')) {
        await page.getByRole('button', { name: 'Dismiss' }).click().catch(() => {});
      }

      // fill the schedule form: OWNER, start now, cliff 3, duration 9, 10 TEST
      await page.locator('#cs-beneficiary').fill(OWNER);
      await page.locator('#cs-start-now').check();
      await page.locator('#cs-cliff').fill('3');
      await page.locator('#cs-duration').fill('9');
      await page.locator('#cs-amount').fill('10');

      await page.getByRole('button', { name: 'Create schedule' }).click();

      // pending chip while the tx is in flight
      await page.getByText(/: Pending/).first().waitFor({ timeout: 90_000 });
      ok('pending chip observed after submit ("Create schedule: Pending")');
      await page.screenshot({ path: resolve(screenshotsDir, 'live-e2e-pending-chip.png') });

      // The create flow's terminal success state IS the confirmation view
      // (T030): `created` is only set after `waitForTransactionReceipt`
      // resolves, and setCreated()+onConfirmed() (useCreateSchedule L144-145)
      // batch into the view swap — so a "Create schedule: Confirmed" chip
      // never stays on screen (the approve step has no onConfirmed at all).
      // We therefore (a) record any Confirmed chip that does render, (b) gate
      // "confirmed" on the receipt-derived confirmation view, and (c) assert
      // the on-chain receipt status == 1 for the exact hash the UI signed.
      let sawConfirmedChip = false;
      const heading = page.getByRole('heading', { name: 'Schedule created' });
      const headingDeadline = Date.now() + 150_000;
      while (Date.now() < headingDeadline) {
        if ((await page.getByText(/: Confirmed/).count()) > 0) sawConfirmedChip = true;
        if (await heading.isVisible().catch(() => false)) break;
        await delay(250);
      }
      check(
        await heading.isVisible().catch(() => false),
        '"Schedule created" confirmation view visible (rendered only after the app observed the receipt)',
      );
      console.log(
        `  [info] "…: Confirmed" chip rendered during the flow: ${sawConfirmedChip} ` +
          '(the confirmation view replaces the form chip by design — T030)',
      );

      const idText = await page
        .locator('dt:has-text("Schedule id") + dd')
        .first()
        .textContent()
        .catch(() => null);
      createdId = (idText ?? '').match(/\d+/)?.[0] ?? null;
      check(Boolean(createdId), `confirmation shows a schedule id (${createdId})`);

      // tie the confirmation view to OUR signed tx: link hash == last hash
      const createHash = sentTxHashList.at(-1) ?? null;
      const txHref = await page
        .locator('section a[href*="sepolia.etherscan.io/tx/"]')
        .first()
        .getAttribute('href')
        .catch(() => null);
      check(
        Boolean(txHref) && Boolean(createHash) && txHref.endsWith(createHash),
        `confirmation links OUR creation tx on sepolia.etherscan.io (${txHref ?? 'none'} vs ${createHash ?? 'none'})`,
      );

      // "confirmed" at the source: on-chain receipt for that exact hash
      const receipt = createHash ? await rpcCall('eth_getTransactionReceipt', [createHash]) : null;
      check(
        receipt?.status === '0x1',
        `create tx ${createHash ?? '(none)'} CONFIRMED on-chain: status 1 in block ${
          receipt ? Number(receipt.blockNumber) : '?'
        }`,
      );
      await page.screenshot({ path: resolve(screenshotsDir, 'live-e2e-create-confirmation.png'), fullPage: true });
    }

    // --- dashboard assertions --------------------------------------------
    await page.goto(`${LIVE_URL}/dashboard`, { waitUntil: 'networkidle' });
    const cardLabels = (
      await page.locator('p.label').allTextContents()
    ).map((text) => text.trim()).filter((text) => /^Schedule #\d+$/.test(text));
    console.log(`  [info] dashboard cards: ${JSON.stringify(cardLabels)}`);

    if (MODE === 'deployer') {
      // stage-3 card (id=3 from script/smoke-sepolia.sh) + the new one
      const item = page
        .locator('li')
        .filter({ has: page.locator('p.label').filter({ hasText: /^Schedule #3$/ }) })
        .first();
      const hasStage3 = (await item.count()) > 0;
      check(hasStage3, 'stage-3 card "Schedule #3" present on the DEPLOYER dashboard');
      if (hasStage3) {
        check(
          (await item.getByText(/100 TEST/).count()) > 0,
          'stage-3 card shows 100 TEST total',
        );
        const claim = item.getByRole('button', { name: /Nothing vested yet|Claim/ }).first();
        check(
          (await claim.count()) > 0 && (await claim.textContent()) === 'Nothing vested yet' && (await claim.isDisabled()),
          'stage-3 claim button is disabled with the exact text "Nothing vested yet"',
        );
        const bar = item.locator('[role="progressbar"]').first();
        check((await bar.count()) > 0 && (await bar.getAttribute('aria-valuenow')) === '0', 'progress bar aria-valuenow = 0');
        check((await item.getByText('0% vested').count()) > 0, 'card shows "0% vested"');
        check(
          (await item.locator('[aria-label="Vesting timeline"]').count()) > 0,
          'vesting timeline image present (sibling of the card, same <li>)',
        );
      }
      // the schedule created in THIS run has OWNER as beneficiary — the
      // dashboard is beneficiary-only, so it must NOT show up here (run B
      // asserts it on OWNER's dashboard instead).
      if (createdId) {
        check(
          (await page.locator('p.label').filter({ hasText: new RegExp(`^Schedule #${createdId}$`) }).count()) === 0,
          `schedule #${createdId} (beneficiary OWNER) correctly NOT listed on DEPLOYER's dashboard`,
        );
      }
      await page.screenshot({ path: resolve(screenshotsDir, 'live-e2e-dashboard-deployer.png'), fullPage: true });
    } else {
      // owner: every card must exist with a disabled "Nothing vested yet"
      const claimButtons = page.getByRole('button', { name: 'Nothing vested yet' });
      const claimCount = await claimButtons.count();
      const ids = cardLabels.map((label) => label.replace('Schedule #', ''));
      console.log(`  [info] OWNER schedule ids: ${JSON.stringify(ids)}`);
      check(claimCount >= 1, `OWNER dashboard shows ${claimCount} disabled "Nothing vested yet" claim button(s)`);
      for (let i = 0; i < claimCount; i += 1) {
        check(await claimButtons.nth(i).isDisabled(), `claim button #${i + 1} is disabled`);
      }
      // the stage-3 100 TEST schedule and the 10 TEST one from the deployer run
      const hundred = await page.getByText(/100 TEST/).count();
      const ten = await page.getByText(/10 TEST/).count();
      check(hundred >= 1, `a 100 TEST schedule (stage 3) is listed (${hundred} match(es))`);
      check(ten >= 1, `the 10 TEST schedule from the deployer run is listed (${ten} match(es))`);
      await page.screenshot({ path: resolve(screenshotsDir, 'live-e2e-dashboard-owner.png'), fullPage: true });
    }

    console.log(
      `\n[info] txs sent by signer: ${sentTxHashList.length}; console errors: ${consoleErrors.length}` +
        (consoleErrors.length ? ` -> ${JSON.stringify(consoleErrors.slice(0, 5))}` : ''),
    );
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\nLIVE E2E (${MODE}) FAILED (${failures.length}):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nLIVE E2E (${MODE}) PASSED.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
