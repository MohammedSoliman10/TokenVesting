/**
 * Create-schedule route (`/create`) — T028 (validated create + approve flow)
 * and T030 (post-creation confirmation view) — User Story 1.
 *
 * FR-018: every FR-003 rule is validated inline by the zod mirror (V1–V6)
 * BEFORE any wallet prompt, and "1 month = 30 days" sits next to both the
 * cliff and the duration inputs. FR-014a: the page also offers the faucet.
 * FR-019: funding is sequenced approve → create by `useCreateSchedule`.
 */
import { useEffect, useState, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { formatUnits, isAddress, parseUnits } from 'viem';
import { useAccount, usePublicClient } from 'wagmi';
import { abiFor, activeChainId, contractAddress, isDeployed } from '../contracts';
import { useCreateSchedule, type CreatedSchedule } from '../hooks/useCreateSchedule';
import type { TxState } from '../hooks/useTxStatus';
import {
  MONTH_CONVENTION_COPY,
  TEST_TOKEN_DECIMALS,
  createScheduleSchema,
  type CreateScheduleContext,
  type CreateScheduleValues,
} from '../lib/schemas';
import { Button } from '../components/primitives/Button';
import { Card } from '../components/primitives/Card';
import { FaucetButton } from '../components/FaucetButton';
import { TxStatus } from '../components/states/TxStatus';

const inputClass =
  'w-full rounded-tile border border-ink/30 bg-canvas px-3 py-2 font-mono text-sm outline-none focus:border-ink';

/** Explorers we can link transactions to (anvil has none → show the hash). */
const EXPLORER_TX_URL: Record<string, string> = {
  '11155111': 'https://sepolia.etherscan.io/tx/',
};

interface FieldProps {
  id: string;
  label: string;
  /** Helper text rendered next to the input and wired via aria-describedby. */
  hint?: string;
  /** Inline validation message — shown before any wallet prompt (FR-018). */
  error?: string;
  children: ReactNode;
}

/** Label + input + hint + inline error. Marked at module scope so inputs never remount. */
function Field({ id, label, hint, error, children }: FieldProps) {
  const input =
    isValidElement(children) && error
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-invalid': true,
        })
      : children;
  return (
    <div className="mt-5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="mt-2">{input}</div>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink/60">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Exact start as sent on chain: 0 for "Start now", else unix seconds. */
function startLabel(start: number): string {
  return start === 0 ? 'Start now (unix 0)' : `${new Date(start * 1000).toLocaleString()} (unix ${start})`;
}

/** T030 — confirmation view: exact parameters + creation record + tx link. */
function Confirmation({
  created,
  symbol,
  onReset,
}: {
  created: CreatedSchedule;
  symbol: string;
  onReset: () => void;
}) {
  const explorer = EXPLORER_TX_URL[String(activeChainId)];
  const rows: Array<[string, string]> = [
    ['Schedule id', created.id !== null ? created.id.toString() : '—'],
    ['Token', created.params.token],
    ['Beneficiary', created.params.beneficiary],
    ['Start', startLabel(created.params.start)],
    ['Cliff', `${created.params.cliffMonths} months`],
    ['Duration', `${created.params.durationMonths} months`],
    ['Amount', `${formatUnits(created.params.amount, TEST_TOKEN_DECIMALS)}${symbol ? ` ${symbol}` : ''}`],
  ];

  return (
    <section>
      <p className="label">Creation record</p>
      <h1 className="mt-3 text-3xl">Schedule created</h1>

      <Card className="mt-6">
        <dl className="text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="flex justify-between gap-4 py-1">
              <dt className="shrink-0 text-ink/60">{term}</dt>
              <dd className="break-all text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm">
          Transaction:{' '}
          {explorer ? (
            <a href={`${explorer}${created.hash}`} className="underline">
              {created.hash}
            </a>
          ) : (
            <code>{created.hash}</code>
          )}
        </p>
      </Card>

      <div className="mt-6">
        <Button type="button" onClick={onReset}>
          Create another
        </Button>
      </div>
    </section>
  );
}

export default function CreateSchedule() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { create, state, isCreating, created, acknowledge, reset } = useCreateSchedule();

  const [walletBalance, setWalletBalance] = useState(0n);
  const [symbol, setSymbol] = useState('');
  // Balance lifecycle: unknown while there is no wallet, while the read is
  // in flight and when it fails — rule V6 is skipped instead of showing a
  // misleading "exceeds your wallet balance" (T052/T053).
  const [balanceKnown, setBalanceKnown] = useState(false);
  const [balanceError, setBalanceError] = useState(false);
  const [balanceRetry, setBalanceRetry] = useState(0);

  const {
    register,
    handleSubmit,
    watch,
    reset: resetForm,
    formState: { errors },
  } = useForm<CreateScheduleValues>({
    defaultValues: {
      token: contractAddress(activeChainId, 'TestToken') ?? '',
      beneficiary: '',
      startMode: 'now',
      startDate: '',
      cliffMonths: '',
      durationMonths: '',
      amount: '',
    },
    // Fresh context every render — validation runs against the balance and
    // "now" as they are at submit time (rules V3 and V6).
    resolver: zodResolver(
      createScheduleSchema({
        nowSeconds: Math.floor(Date.now() / 1000),
        // `undefined` = balance unknown (no wallet / read in flight / failed)
        // → V6 is skipped rather than reporting a bogus balance error.
        walletBalance: balanceKnown ? walletBalance : undefined,
        decimals: TEST_TOKEN_DECIMALS,
      } satisfies CreateScheduleContext),
    ),
  });

  const watchedToken = watch('token');
  const startMode = watch('startMode');

  // V6 needs the grantor's balance of the schedule token, plus its symbol for copy.
  useEffect(() => {
    if (!publicClient || !address || !isAddress(watchedToken)) {
      setWalletBalance(0n);
      setSymbol('');
      setBalanceKnown(false);
      setBalanceError(false);
      return;
    }
    let cancelled = false;
    const erc20 = abiFor('TestToken'); // standard ERC-20 surface (balanceOf/symbol/allowance)
    Promise.all([
      publicClient.readContract({
        abi: erc20,
        address: watchedToken as `0x${string}`,
        functionName: 'balanceOf',
        args: [address],
      }),
      publicClient.readContract({
        abi: erc20,
        address: watchedToken as `0x${string}`,
        functionName: 'symbol',
      }),
    ])
      .then(([balance, tokenSymbol]) => {
        if (cancelled) return;
        setWalletBalance(balance as bigint);
        setSymbol(tokenSymbol as string);
        setBalanceKnown(true);
        setBalanceError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setWalletBalance(0n);
        setSymbol('');
        // The read failed — the balance is UNKNOWN, not zero (T052):
        // the page shows an error with Retry instead of a blank or a lie.
        setBalanceKnown(false);
        setBalanceError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publicClient, address, watchedToken, balanceRetry]);

  const onSubmit = (values: CreateScheduleValues) => {
    // The resolver already proved V1–V6 — nothing below can make the wallet
    // prompt on an invalid form (FR-018).
    const start =
      values.startMode === 'now' ? 0 : Math.floor(new Date(values.startDate).getTime() / 1000);
    void create({
      token: values.token,
      beneficiary: values.beneficiary,
      start,
      cliffMonths: Number(values.cliffMonths),
      durationMonths: Number(values.durationMonths),
      amount: parseUnits(values.amount, TEST_TOKEN_DECIMALS),
    });
  };

  const handleCreateAnother = () => {
    resetForm(); // back to defaultValues — fresh form, fresh store
    reset(); // clear the confirmation view and tx state
  };

  if (created) {
    return <Confirmation created={created} symbol={symbol} onReset={handleCreateAnother} />;
  }

  return (
    <section>
      <p className="label">New schedule</p>
      <h1 className="mt-3 text-3xl">Create a vesting schedule</h1>

      <Card label="Test token" className="mt-6">
        {balanceError ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p role="alert">Could not read your balance.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setBalanceRetry((attempt) => attempt + 1)}
            >
              Retry balance
            </Button>
          </div>
        ) : (
          <p className="text-sm">
            Balance: {formatUnits(walletBalance, TEST_TOKEN_DECIMALS)}
            {symbol ? ` ${symbol}` : ''}
          </p>
        )}
        <div className="mt-3">
          <FaucetButton />
        </div>
      </Card>

      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <Card className="mt-6">
          <Field id="cs-token" label="Token address" error={errors.token?.message}>
            <input
              id="cs-token"
              type="text"
              className={inputClass}
              {...register('token')}
            />
          </Field>

          <Field id="cs-beneficiary" label="Beneficiary address" error={errors.beneficiary?.message}>
            <input
              id="cs-beneficiary"
              type="text"
              placeholder="0x…"
              className={inputClass}
              {...register('beneficiary')}
            />
          </Field>

          <div className="mt-5">
            <fieldset>
              <legend className="label">Start</legend>
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <label htmlFor="cs-start-now" className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    {...register('startMode')}
                    id="cs-start-now"
                    value="now"
                    className="accent-ink"
                  />
                  Start now
                </label>
                <label htmlFor="cs-start-at" className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    {...register('startMode')}
                    id="cs-start-at"
                    value="date"
                    className="accent-ink"
                  />
                  Start at
                </label>
              </div>
            </fieldset>

            {startMode === 'date' ? (
              <Field
                id="cs-start-date"
                label="Start date and time"
                error={errors.startDate?.message}
              >
                <input
                  id="cs-start-date"
                  type="datetime-local"
                  className={inputClass}
                  {...register('startDate')}
                />
              </Field>
            ) : null}
          </div>

          <Field
            id="cs-cliff"
            label="Cliff (months)"
            hint={MONTH_CONVENTION_COPY}
            error={errors.cliffMonths?.message}
          >
            <input
              id="cs-cliff"
              type="number"
              min={0}
              step={3}
              className={inputClass}
              {...register('cliffMonths')}
              aria-describedby="cs-cliff-hint"
            />
          </Field>

          <Field
            id="cs-duration"
            label="Duration (months)"
            hint={MONTH_CONVENTION_COPY}
            error={errors.durationMonths?.message}
          >
            <input
              id="cs-duration"
              type="number"
              min={3}
              step={3}
              className={inputClass}
              {...register('durationMonths')}
              aria-describedby="cs-duration-hint"
            />
          </Field>

          <Field id="cs-amount" label={`Amount${symbol ? ` (${symbol})` : ''}`} error={errors.amount?.message}>
            <input
              id="cs-amount"
              type="text"
              inputMode="decimal"
              className={inputClass}
              {...register('amount')}
            />
          </Field>
        </Card>

        {address ? null : (
          <p className="press-tile mt-6 bg-paper p-4 text-center text-sm font-medium">
            Connect a wallet to create a schedule
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" busy={isCreating} disabled={!address || !isDeployed(activeChainId)}>
            Create schedule
          </Button>
          <TxStatus state={state as TxState} />
          {state.status === 'failed' && state.error ? (
            <p role="alert" className="text-sm">
              {state.error}
            </p>
          ) : null}
          {state.status === 'failed' ? (
            <Button type="button" variant="secondary" onClick={acknowledge}>
              Dismiss
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
