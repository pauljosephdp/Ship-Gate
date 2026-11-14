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
import { SOURCE_GUARDS } from './gate-rules.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.SHIP_GATE_DIR || join(process.env.RUNNER_TEMP || '.', 'ship-gate');
const REPORTS = join(OUT, 'reports');
const json = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const version = readFileSync(join(HERE, '..', 'CHANGELOG.md'), 'utf8').match(/^## (v\d+\.\d+\.\d+)/m)?.[1] ?? 'unknown';
const run = json(join(OUT, 'run.json'));
const cfg = json(process.env.SHIP_GATE_CONFIG || 'ship-gate.config.json');
const policies = run?.policies ?? cfg?.policies ?? [];
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

const verdict = (level, count) => (count === 0 ? 'pass' : level === 'error' ? 'fail' : 'warn');

// Guards, one record each, from reports/guards.tsv (guards.sh logs "ID<TAB>fail|warn|delegated").
// A guard of a policy the site doesn't use, or one its standard checks instead, did not run here.
const guardsRan = outcomes['Stack guards'] === 'success' || outcomes['Stack guards'] === 'failure';
const guardLogFile = join(REPORTS, 'guards.tsv');
const guardLog = new Map(existsSync(guardLogFile) ? readFileSync(guardLogFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')) : []);
for (const [id, pols] of Object.entries(SOURCE_GUARDS)) {
  const applies = !pols.length || pols.some((p) => policies.includes(p));
  const logged = guardLog.get(id);
  const status = !guardsRan || !applies || logged === 'delegated' || (!existsSync(guardLogFile) && outcomes['Stack guards'] === 'failure') ? 'not-run'
    : logged === 'fail' ? 'fail' : logged === 'warn' ? 'warn' : 'pass';
  push(`guard:${id}`, 'policy', 'error', status, status === 'fail' || status === 'warn' ? 1 : 0);
}

// Playwright's JSON report: each test's final attempt, its failed assertions' first lines and its warnings.
const pw = json(join(REPORTS, 'playwright.json'));
const tests = [];
const walk = (suite, file) => {
  for (const s of suite.suites ?? []) walk(s, s.file ?? file);
  for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) {
    if (t.status === 'skipped') continue;
    const last = t.results?.at(-1) ?? {};
    tests.push({
      file: (spec.file ?? file ?? '').split('/').pop(), title: spec.title, path: spec.title.split(':')[0], status: t.status,
      errors: (last.errors ?? []).map((e) => (e.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').replace(/^Error:\s*/, '').split('\n')[0]),
      warnings: [...new Set([...(t.annotations ?? []), ...(last.annotations ?? [])].filter((a) => a.type === 'warning').map((a) => a.description ?? ''))],
    });
  }
};
if (pw) for (const s of pw.suites ?? []) walk(s, s.file);
const failedTest = (t) => t.status === 'unexpected';

// Discovery rules: the build scan's, and the render spec's per-page files for the browser rules. A render
// test that failed before writing its file (a page that didn't load) counts against every rule it owns.
const discovery = json(join(REPORTS, 'discovery.json'))?.rules ?? {};
const renderDir = join(REPORTS, 'render');
const rendered = {};
const wrote = new Set();
if (existsSync(renderDir)) for (const f of readdirSync(renderDir).filter((n) => n.endsWith('.json'))) {
  const page = json(join(renderDir, f));
  wrote.add(`${f.startsWith('origins-') ? 'origins' : 'render'}:${page?.path}`);
  for (const [rule, found] of Object.entries(page?.findings ?? {})) {
    const r = (rendered[rule] ??= { count: 0, samples: [] });
    r.count += found.length;
    if (found.length) r.samples.push(page.path);
  }
}
const renderTests = tests.filter((t) => t.file === 'render.spec.ts');
for (const t of renderTests.filter((x) => failedTest(x))) {
  const origins = /first-party/.test(t.title);
  if (wrote.has(`${origins ? 'origins' : 'render'}:${t.path}`)) continue;
  for (const rule of origins ? ['first-party-only'] : ['rendered-content', 'lazy-first-viewport', 'content-parity']) {
    const r = (rendered[rule] ??= { count: 0, samples: [] });
    r.count++; r.samples.push(t.path); r.threw = true;
  }
}
for (const [id, rule] of Object.entries(RULES)) {
  const level = levels[id] ?? rule.level;
  const shown = level === 'off' ? rule.level : level;
  if (level === 'off' || rule.where === 'live') { push(id, rule.category, shown, 'not-run'); continue; }
  const r = rule.where === 'browser' ? rendered[id] : discovery[id];
  if (!r) push(id, rule.category, shown, 'not-run');
  else push(id, rule.category, shown, r.threw ? 'fail' : verdict(level, r.count), r.count, r.samples);
}
if (policies.includes('first-party-only')) {
  const r = rendered['first-party-only'];
  push('first-party-only', 'policy', 'error', r ? (r.threw ? 'fail' : verdict('error', r.count)) : 'not-run', r?.count ?? 0, r?.samples ?? []);
}

// Structure scan, check by check.
const structure = json(join(REPORTS, 'structure.json'));
for (const id of ['one-h1', 'heading-order', 'noopener', 'title', 'meta-description', 'title-unique', 'meta-description-unique', 'template-token', 'edge-files', 'llms-links']) {
  const r = structure?.[id];
  push(`structure:${id}`, 'structure', 'error', r ? verdict('error', r.count) : 'not-run', r?.count ?? 0, r?.samples ?? []);
}

// The page test (page.spec.ts) checks several things per page: each failed assertion is sorted to its
// check by its message, so smoke, axe, consent, CSP, keyboard and reflow each get a record.
const pageTests = tests.filter((t) => t.file === 'page.spec.ts');
const checkOf = (title, msg) => (/^axe/.test(msg) ? 'axe' : /^consent/.test(msg) ? 'consent'
  : /Content-Security-Policy/.test(msg) ? 'csp' : /^keyboard/.test(msg) ? 'keyboard'
  : /reflows at 200%/.test(title) || /^\d+px: |wider than the viewport|past the right edge/.test(msg) ? 'reflow'
  : /PostHog/.test(title) ? 'posthog' : /Turnstile/.test(title) ? 'turnstile' : 'smoke');
const PAGE_CHECKS = {
  smoke: ['structure', 'error', true], axe: ['a11y', 'error', true], keyboard: ['a11y', run?.keyboard === 'error' ? 'error' : 'warn', true],
  reflow: ['a11y', 'error', true], csp: ['security', 'error', true],
  consent: ['policy', 'error', policies.includes('consent-before-tracking') && !(run?.exempt ?? []).includes('consent')],
  posthog: ['policy', 'error', !!run?.posthog], turnstile: ['policy', 'error', policies.includes('turnstile-forms') && (run?.formPages ?? []).length > 0],
};
const found = Object.fromEntries(Object.keys(PAGE_CHECKS).map((k) => [k, { fail: [], warn: [] }]));
for (const t of pageTests) {
  if (failedTest(t)) {
    const hit = new Set((t.errors.length ? t.errors : ['']).map((m) => checkOf(t.title, m)));
    for (const k of hit) found[k].fail.push(t.path);
  }
  if (t.warnings.length) found.keyboard.warn.push(t.path); // page.spec annotates keyboard findings only
}
for (const [k, [category, level, applies]] of Object.entries(PAGE_CHECKS)) {
  const f = found[k];
  const status = !pageTests.length || !applies ? 'not-run' : f.fail.length ? 'fail' : f.warn.length ? 'warn' : 'pass';
  push(`browser:${k}`, category, level, status, status === 'fail' ? f.fail.length : status === 'warn' ? f.warn.length : 0, status === 'fail' ? f.fail : f.warn);
}
// The edge and on-demand specs, spec by spec.
for (const [file, id, category] of [['edge.spec.ts', 'browser:edge', 'security'], ['on-demand.spec.ts', 'browser:on-demand', 'SEO']]) {
  const ts = tests.filter((t) => t.file === file);
  const failed = ts.filter(failedTest).map((t) => t.title);
  push(id, category, 'error', !ts.length ? 'not-run' : failed.length ? 'fail' : 'pass', failed.length, failed);
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
