# Spec

- `html-size` reads each built indexable page (`files` with kind `page`), measures `Buffer.byteLength(html, 'utf8')`
  and fails above `buildChecks.htmlSize.maxBytes`. The limit is Google's 2 MB (2,097,152 bytes) less 16 KiB because the
  2 MB includes the HTTP response headers, which the build cannot see.
- The finding names the head elements present in the page but absent from its first `maxBytes` bytes: `<title>`, the
  canonical link, meta robots or googlebot, JSON-LD.
- Level error; a site can lower it through `discoveryOverrides` like any rule.
- website-audit (Skills) reads the result as row T-12 in a later release; `shipgate-map.json` maps it there.
