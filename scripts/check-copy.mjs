#!/usr/bin/env node
// Ship Gate placeholder-copy scan — draft text must not reach an indexable page.
//
//   node check-copy.mjs        (reads $SHIP_GATE_DIR/run.json, written after the build)
//
// Flags, in the text a reader sees: "[Client name]"-style brackets (a capitalised
// phrase, or a word like "insert"/"add"/"placeholder"), TODO:/TBD/FIXME,
// and lorem ipsum. Citations such as [1] and editorial [sic] pass.
// Pages marked noindex are drafts by definition and are not scanned.
// Exact strings in copyAllowlist (ship-gate.config.json) are allowed.
// No dependencies: Node built-ins only.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexablePages } from './site-files.mjs';

const OUT = process.env.SHIP_GATE_DIR || '.ship-gate';
const { root, copyAllowlist } = JSON.parse(readFileSync(join(OUT, 'run.json'), 'utf8'));

// "[Client name]" (capitalised phrase of 2–7 words) or a bracket naming the job to do.
// Single-word labels such as "[PDF]", citations "[1]" and "[sic]" pass.
const BRACKET = /\[(?:[A-Z][a-z]+(?: [A-Za-z]+){1,6}|[^\]\n]*\b(?:[Ii]nsert|[Aa]dd|[Pp]laceholder|TBD|TK|[Yy]our)\b[^\]\n]*)\]/g;
const WORDS = /\bTODO:|\bTBD\b|\bFIXME\b|\blorem ipsum\b/gi;

const text = (html) => html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<(script|style|template|svg|noscript|pre|code)\b[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const hits = [];
const pages = indexablePages(root);
for (const p of pages) {
  let t = text(p.html);
  for (const allowed of copyAllowlist) t = t.split(allowed).join(' ');
  const found = [...new Set([...(t.match(BRACKET) ?? []), ...(t.match(WORDS) ?? [])])];
  if (found.length) hits.push(`${p.path}: ${found.slice(0, 5).join(', ')}`);
}
console.log(`Placeholder scan: ${pages.length} indexable page(s).`);
if (hits.length) {
  for (const h of hits) console.log(`::error::Placeholder copy on ${h}`);
  console.log('Replace the draft text, mark the page noindex, or add an exact string to copyAllowlist in ship-gate.config.json.');
  process.exit(1);
}
console.log('No placeholder copy.');
