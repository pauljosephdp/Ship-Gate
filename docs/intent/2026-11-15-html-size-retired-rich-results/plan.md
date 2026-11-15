# Plan

1. `standards/standards.json`: `buildChecks.htmlSize` (`maxBytes` 2080768, `from`, `source`); ClaimReview and the
   Sitelinks search box in `retiredRichResults`.
2. `scripts/discovery.mjs`: rule `html-size` (SEO, error). `scripts/check-discovery.mjs`: every indexable page's UTF-8
   byte length against `maxBytes`; on a failure, which of `<title>`, the canonical, meta robots and JSON-LD fall past the
   cut.
3. `scripts/self-test.sh`: three cases (over the limit fails; a `<title>` past the cut is named; just under passes).
4. README: the rule's row in the discovery table; pins to v4.1.0. CHANGELOG v4.1.0.
5. Proof: `bash scripts/self-test.sh` (0 failed), shellcheck, `check-readme.sh`; the web-baseline fleet canary runs this
   release on every site before web-baseline pins it.
