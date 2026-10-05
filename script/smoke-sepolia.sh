#!/usr/bin/env bash
#
# Sepolia live smoke test (T061 / T066 quickstart) — creation, reads and guards
# against the REAL Sepolia deployment from frontend/src/contracts.
#
# Time cannot be warped on a public chain, so the time-travel scenarios (cliff
# passed, partial/full vesting) live in script/smoke.sh on anvil instead; here
# we prove: mint → approve → createSchedule ×2 → read-back invariants →
# releasable == 0 (pre-cliff) → release() reverts NothingToRelease → funds
# escrowed in the factory.
#
# SECURITY: this script contains NO private keys. Signing goes through the
# Foundry keystore `deployer` (~/.foundry/keystores), unlocked non-interactively
# by ~/.foundry/deployer.pass. The RPC URL comes from the environment and is
# never written anywhere.
#
# Usage:
#   SEPOLIA_RPC_URL=<rpc> ./script/smoke-sepolia.sh
#   FORCE=1 SEPOLIA_RPC_URL=<rpc> ./script/smoke-sepolia.sh   # allow duplicate schedules

set -euo pipefail
cd "$(dirname "$0")/.." # repo root

RPC="${SEPOLIA_RPC_URL:?set SEPOLIA_RPC_URL in the environment (deployment-only RPC; never commit it)}"
PASSFILE="$HOME/.foundry/deployer.pass"
OWNER="0x8E691e5252a61e3f74E4e1e9759b73F27140DB47"
CHAIN_ID_EXPECTED=11155111
AMOUNT_100="100000000000000000000" # 100e18
FACTORY_FLOOR="200000000000000000000" # 200e18
CLIFF_SECONDS=7776000  # 90 days  (3 months)
DURATION_SECONDS=23328000 # 270 days (9 months)

step() { printf '\n=== %s ===\n' "$*"; }
die() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

[ -f "$PASSFILE" ] || die "missing $PASSFILE (keystore password file)"
command -v python3 >/dev/null || die "python3 is required"

# --- addresses (public, committed) ------------------------------------------
TOKEN=$(node -e "process.stdout.write(require('./frontend/src/contracts/deployments.json')['11155111'].TestToken)")
FACTORY=$(node -e "process.stdout.write(require('./frontend/src/contracts/deployments.json')['11155111'].VestingFactory)")
[ -n "$TOKEN" ] && [ -n "$FACTORY" ] || die "deployments.json has no 11155111 entry"
DEPLOYER=$(cast wallet address --account deployer --password-file "$PASSFILE")

send() { # send <address> <sig...> <args...> -> prints "TX <hash>"
  local out json
  out=$(cast send "$@" --account deployer --password-file "$PASSFILE" --rpc-url "$RPC" --json) ||
    die "cast send failed: $*"
  json=$out
  TX=$(python3 -c '
import json,sys
d=json.loads(sys.argv[1])
for k in ("transactionHash","transaction_hash","hash"):
    if d.get(k):
        print(d[k]); break
else:
    print("UNKNOWN")
' "$json")
  echo "TX $TX"
}

call() { cast call "$@" --rpc-url "$RPC"; }

SCHED_SIG="getSchedule(uint256)((address,address,address,uint256,uint256,uint256,uint256,uint256))"

# getSchedule tuple -> one value per line (token grantor beneficiary start
# cliffDuration duration totalAmount released); strips cast's " [1e20]" hints
sched_fields() {
  python3 - "$1" <<'PY'
import re, sys
s = sys.argv[1].strip()
inner = s[1:-1] if s.startswith("(") and s.endswith(")") else s
parts = [p.strip() for p in re.findall(r'"[^"]*"|[^,]+', inner)]
for p in parts:
    p = p.strip().strip('"')
    p = re.sub(r"\s*\[[^\]]*\]$", "", p)  # cast annotation, e.g. " [1e20]"
    print(p)
PY
}

ids_of() { # ids_of <beneficiary> -> space separated ids ("" when empty)
  # cast prints uint256[] as "[1, 2]" (or "[]")
  call "$FACTORY" "getSchedulesByBeneficiary(address)(uint256[])" "$1" |
    tr -d '[]()" ' | tr ',' ' '
}

find_100_id() { # first schedule of <beneficiary> with totalAmount == 100e18
  local id f
  for id in $(ids_of "$1"); do
    [ -n "$id" ] || continue
    f=$(sched_fields "$(call "$FACTORY" "$SCHED_SIG" "$id")")
    if [ "$(echo "$f" | sed -n 7p)" = "$AMOUNT_100" ]; then
      echo "$id"
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------- 1/8 sanity
step "1/8 sanity: chain id, addresses"
CHAIN=$(cast chain-id --rpc-url "$RPC")
[ "$CHAIN" = "$CHAIN_ID_EXPECTED" ] || die "RPC chain id $CHAIN != $CHAIN_ID_EXPECTED"
echo "OK  chain id $CHAIN"
echo "OK  TestToken      $TOKEN"
echo "OK  VestingFactory $FACTORY"
echo "OK  deployer       $DEPLOYER"
echo "OK  owner(beneficiary target) $OWNER"

# ----------------------------------------------------------------- 2/8 mint
step "2/8 owner mints 1000e18 TEST to DEPLOYER"
MINT_TX=$(send "$TOKEN" "mint(address,uint256)" "$DEPLOYER" 1000e18 | sed -n 's/^TX //p')
echo "OK  mint tx $MINT_TX"

# --------------------------------------------------------------- 3/8 approve
step "3/8 DEPLOYER approves the factory for 200e18"
APPROVE_TX=$(send "$TOKEN" "approve(address,uint256)" "$FACTORY" 200e18 | sed -n 's/^TX //p')
echo "OK  approve tx $APPROVE_TX"

# -------------------------------------------------------------- 4/8 create x2
step "4/8 createSchedule(token, beneficiary, start=0, cliff=3mo, duration=9mo, 100e18)"
ID_OWNER=""
ID_DEPLOYER=""
CREATE_TX_OWNER="(reused — no new tx)"
CREATE_TX_DEPLOYER="(reused — no new tx)"
if [ "${FORCE:-0}" != "1" ]; then
  ID_OWNER=$(find_100_id "$OWNER" || true)
  ID_DEPLOYER=$(find_100_id "$DEPLOYER" || true)
fi
if [ -n "$ID_OWNER" ] && [ -n "$ID_DEPLOYER" ]; then
  echo "SKIP creation — schedules already exist (owner id=$ID_OWNER, deployer id=$ID_DEPLOYER); set FORCE=1 to create duplicates"
  CREATE_TX_OWNER="(reused — no new tx)"
  CREATE_TX_DEPLOYER="(reused — no new tx)"
else
  [ -z "$ID_OWNER" ] || echo "owner schedule exists (id=$ID_OWNER) — creating only the deployer one"
  [ -z "$ID_DEPLOYER" ] || echo "deployer schedule exists (id=$ID_DEPLOYER) — creating only the owner one"
  if [ -z "$ID_OWNER" ]; then
    CREATE_TX_OWNER=$(send "$FACTORY" "createSchedule(address,address,uint256,uint256,uint256,uint256)" \
      "$TOKEN" "$OWNER" 0 3 9 100e18 | sed -n 's/^TX //p')
    ID_OWNER=$(find_100_id "$OWNER") || die "owner schedule not found after create"
    echo "OK  owner schedule id=$ID_OWNER tx=$CREATE_TX_OWNER"
  fi
  if [ -z "$ID_DEPLOYER" ]; then
    CREATE_TX_DEPLOYER=$(send "$FACTORY" "createSchedule(address,address,uint256,uint256,uint256,uint256)" \
      "$TOKEN" "$DEPLOYER" 0 3 9 100e18 | sed -n 's/^TX //p')
    ID_DEPLOYER=$(find_100_id "$DEPLOYER") || die "deployer schedule not found after create"
    echo "OK  deployer schedule id=$ID_DEPLOYER tx=$CREATE_TX_DEPLOYER"
  fi
fi
echo "SCHEDULE ids: OWNER=$ID_OWNER DEPLOYER=$ID_DEPLOYER"
echo "TX hashes: mint=$MINT_TX approve=$APPROVE_TX create(owner)=$CREATE_TX_OWNER create(deployer)=$CREATE_TX_DEPLOYER"

# ------------------------------------------------------- 5/8 read-back asserts
step "5/8 getSchedule read-back assertions"
check_schedule() { # check_schedule <id> <expected-beneficiary-label> <expected-beneficiary>
  local id=$1 label=$2 bene=$3 f
  f=$(sched_fields "$(call "$FACTORY" "$SCHED_SIG" "$id")")
  local token grantor ben start cliff dur total released
  token=$(echo "$f" | sed -n 1p)
  grantor=$(echo "$f" | sed -n 2p)
  ben=$(echo "$f" | sed -n 3p)
  start=$(echo "$f" | sed -n 4p)
  cliff=$(echo "$f" | sed -n 5p)
  dur=$(echo "$f" | sed -n 6p)
  total=$(echo "$f" | sed -n 7p)
  released=$(echo "$f" | sed -n 8p)
  [ "${token,,}" = "${TOKEN,,}" ] || die "id=$id token $token != $TOKEN"
  [ "${ben,,}" = "${3,,}" ] || die "id=$id beneficiary $ben != $3"
  [ "$total" = "$AMOUNT_100" ] || die "id=$id totalAmount $total != 100e18"
  [ "$cliff" = "$CLIFF_SECONDS" ] || die "id=$id cliffDuration $cliff != 7776000"
  [ "$dur" = "$DURATION_SECONDS" ] || die "id=$id duration $dur != 23328000"
  [ "$released" = "0" ] || die "id=$id released $released != 0"
  echo "OK  id=$id ($label): token, beneficiary=$ben, totalAmount=100e18, cliff=90d, duration=270d, released=0, grantor=$grantor, start=$start"
}
check_schedule "$ID_OWNER" "OWNER" "$OWNER"
check_schedule "$ID_DEPLOYER" "DEPLOYER" "$DEPLOYER"

# --------------------------------------------------------- 6/8 releasable == 0
step "6/8 releasableAmount == 0 for both (pre-cliff)"
for pair in "OWNER:$ID_OWNER" "DEPLOYER:$ID_DEPLOYER"; do
  label=${pair%%:*}
  id=${pair##*:}
  r=$(call "$FACTORY" "releasableAmount(uint256)(uint256)" "$id" | tr -d '"' | sed -E 's/[[:space:]]*\[[^]]*\]$//')
  [ "$r" = "0" ] || die "id=$id ($label) releasableAmount $r != 0"
  echo "OK  id=$id ($label) releasableAmount=0"
done

# ------------------------------------------------- 7/8 release reverts (guard)
step "7/8 release(id) reverts NothingToRelease (0xb10205ed)"
EXPECT=$(cast sig "NothingToRelease()")
[ "$EXPECT" = "0xb10205ed" ] || die "selector drift: cast sig=$EXPECT expected 0xb10205ed"
echo "OK  selector NothingToRelease() = $EXPECT"
for pair in "OWNER:$ID_OWNER" "DEPLOYER:$ID_DEPLOYER"; do
  label=${pair%%:*}
  id=${pair##*:}
  if rel=$(cast send "$FACTORY" "release(uint256)" "$id" \
      --account deployer --password-file "$PASSFILE" --rpc-url "$RPC" 2>&1); then
    die "id=$id ($label) release did NOT revert"
  fi
  if echo "$rel" | grep -qiE 'b10205ed|NothingToRelease'; then
    echo "OK  id=$id ($label) release reverted with NothingToRelease"
  else
    printf '%s\n' "$rel" >&2
    die "id=$id ($label) reverted, but not with NothingToRelease"
  fi
done

# ------------------------------------------------- 8/8 factory escrow >= 200e18
step "8/8 factory holds the escrow (balanceOf(factory) >= 200e18)"
BAL=$(call "$TOKEN" "balanceOf(address)(uint256)" "$FACTORY" | tr -d '"' | sed -E 's/[[:space:]]*\[[^]]*\]$//')
python3 -c 'import sys; b,t=int(sys.argv[1]),int(sys.argv[2]); sys.exit(0 if b>=t else 1)' \
  "$BAL" "$FACTORY_FLOOR" || die "factory balance $BAL < 200e18"
echo "OK  factory TEST balance = $BAL"

printf '\nSEPOLIA SMOKE PASSED — schedule ids: OWNER=%s DEPLOYER=%s\n' "$ID_OWNER" "$ID_DEPLOYER"
