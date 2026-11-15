# Spec: html-size and retired rich results (from intent.md 2026-11-15)

## Requirements

- `html-size` reads each built indexable page (`files` with kind `page`), measures `Buffer.byteLength(html, 'utf8')`
  and fails above `buildChecks.htmlSize.maxBytes`. The limit is Google's 2 MB (2,097,152 bytes) less 16 KiB because the
  2 MB includes the HTTP response headers, which the build cannot see.
- The finding names the head elements present in the page but absent from its first `maxBytes` bytes: `<title>`, the
  canonical link, meta robots or googlebot, JSON-LD.
- Level error; a site can lower it through `discoveryOverrides` like any rule.
- website-audit (Skills) reads the result as row T-12 in a later release; `shipgate-map.json` maps it there.

## Design

One rule in `discovery.mjs` (`RULES`), one block in `check-discovery.mjs` before the per-page loop, one threshold in
`standards.json` `buildChecks`. A lost element is one the page has more of than the part Googlebot reads.

## Areas of concern

- The 16 KiB header headroom is an estimate; real headers are far smaller, so it errs toward failing early.

## Out of scope

- Gaps 3, 4 and 6 (see intent.md).
