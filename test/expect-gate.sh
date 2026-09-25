#!/usr/bin/env bash
# Checks that the gate behaved as expected for one fixture variant: the conforming
# variants must pass, every broken one must fail on the check that owns the fault.
#   expect-gate.sh VARIANT OUTCOME   (OUTCOME is the gate step's outcome)
set -euo pipefail
variant=$1 outcome=$2
case "$variant" in
  conforming|vendor-named-asset) fails="" ;;
  missing-alt|wide-element|csp-violation|bad-redirect|no-focus-ring|tracker-cookie) fails="Smoke, axe, reflow, CSP, edge" ;;
  two-h1) fails="Structure scan" ;;
  direct-tag) fails="Stack guards" ;;
  blocks-ai-search|bad-jsonld|robots-no-agents|rtl-no-dir|allows-training) fails="Discovery (SEO, AEO, GEO, AIO)" ;;
  google-font) fails="Market scan" ;;
  *) echo "::error::No expectation for variant $variant."; exit 2 ;;
esac
[ -n "${SHIP_GATE_DIR:-}" ] && [ -f "$SHIP_GATE_DIR/summary.md" ] || { echo "::error::Variant $variant wrote no gate summary."; exit 1; }
cat "$SHIP_GATE_DIR/summary.md"
if [ -z "$fails" ]; then
  [ "$outcome" = success ] || { echo "::error::Variant $variant must pass the gate."; exit 1; }
else
  [ "$outcome" = failure ] || { echo "::error::Variant $variant must fail the gate, but it passed."; exit 1; }
  grep -qF "| $fails | ❌ failed |" "$SHIP_GATE_DIR/summary.md" \
    || { echo "::error::Variant $variant must fail \"$fails\"."; exit 1; }
fi
echo "Gate behaved as expected for $variant."
