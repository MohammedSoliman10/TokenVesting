#!/usr/bin/env bash
#
# US2 live smoke test — runs the beneficiary claim flow end-to-end against a
# local anvil node with `cast` (no browser), covering spec acceptance
# scenarios 1, 3 and 5:
#
#   faucet → approve → createSchedule(cliff 3mo, duration 9mo, 900e18)
#   → pre-cliff releasable == 0
#   → warp 90d+1s   → releasable == 300e18 (1 of 3 intervals)
#   → release(id)   → beneficiary +300e18, released == 300e18
#   → warp to end   → releasable == 600e18
#   → release(id)   → beneficiary total +900e18, released == 900e18
#   → release(id)   → reverts NothingToRelease()
#
# Re-runnable: the faucet cooldown falls back to an owner mint, and the
# schedule id is read back from the chain instead of assumed.
#
# Usage:  anvil &  then:  ./script/smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.." # repo root

RPC="${RPC:-http://127.0.0.1:8545}"
# anvil default accounts: #0 = deployer/grantor/TestToken owner, #1 = beneficiary
A0_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
A0="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
BENEFICIARY="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

AMOUNT="900000000000000000000" # 900e18 grant
RELEASE_1="300000000000000000000" # 300e18 — 1 of 3 completed intervals
RELEASE_2="600000000000000000000" # 600e18 — remainder at start + duration
WARP_CLIFF="7776001" # 90 days + 1 second
WARP_END="15552000" # 180 days → start + 270 days total

step() { printf '\n== %s\n' "$*"; }
ok() { printf '   OK  %s\n' "$*"; }
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}
assert_eq() { # actual expected label
  [ "$1" = "$2" ] || fail "$3: expected $2, got $1"
  ok "$3 = $1"
}
# cast appends a human-readable annotation to large uint256 values
# (`300000000000000000000 [3e20]`) — keep only the decimal part.
uint() { cast call "$@" --rpc-url "$RPC" | awk '{print $1}'; }

step "0/8 sanity: anvil on $RPC, chain id 31337, deployments present"
CHAIN="$(cast chain-id --rpc-url "$RPC")" ||
  fail "anvil not reachable at $RPC — start it with: anvil &"
[ "$CHAIN" = "31337" ] || fail "expected chain id 31337, got $CHAIN"
read -r TOKEN FACTORY < <(
  node -e "const d=require('./frontend/src/contracts/deployments.json')['31337'];process.stdout.write(d.TestToken+' '+d.VestingFactory+'\n')"
)
ok "chain 31337; TestToken=$TOKEN; VestingFactory=$FACTORY"

step "1/8 grantor funds with TestToken.faucet() (owner-mint fallback on cooldown)"
if cast send "$TOKEN" "faucet()" --private-key "$A0_KEY" --rpc-url "$RPC" --quiet >/dev/null 2>&1; then
  ok "faucet() minted 1000e18"
else
  ok "faucet() on cooldown (previous run) — falling back to owner mint()"
  cast send "$TOKEN" "mint(address,uint256)" "$A0" "$AMOUNT" \
    --private-key "$A0_KEY" --rpc-url "$RPC" --quiet >/dev/null
  ok "owner mint() topped up +900e18"
fi
BAL="$(uint "$TOKEN" "balanceOf(address)(uint256)" "$A0")"
node -e '
  const [actual, min, label] = process.argv.slice(1);
  if (BigInt(actual) < BigInt(min)) {
    console.error(`FAIL: ${label}: ${actual} < ${min}`); process.exit(1);
  }
  console.log(`   OK  ${label} = ${actual}`);
' "$BAL" "$AMOUNT" "account #0 token balance"

step "2/8 grantor approves the factory for 900e18"
cast send "$TOKEN" "approve(address,uint256)" "$FACTORY" "$AMOUNT" \
  --private-key "$A0_KEY" --rpc-url "$RPC" --quiet >/dev/null
ok "allowance(factory) = $AMOUNT"

step "3/8 createSchedule(token, beneficiary=account#1, start=0→now, cliff=3mo, duration=9mo, 900e18)"
cast send "$FACTORY" "createSchedule(address,address,uint256,uint256,uint256,uint256)" \
  "$TOKEN" "$BENEFICIARY" 0 3 9 "$AMOUNT" \
  --private-key "$A0_KEY" --rpc-url "$RPC" --quiet >/dev/null
IDS="$(cast call "$FACTORY" "getSchedulesByGrantor(address)(uint256[])" "$A0" --rpc-url "$RPC")"
ID="$(printf '%s' "$IDS" | tr -d '[]()' | tr ',' '\n' | tr -d ' ' | tail -n 1)"
[ -n "$ID" ] || fail "could not read back the created schedule id from $IDS"
ok "created schedule id=$ID (grantor ids: $IDS)"

step "4/8 before the cliff: releasableAmount(id) must be 0"
REL="$(uint "$FACTORY" "releasableAmount(uint256)(uint256)" "$ID")"
assert_eq "$REL" "0" "releasable pre-cliff"

step "5/8 warp 90d+1s → releasable must be 300e18 (interval 1 of 3)"
cast rpc evm_increaseTime "$WARP_CLIFF" --rpc-url "$RPC" >/dev/null
cast rpc evm_mine --rpc-url "$RPC" >/dev/null
REL="$(uint "$FACTORY" "releasableAmount(uint256)(uint256)" "$ID")"
assert_eq "$REL" "$RELEASE_1" "releasable after interval 1"

step "6/8 release(id) — permissionless caller, tokens must land with the beneficiary"
BEFORE="$(uint "$TOKEN" "balanceOf(address)(uint256)" "$BENEFICIARY")"
cast send "$FACTORY" "release(uint256)" "$ID" \
  --private-key "$A0_KEY" --rpc-url "$RPC" --quiet >/dev/null
AFTER="$(uint "$TOKEN" "balanceOf(address)(uint256)" "$BENEFICIARY")"
node -e '
  const [before, after, expected, label] = process.argv.slice(1);
  const delta = BigInt(after) - BigInt(before);
  if (delta !== BigInt(expected)) {
    console.error(`FAIL: ${label}: delta ${delta} != ${expected}`); process.exit(1);
  }
  console.log(`   OK  ${label} delta = ${delta}`);
' "$BEFORE" "$AFTER" "$RELEASE_1" "beneficiary balance"
REL="$(uint "$FACTORY" "released(uint256)(uint256)" "$ID")"
assert_eq "$REL" "$RELEASE_1" "released(id)"

step "7/8 warp to start + duration → releasable 600e18; release → beneficiary total 900e18"
cast rpc evm_increaseTime "$WARP_END" --rpc-url "$RPC" >/dev/null
cast rpc evm_mine --rpc-url "$RPC" >/dev/null
REL="$(uint "$FACTORY" "releasableAmount(uint256)(uint256)" "$ID")"
assert_eq "$REL" "$RELEASE_2" "releasable at end"
cast send "$FACTORY" "release(uint256)" "$ID" \
  --private-key "$A0_KEY" --rpc-url "$RPC" --quiet >/dev/null
TOTAL="$(uint "$TOKEN" "balanceOf(address)(uint256)" "$BENEFICIARY")"
node -e '
  const [current, firstRunBaseline, expected, label] = process.argv.slice(1);
  const gained = BigInt(current) - BigInt(firstRunBaseline);
  if (gained !== BigInt(expected)) {
    console.error(`FAIL: ${label}: gained ${gained} != ${expected}`); process.exit(1);
  }
  console.log(`   OK  ${label} = ${gained}`);
' "$TOTAL" "$BEFORE" "$AMOUNT" "beneficiary cumulative claim"
REL="$(uint "$FACTORY" "released(uint256)(uint256)" "$ID")"
assert_eq "$REL" "$AMOUNT" "released(id) total"

step "8/8 a further release must revert NothingToRelease()"
SELECTOR="$(cast sig "NothingToRelease()")"
set +e
OUT="$(cast send "$FACTORY" "release(uint256)" "$ID" --private-key "$A0_KEY" --rpc-url "$RPC" 2>&1)"
RC=$?
set -e
[ "$RC" -ne 0 ] || fail "release() succeeded — expected NothingToRelease revert"
if printf '%s' "$OUT" | grep -q "$SELECTOR" || printf '%s' "$OUT" | grep -qi "NothingToRelease"; then
  ok "release reverted with NothingToRelease ($SELECTOR)"
else
  printf '%s\n' "$OUT" >&2
  fail "revert did not carry NothingToRelease"
fi

printf '\nSMOKE TEST PASSED — schedule id %s fully vested and fully claimed\n' "$ID"
