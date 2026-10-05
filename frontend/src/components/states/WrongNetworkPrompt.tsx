/**
 * T050 — visible "Switch network" prompt shown while the wallet is on the
 * wrong chain (FR-015, T055 "no silent failures"). Renders nothing when the
 * wallet is on the target chain (or reports no chain at all).
 */
import { useEnsureChain } from '../../hooks/useEnsureChain';
import { Button } from '../primitives/Button';

export interface WrongNetworkPromptProps {
  className?: string;
}

export function WrongNetworkPrompt({ className }: WrongNetworkPromptProps) {
  const { isWrongChain, targetChainName, switching, ensureChain } = useEnsureChain();

  if (!isWrongChain) return null;

  return (
    <div
      role="region"
      aria-label="Wrong network"
      className={`press-tile bg-coral p-4 text-sm ${className ?? ''}`}
    >
      <p className="font-medium">
        Wrong network — this app writes to {targetChainName}.
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3"
        busy={switching}
        onClick={() => void ensureChain()}
      >
        Switch to {targetChainName}
      </Button>
    </div>
  );
}
