#!/usr/bin/env node
// Ship Gate — validate the calling site and generate this run's test config.
//
//   node prepare.mjs verify      [config]  → checks contract + config, writes test config
//   node prepare.mjs lighthouse  [config]  → after the build: writes the Lighthouse config
//   node prepare.mjs post-deploy [config]  → exports site URL + smoke paths
//
// Run from the site directory (the action's working-directory). Standards live
// HERE, not in site repos. A site may make one stricter freely; it may loosen one
// only through thresholdOverrides, with a reason and a restore date.
// No dependencies: Node built-ins only.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [mode = 'verify', configPath = 'ship-gate.config.json'] = process.argv.slice(2);
const SITE = process.cwd();
// Generated files live OUTSIDE the site on CI, so `astro check` never type-checks them.
const OUT = process.env.SHIP_GATE_DIR || (process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'ship-gate') : resolve('.ship-gate'));
const PORT = 4321;
const ORIGIN = `http://localhost:${PORT}`;

// Ship Gate's own test tooling, pinned here and installed into OUT. Sites no
// longer carry these dependencies; their own `playwright` version stays theirs.
const TOOLS = { '@playwright/test': '1.63.0', '@axe-core/playwright': '4.13.0', '@lhci/cli': '0.15.1' };

// ── The standard ──
// Deterministic lab signals fail the build. Throttled performance on a shared
// CI runner moves several points between identical runs, so it warns; a site
// that wants it to fail raises it to "error" in its own config.
// The SEO category score is not asserted: Lighthouse fails robots-txt on the
// Content-Signal directive (a deliberate ai-train=no) and is-crawlable on
// deliberate noindex pages. The audits that matter are asserted one by one.
const STANDARD = {
  'categories:accessibility': { level: 'error', minScore: 0.95 },
  'categories:best-practices': { level: 'error', minScore: 0.9 },
  'categories:performance': { level: 'warn', minScore: 0.9 },
  'cumulative-layout-shift': { level: 'error', maxNumericValue: 0.05 },
  'largest-contentful-paint': { level: 'warn', maxNumericValue: 4000 },
  'total-blocking-time': { level: 'warn', maxNumericValue: 300 },
  'document-title': { level: 'error' },
  'meta-description': { level: 'error' },
  'http-status-code': { level: 'error' },
  'link-text': { level: 'error' },
  'crawlable-anchors': { level: 'error' },
  hreflang: { level: 'error' },
  canonical: { level: 'error' },
};
const LEVEL_RANK = { warn: 1, error: 2 };
// Other companies' code is blocked in Lighthouse, so a vendor release never moves a site's score.
const BLOCKED_URLS = ['*posthog*', '*hubspot*', '*hsforms*', '*hs-scripts*', '*hs-analytics*', '*clarity.ms*',
  '*googletagmanager*', '*google-analytics*', '*/cdn-cgi/*', '*challenges.cloudflare.com*'];

const REQUIRED_SCRIPTS = ['check', 'build'];
const REQUIRED_DEV_DEPS = ['@astrojs/check'];
const OLD_KIT_FILES = ['scripts/guards.sh', 'scripts/check-dist.sh'];
const OWN_LIGHTHOUSE_CONFIGS = ['lighthouserc.cjs', 'lighthouserc.js', 'lighthouserc.json', '.lighthouserc.json', '.lighthouserc.js'];
// A gate must never write to production. These fragments in a script it runs fail the contract.
const PRODUCTION_WRITES = /wrangler\s+(deploy|publish|secret|pages\s+deploy|r2\s+object\s+put|kv\s+key\s+put)|--remote\b|migrations\s+apply\b(?!.*--local)/;
const TURNSTILE_TEST_KEYS = { siteKey: '1x00000000000000000000AA', secretKey: '1x0000000000000000000000000000000AA' };

const errors = [];
const err = (m) => errors.push(m);
const warn = (m) => console.log(`::warning::${m}`);
const today = new Date().toISOString().slice(0, 10);

function exportEnv(name, value) {
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
  else console.log(`(local) ${name}=${value}`);
}
function fail() {
  for (const e of errors) console.log(`::error::${e}`);
  console.log(`Ship Gate: ${errors.length} problem(s) — see above.`);
  process.exit(1);
}

// ── Config ──
if (!existsSync(configPath)) {
  console.log(`::error::${configPath} not found in ${SITE}. Copy templates/caller/ship-gate.config.json from the Ship Gate repo.`);
  process.exit(1);
}
let cfg;
try { cfg = JSON.parse(readFileSync(configPath, 'utf8')); } catch (e) {
  console.log(`::error::${configPath} is not valid JSON: ${e.message}`);
  process.exit(1);
}

const isPathList = (v) => Array.isArray(v) && v.every((p) => typeof p === 'string' && p.startsWith('/'));
const isNameList = (v, re) => Array.isArray(v) && v.every((s) => typeof s === 'string' && re.test(s));

if (typeof cfg.siteUrl !== 'string' || !/^https:\/\/[^/]+$/.test(cfg.siteUrl))
  err('siteUrl must be an https origin with no path or trailing slash, e.g. "https://liveincocoon.com".');
const smokePaths = cfg.smokePaths ?? ['/', '/robots.txt', '/sitemap-index.xml'];
if (!isPathList(smokePaths) || smokePaths.length === 0) err('smokePaths must be a non-empty list of paths starting with "/".');

if (mode === 'post-deploy') {
  if (errors.length) fail();
  exportEnv('SHIP_GATE_SITE_URL', cfg.siteUrl);
  exportEnv('SHIP_GATE_SMOKE_PATHS', smokePaths.join(' '));
  console.log('Post-deploy config loaded.');
  process.exit(0);
}
if (mode !== 'verify' && mode !== 'lighthouse') {
  console.log(`::error::Unknown mode "${mode}". Use "verify", "lighthouse" or "post-deploy".`);
  process.exit(1);
}

const server = cfg.server ?? 'static';
if (!['static', 'preview'].includes(server)) err('server must be "static" (serve the built files) or "preview" (npm run preview).');
const distDir = cfg.distDir ?? 'dist';
if (typeof distDir !== 'string' || distDir.startsWith('/') || distDir.split(/[\\/]/).includes('..'))
  err('distDir must be a relative path inside the site directory, e.g. "dist".');

const lighthouseUrls = cfg.lighthouseUrls ?? cfg.pages;
if (!(lighthouseUrls === 'all' || (isPathList(lighthouseUrls) && lighthouseUrls.length > 0)))
  err('lighthouseUrls must be "all" (every page the build emits) or a non-empty list of paths starting with "/".');
const blocked = [...BLOCKED_URLS, ...(cfg.lighthouseBlockedUrls ?? [])];
if (!isNameList(cfg.lighthouseBlockedUrls ?? [], /^\S+$/)) err('lighthouseBlockedUrls must be a list of URL patterns such as "*/relay/*".');

// ── Assertions: stricter is always allowed; looser needs a reason and a restore date ──
function strictness(std, o) {
  // Returns { stricter, looser } comparing an override against the standard.
  let stricter = false, looser = false;
  if (o.level !== undefined) {
    if (LEVEL_RANK[o.level] > LEVEL_RANK[std.level]) stricter = true;
    if (LEVEL_RANK[o.level] < LEVEL_RANK[std.level]) looser = true;
  }
  if (o.minScore !== undefined) {
    if (o.minScore > std.minScore) stricter = true;
    if (o.minScore < std.minScore) looser = true;
  }
  if (o.maxNumericValue !== undefined) {
    if (o.maxNumericValue < std.maxNumericValue) stricter = true;
    if (o.maxNumericValue > std.maxNumericValue) looser = true;
  }
  return { stricter, looser };
}

const assertions = {};
for (const [id, s] of Object.entries(STANDARD)) assertions[id] = { ...s };
for (const [i, o] of (cfg.thresholdOverrides ?? []).entries()) {
  // v1 configs named categories directly ("performance"); accept that form.
  const id = o?.audit ?? (o?.category ? `categories:${o.category}` : undefined);
  const where = `thresholdOverrides[${i}] (${id ?? '?'})`;
  if (!id || !(id in STANDARD)) { err(`${where}: audit must be one of ${Object.keys(STANDARD).join(', ')}.`); continue; }
  const std = STANDARD[id];
  if (o.level !== undefined && !(o.level in LEVEL_RANK)) { err(`${where}: level must be "warn" or "error".`); continue; }
  if (o.minScore !== undefined && (std.minScore === undefined || typeof o.minScore !== 'number' || o.minScore <= 0 || o.minScore > 1)) {
    err(`${where}: minScore applies only to category scores and must be above 0 and at most 1.`); continue;
  }
  if (o.maxNumericValue !== undefined && (std.maxNumericValue === undefined || typeof o.maxNumericValue !== 'number' || o.maxNumericValue <= 0)) {
    err(`${where}: maxNumericValue applies only to metric audits and must be a positive number.`); continue;
  }
  const { stricter, looser } = strictness(std, o);
  if (!stricter && !looser) { err(`${where}: changes nothing — remove it.`); continue; }
  if (looser) {
    if (typeof o.reason !== 'string' || o.reason.trim().length < 10) { err(`${where}: loosening the standard needs a real reason (at least 10 characters).`); continue; }
    if (typeof o.restoreBy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.restoreBy) || isNaN(Date.parse(o.restoreBy))) {
      err(`${where}: loosening the standard needs restoreBy as a YYYY-MM-DD date.`); continue;
    }
    if (o.restoreBy < today) { err(`${where}: override expired on ${o.restoreBy}. Restore the standard, or renew with a new reason and date.`); continue; }
    warn(`Lighthouse ${id} loosened until ${o.restoreBy}: ${o.reason}`);
  } else {
    console.log(`Lighthouse ${id} raised above the standard by this site.`);
  }
  for (const k of ['level', 'minScore', 'maxNumericValue']) if (o[k] !== undefined) assertions[id][k] = o[k];
}

// ── Repo contract ──
let pkg = {};
try { pkg = JSON.parse(readFileSync('package.json', 'utf8')); } catch { err(`package.json missing or invalid in ${SITE}.`); }
const scripts = pkg.scripts ?? {};
const required = server === 'preview' ? [...REQUIRED_SCRIPTS, 'preview'] : REQUIRED_SCRIPTS;
for (const s of required) if (!scripts[s]) err(`package.json is missing the "${s}" script (Ship Gate calls it by that name).`);
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const d of REQUIRED_DEV_DEPS) if (!allDeps[d]) err(`Missing dev dependency ${d} (npm run check needs it). Run: npm i -D ${d}`);
if (scripts.build && PRODUCTION_WRITES.test(scripts.build))
  err(`The "build" script writes to production (${scripts.build}). CI builds on every PR; move deploys and remote migrations out of "build".`);

// Site-specific checks: npm scripts the gate runs by name. Never ones that touch production.
const checks = cfg.checks ?? {};
const PHASES = ['preBuild', 'postBuild', 'browser'];
for (const k of Object.keys(checks)) if (!PHASES.includes(k)) err(`checks.${k} is not a phase. Use ${PHASES.join(', ')}.`);
const checkLists = {};
for (const phase of PHASES) {
  const list = checks[phase] ?? [];
  if (!isNameList(list, /^[A-Za-z0-9:_.-]+$/)) { err(`checks.${phase} must be a list of npm script names.`); continue; }
  for (const name of list) {
    if (!scripts[name]) err(`checks.${phase}: "${name}" is not a script in package.json.`);
    else if (['build', 'check', 'lint'].includes(name)) err(`checks.${phase}: "${name}" already runs as a standard step — remove it.`);
    else if (PRODUCTION_WRITES.test(scripts[name])) err(`checks.${phase}: "${name}" touches production (${scripts[name]}). A merge gate must be read-only.`);
  }
  checkLists[phase] = list;
}

if ((checkLists.browser ?? []).length && !allDeps.playwright && !allDeps['@playwright/test'])
  err('checks.browser runs the site\'s own Playwright, but neither playwright nor @playwright/test is a dependency.');

const py = cfg.python;
if (py !== undefined) {
  if (typeof py?.version !== 'string' || !/^3\.\d+$/.test(py.version)) err('python.version must be a 3.x version such as "3.11".');
  if (!isNameList(py?.packages ?? [], /^[A-Za-z0-9._-]+(==[A-Za-z0-9.]+)?$/)) err('python.packages must be a list of pip package names, optionally pinned with ==.');
}

for (const f of OLD_KIT_FILES)
  if (existsSync(f)) err(`${f} is a local copy of the old ship-gate kit. Delete it — the central Ship Gate repo is the single source now.`);
for (const f of OWN_LIGHTHOUSE_CONFIGS)
  if (existsSync(f)) err(`${f}: Ship Gate runs Lighthouse now. Move any stricter thresholds into thresholdOverrides in ${configPath}, then delete ${f}.`);
if (existsSync('tests/e2e/smoke.spec.ts')) warn('tests/e2e/smoke.spec.ts looks like the old kit copy. Delete it unless it holds site-specific tests.');

// ── Lighthouse mode: runs after the build, so "all" can see every emitted page ──
function htmlPages(root) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { if (name !== 'server' && name !== '_worker.js') walk(p); continue; }
      if (!name.endsWith('.html')) continue;
      const rel = relative(root, p).split(sep).join('/');
      if (/^404(\.html|\/index\.html)$/.test(rel)) continue; // a 404 page is meant to answer 404
      out.push('/' + rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, ''));
    }
  };
  walk(root);
  return out.sort();
}
function staticRoot() {
  // The Cloudflare adapter emits dist/client; a plain static build emits dist.
  const client = join(distDir, 'client');
  return existsSync(join(distDir, 'index.html')) || !existsSync(client) ? distDir : client;
}
const serveCommand = server === 'static'
  ? `node "${join(HERE, 'serve-static.mjs')}" "${distDir}" ${PORT}`
  : `npm run preview -- --port ${PORT}`;

if (mode === 'lighthouse') {
  if (errors.length) fail();
  let urls = lighthouseUrls;
  if (urls === 'all') {
    const root = staticRoot();
    if (!existsSync(root)) { console.log(`::error::${root} not found — the build must run first.`); process.exit(1); }
    urls = htmlPages(root);
    if (urls.length === 0) { console.log(`::error::No HTML pages found under ${root}.`); process.exit(1); }
  }
  const runs = lighthouseUrls === 'all' ? 1 : 3;
  const lh = {};
  for (const [id, a] of Object.entries(assertions)) {
    const opts = {};
    if (a.minScore !== undefined) opts.minScore = a.minScore;
    if (a.maxNumericValue !== undefined) opts.maxNumericValue = a.maxNumericValue;
    if (runs > 1) opts.aggregationMethod = 'median-run';
    lh[id] = Object.keys(opts).length ? [a.level, opts] : a.level;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'lighthouserc.json'), JSON.stringify({
    ci: {
      collect: {
        startServerCommand: serveCommand,
        startServerReadyPattern: `localhost:${PORT}`,
        url: urls.map((p) => ORIGIN + p),
        numberOfRuns: runs,
        settings: { chromeFlags: '--no-sandbox', blockedUrlPatterns: blocked },
      },
      assert: { assertions: lh },
      // Filesystem only. Temporary public storage would publish every report at a public URL.
      upload: { target: 'filesystem', outputDir: join(OUT, 'reports', 'lighthouse') },
    },
  }, null, 2));
  console.log(`Lighthouse: ${urls.length} URL(s), ${runs} run(s) each.`);
  process.exit(0);
}

// ── Verify mode ──
const pages = cfg.pages;
if (!isPathList(pages) || pages.length === 0)
  err('pages must be a non-empty list of paths starting with "/" — one per key template (home, service/product, contact, article).');
const formPages = cfg.formPages ?? [];
if (!isPathList(formPages)) err('formPages must be a list of paths starting with "/".');
const turnstileEnv = {
  siteKey: cfg.turnstileEnv?.siteKey ?? 'PUBLIC_TURNSTILE_SITE_KEY',
  secretKey: cfg.turnstileEnv?.secretKey ?? 'TURNSTILE_SECRET_KEY',
};
for (const v of Object.values(turnstileEnv))
  if (!/^[A-Z][A-Z0-9_]*$/.test(v)) err(`turnstileEnv name "${v}" is not a valid environment variable name.`);

if (errors.length) fail();

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'package.json'), JSON.stringify({ private: true, type: 'module', devDependencies: TOOLS }, null, 2));
writeFileSync(join(OUT, 'pages.json'), JSON.stringify({ pages, formPages }, null, 2));
writeFileSync(
  join(OUT, 'playwright.config.ts'),
  `// Generated by Ship Gate — do not edit or commit.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: ${JSON.stringify(OUT)},
  outputDir: ${JSON.stringify(join(OUT, 'test-results'))},
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: ${JSON.stringify(join(OUT, 'reports', 'playwright'))} }]],
  use: { baseURL: '${ORIGIN}', trace: 'retain-on-failure' },
  webServer: {
    command: ${JSON.stringify(serveCommand)},
    url: '${ORIGIN}',
    cwd: ${JSON.stringify(SITE)},
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
`,
);
copyFileSync(join(HERE, '..', 'e2e', 'smoke.spec.ts'), join(OUT, 'smoke.spec.ts'));

exportEnv('SHIP_GATE_DIR', OUT);
exportEnv('SHIP_GATE_DIST', distDir);
exportEnv('SHIP_GATE_HAS_LINT', scripts.lint ? '1' : '');
for (const phase of PHASES) exportEnv(`SHIP_GATE_CHECKS_${phase.toUpperCase()}`, checkLists[phase].join(' '));
exportEnv('SHIP_GATE_PYTHON', py?.version ?? '');
exportEnv('SHIP_GATE_PIP', (py?.packages ?? []).join(' '));
exportEnv(turnstileEnv.siteKey, TURNSTILE_TEST_KEYS.siteKey);
exportEnv(turnstileEnv.secretKey, TURNSTILE_TEST_KEYS.secretKey);
const n = (p) => checkLists[p].length;
console.log(`Ship Gate prepared: ${pages.length} page(s), ${formPages.length} form page(s), ` +
  `${n('preBuild') + n('postBuild') + n('browser')} site check(s), server "${server}", config in ${OUT}.`);
