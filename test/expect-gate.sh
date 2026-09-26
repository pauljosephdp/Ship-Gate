#!/usr/bin/env bash
# Checks that the gate behaved as expected for one fixture variant: the conforming
# variants must pass, every broken one must fail on the check that owns the fault.
#   expect-gate.sh VARIANT OUTCOME   (OUTCOME is the gate step's outcome)
#   expect-gate.sh --stage VARIANT   print how far the gate runs for the variant:
#     full     every check, Lighthouse included
#     browser  every check up to the browser tests, no Lighthouse
#     scans    stops after the post-build scans; the fault is caught before any browser runs
set -euo pipefail
if [ "$1" = --stage ]; then variant=$2; else variant=$1 outcome=$2; fi
case "$variant" in
  conforming) stage=full fails="" ;;
  vendor-named-asset) stage=browser fails="" ;;
  posthog-hybrid|analytics-always-on) stage=browser fails="" ;;
  posthog-hybrid-missing|posthog-hybrid-csp) stage=scans fails="PostHog on every page" ;;
  missing-alt|wide-element|csp-violation|bad-redirect|no-focus-ring|tracker-cookie) stage=browser fails="Smoke, axe, reflow, CSP, edge" ;;
  two-h1) stage=scans fails="Structure scan" ;;
  direct-tag) stage=scans fails="Stack guards" ;;
  blocks-ai-search|bad-jsonld|robots-no-agents|rtl-no-dir|allows-training) stage=scans fails="Discovery (SEO, AEO, GEO, AIO)" ;;
  google-font) stage=scans fails="Market scan" ;;
  *) echo "::error::No expectation for variant $variant."; exit 2 ;;
esac
if [ "$1" = --stage ]; then echo "$stage"; exit 0; fi
[ -n "${SHIP_GATE_DIR:-}" ] && [ -f "$SHIP_GATE_DIR/summary.md" ] || { echo "::error::Variant $variant wrote no gate summary."; exit 1; }
cat "$SHIP_GATE_DIR/summary.md"
if [ -z "$fails" ]; then
  [ "$outcome" = success ] || { echo "::error::Variant $variant must pass the gate."; exit 1; }
else
  [ "$outcome" = failure ] || { echo "::error::Variant $variant must fail the gate, but it passed."; exit 1; }
  grep -qF "| $fails | ❌ failed |" "$SHIP_GATE_DIR/summary.md" \
    || { echo "::error::Variant $variant must fail \"$fails\"."; exit 1; }
fi
# A stage that skipped Lighthouse or the browser must show it: "not run", never "passed".
if [ "$stage" != full ]; then
  grep -qF "| Lighthouse | ➖ not run |" "$SHIP_GATE_DIR/summary.md" \
    || { echo "::error::Variant $variant ran at stage $stage but Lighthouse did not read \"not run\"."; exit 1; }
fi
if [ "$stage" = scans ]; then
  grep -qF "| Smoke, axe, reflow, CSP, edge | ➖ not run |" "$SHIP_GATE_DIR/summary.md" \
    || { echo "::error::Variant $variant ran at stage scans but the browser tests did not read \"not run\"."; exit 1; }
fi
echo "Gate behaved as expected for $variant (stage $stage)."
