#!/usr/bin/env bash
# Breaks the fixture site one way, so self-test.yml can prove the gate turns red for it.
#   break-fixture.sh VARIANT   (run from the repo root)
set -euo pipefail
cd "$(dirname "$0")/fixture-site"
index=src/pages/index.astro
add() { sed -i "s#<h2>What this is</h2>#<h2>What this is</h2>$1#" "$index"; }
case "$1" in
  conforming) ;;
  missing-alt) echo '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>' > public/dot.svg; add '<img src="/dot.svg" width="8" height="8">' ;;
  wide-element) add '<div style="width:420px">A block wider than a phone.</div>' ;;
  csp-violation) add '<script is:inline src="https://cdn.example.org/widget.js"></script>' ;;
  bad-redirect) echo '/old-contact /contact-us/ 301' >> public/_redirects ;;
  two-h1) add '<h1>A second top-level heading</h1>' ;;
  direct-tag) add '<script is:inline async src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCD123"></script>' ;;
  *) echo "Unknown variant: $1" >&2; exit 2 ;;
esac
echo "Fixture variant: $1"
