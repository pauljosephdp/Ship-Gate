#!/usr/bin/env node
// Ship Gate results — one machine-readable record of a gate run, reports/results.json.
//
//   node results.mjs   (the action's last always-on step, after Summary)
//
// website-audit (pauljosephdp/Skills) does not re-test what the build proves: it reads the latest
// results.json, which the caller's full sweep uploads as the "ship-gate-results" artifact.
// Schema (README → Results for website-audit):
//   { shipGate, stage, siteUrl, commit, finishedAt,
//     checks: [{ id, category, level: "error"|"warn", status: "pass"|"fail"|"warn"|"not-run", count, samples }] }
// Reads, each optional: the step outcomes (OUTCOMES, "Name=outcome|…"), run.json, and reports/
// discovery.json, structure.json, render/*.json, playwright.json and Lighthouse's assertion results.
// Never fails the job: a missing input only means its checks read "not-run".
// Env: SHIP_GATE_DIR, STAGE, OUTCOMES, SHIP_GATE_COMMIT, SHIP_GATE_CONFIG.
// No dependencies: Node built-ins only.

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './discovery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHIP_GATE_DIR || join(process.env.RUNNER_TEMP || '.', 'ship-gate');
const REPORTS = join(OUT, 'reports');
const json = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const version = readFileSync(join(HERE, '..', 'CHANGELOG.md'), 'utf8').match(/^## (v\d+\.\d+\.\d+)/m)?.[1] ?? 'unknown';
const run = json(join(OUT, 'run.json'));
const cfg = run ? null : json(process.env.SHIP_GATE_CONFIG || 'ship-gate.config.json');
const levels = run?.discovery?.levels ?? {};

// Step outcomes, as the Summary table names them.
const outcomes = Object.fromEntries((process.env.OUTCOMES || '').split('|').map((r) => r.trim()).filter(Boolean)
  .map((r) => [r.slice(0, r.lastIndexOf('=')).trim(), r.slice(r.lastIndexOf('=') + 1).trim()]));
const STEPS = [
  ['Contract and config', 'contract', 'policy'], ['Stack guards', 'guards', 'policy'], ['astro check', 'astro-check', 'build'],
  ['Lint', 'lint', 'build'], ['Unit tests', 'unit-tests', 'build'], ['Site checks before build', 'site-checks-prebuild', 'site'],
  ['Build', 'build', 'build'], ['Page resolution', 'page-resolution', 'build'],
  ['Client bundle PostHog-free', 'posthog-client-bundle', 'policy'], ['PostHog on every page', 'posthog-pages', 'policy'],
  ['Structure scan', 'structure', 'structure'], ['Discovery (SEO, AEO, GEO, AIO)', 'discovery', 'SEO'],
  ['Placeholder copy', 'placeholder-copy', 'structure'], ['Market scan', 'market', 'policy'],
  ['Site checks after build', 'site-checks-postbuild', 'site'], ['Site browser checks', 'site-checks-browser', 'site'],
  ['Smoke, axe, reflow, CSP, edge', 'browser', 'a11y'], ['Lighthouse', 'lighthouse', 'perf'],
];
const checks = [];
const push = (id, category, level, status, count = 0, samples = []) =>
  checks.push({ id, category, level, status, count, samples: [...new Set(samples)].slice(0, 10) });
const statusOf = (outcome) => (outcome === 'success' ? 'pass' : outcome === 'failure' ? 'fail' : 'not-run');
for (const [name, id, category] of STEPS) push(`step:${id}`, category, 'error', statusOf(outcomes[name]), outcomes[name] === 'failure' ? 1 : 0);

// Discovery rules: the build scan's, and the render spec's per-page files for the browser rules.
const discovery = json(join(REPORTS, 'discovery.json'))?.rules ?? {};
const renderDir = join(REPORTS, 'render');
const rendered = {};
if (existsSync(renderDir)) for (const f of readdirSync(renderDir).filter((n) => n.endsWith('.json'))) {
  const page = json(join(renderDir, f));
  for (const [rule, found] of Object.entries(page?.findings ?? {})) {
    const r = (rendered[rule] ??= { count: 0, samples: [] });
    r.count += found.length;
    if (found.length) r.samples.push(page.path);
  }
}
const verdict = (level, count) => (count === 0 ? 'pass' : level === 'error' ? 'fail' : 'warn');
for (const [id, rule] of Object.entries(RULES)) {
  const level = levels[id] ?? rule.level;
  const shown = level === 'off' ? rule.level : level;
  if (level === 'off' || rule.where === 'live') { push(id, rule.category, shown, 'not-run'); continue; }
  const r = rule.where === 'browser' ? rendered[id] : discovery[id];
  if (!r) push(id, rule.category, shown, 'not-run');
  else push(id, rule.category, shown, verdict(level, r.count), r.count, r.samples);
}
if (run?.policies?.includes('first-party-only')) {
  const r = rendered['first-party-only'];
  push('first-party-only', 'policy', 'error', r ? verdict('error', r.count) : 'not-run', r?.count ?? 0, r?.samples ?? []);
}

// Structure scan, check by check.
const structure = json(join(REPORTS, 'structure.json'));
for (const id of ['one-h1', 'heading-order', 'noopener', 'title', 'meta-description', 'title-unique', 'meta-description-unique', 'template-token', 'edge-files', 'llms-links']) {
  const r = structure?.[id];
  push(`structure:${id}`, 'structure', 'error', r ? verdict('error', r.count) : 'not-run', r?.count ?? 0, r?.samples ?? []);
}

// Browser suite, spec by spec, from Playwright's JSON report: a test that failed counts once.
const pw = json(join(REPORTS, 'playwright.json'));
const specs = { 'page.spec.ts': ['browser:page', 'a11y'], 'edge.spec.ts': ['browser:edge', 'security'], 'on-demand.spec.ts': ['browser:on-demand', 'SEO'] };
const tally = Object.fromEntries(Object.keys(specs).map((f) => [f, { ran: 0, failed: [] }]));
const walk = (suite, file) => {
  for (const s of suite.suites ?? []) walk(s, s.file ?? file);
  for (const spec of suite.specs ?? []) {
    const f = (spec.file ?? file ?? '').split('/').pop();
    if (!tally[f]) continue;
    for (const t of spec.tests ?? []) {
      if (t.status === 'skipped') continue;
      tally[f].ran++;
      if (t.status === 'unexpected') tally[f].failed.push(spec.title.split(':')[0]);
    }
  }
};
if (pw) for (const s of pw.suites ?? []) walk(s, s.file);
for (const [f, [id, category]] of Object.entries(specs)) {
  const t = tally[f];
  push(id, category, 'error', !pw || t.ran === 0 ? 'not-run' : t.failed.length ? 'fail' : 'pass', t.failed.length, t.failed);
}

// Lighthouse: each failed assertion (lhci writes .lighthouseci/assertion-results.json in the site directory).
const lh = json(join('.lighthouseci', 'assertion-results.json'));
if (Array.isArray(lh)) {
  const byAudit = new Map();
  for (const a of lh.filter((x) => !x.passed)) {
    const key = a.auditId ?? a.name;
    const e = byAudit.get(key) ?? { level: a.level === 'error' ? 'error' : 'warn', urls: [] };
    try { e.urls.push(new URL(a.url).pathname); } catch { e.urls.push(String(a.url ?? '')); }
    byAudit.set(key, e);
  }
  for (const [audit, e] of byAudit)
    push(`lighthouse:${audit}`, /accessibility/.test(audit) ? 'a11y' : 'perf', e.level, e.level === 'error' ? 'fail' : 'warn', e.urls.length, e.urls);
}

const result = {
  shipGate: version,
  stage: process.env.STAGE || 'full',
  siteUrl: run?.siteUrl ?? cfg?.siteUrl ?? null,
  commit: process.env.SHIP_GATE_COMMIT || process.env.GITHUB_SHA || null,
  finishedAt: new Date().toISOString(),
  checks,
};
mkdirSync(REPORTS, { recursive: true });
writeFileSync(join(REPORTS, 'results.json'), JSON.stringify(result, null, 2) + '\n');
const n = (s) => checks.filter((c) => c.status === s).length;
console.log(`Results: ${checks.length} checks (${n('pass')} pass, ${n('fail')} fail, ${n('warn')} warn, ${n('not-run')} not run) in ${join(REPORTS, 'results.json')}.`);
