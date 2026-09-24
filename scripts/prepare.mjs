#!/usr/bin/env node
// Ship Gate — validate the calling repo and generate this run's test config.
//
//   node prepare.mjs verify      [config]   → checks contract, writes .ship-gate/*
//   node prepare.mjs post-deploy [config]   → exports site URL + smoke paths
//
// Thresholds live HERE, not in site repos. A site may lower one only through
// thresholdOverrides in ship-gate.config.json, with a reason and a restore date.
// No dependencies: Node built-ins only.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [mode = 'verify', configPath = 'ship-gate.config.json'] = process.argv.slice(2);

const THRESHOLDS = {
  performance: { minScore: 0.9, level: 'error' },
  accessibility: { minScore: 0.95, level: 'error' },
  seo: { minScore: 0.95, level: 'error' },
  'best-practices': { minScore: 0.9, level: 'warn' },
};
const REQUIRED_SCRIPTS = ['check', 'lint', 'build', 'preview'];
const REQUIRED_DEV_DEPS = ['@astrojs/check', '@playwright/test', '@axe-core/playwright', '@lhci/cli'];
// Old per-repo kit copies. The central Ship Gate owns these now; a local copy would drift.
const RETIRED_KIT_FILES = ['scripts/guards.sh', 'scripts/check-dist.sh', 'lighthouserc.cjs'];
const TURNSTILE_TEST_KEYS = {
  siteKey: '1x00000000000000000000AA',
  secretKey: '1x0000000000000000000000000000000AA',
};

const errors = [];
const err = (m) => errors.push(m);
const warn = (m) => console.log(`::warning::${m}`);
const today = new Date().toISOString().slice(0, 10);

function exportEnv(name, value) {
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
  else console.log(`(local) ${name}=${value}`);
}

// ── Config ────────────────────────────────────────────────────────────────
if (!existsSync(configPath)) {
  console.log(`::error::${configPath} not found. Copy templates/caller/ship-gate.config.json from the Ship Gate repo.`);
  process.exit(1);
}
let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  console.log(`::error::${configPath} is not valid JSON: ${e.message}`);
  process.exit(1);
}

const isPathList = (v) => Array.isArray(v) && v.every((p) => typeof p === 'string' && p.startsWith('/'));

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
if (mode !== 'verify') {
  console.log(`::error::Unknown mode "${mode}". Use "verify" or "post-deploy".`);
  process.exit(1);
}

const pages = cfg.pages;
if (!isPathList(pages) || pages.length === 0)
  err('pages must be a non-empty list of paths starting with "/" — one per key template (home, service/product, contact, article).');
const formPages = cfg.formPages ?? [];
if (!isPathList(formPages)) err('formPages must be a list of paths starting with "/".');
const lighthouseUrls = cfg.lighthouseUrls ?? pages;
if (!isPathList(lighthouseUrls) || lighthouseUrls.length === 0) err('lighthouseUrls must be a non-empty list of paths starting with "/".');

const turnstileEnv = {
  siteKey: cfg.turnstileEnv?.siteKey ?? 'PUBLIC_TURNSTILE_SITE_KEY',
  secretKey: cfg.turnstileEnv?.secretKey ?? 'TURNSTILE_SECRET_KEY',
};
for (const v of Object.values(turnstileEnv))
  if (!/^[A-Z][A-Z0-9_]*$/.test(v)) err(`turnstileEnv name "${v}" is not a valid environment variable name.`);

// ── Threshold overrides: reason + restore date, never silent, never permanent ──
const assertions = {};
for (const [cat, t] of Object.entries(THRESHOLDS)) assertions[cat] = { ...t };
for (const o of cfg.thresholdOverrides ?? []) {
  const where = `thresholdOverrides[${o?.category ?? '?'}]`;
  if (!o || !(o.category in THRESHOLDS)) { err(`${where}: category must be one of ${Object.keys(THRESHOLDS).join(', ')}.`); continue; }
  if (typeof o.minScore !== 'number' || o.minScore <= 0 || o.minScore >= THRESHOLDS[o.category].minScore)
    err(`${where}: minScore must be a number above 0 and below the standard ${THRESHOLDS[o.category].minScore}.`);
  if (typeof o.reason !== 'string' || o.reason.trim().length < 10) err(`${where}: a real reason is required (at least 10 characters).`);
  if (typeof o.restoreBy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.restoreBy) || isNaN(Date.parse(o.restoreBy)))
    err(`${where}: restoreBy must be a date in YYYY-MM-DD form.`);
  else if (o.restoreBy < today)
    err(`${where}: override expired on ${o.restoreBy}. Restore the ${THRESHOLDS[o.category].minScore} standard, or renew with a new reason and date.`);
  else {
    assertions[o.category].minScore = o.minScore;
    warn(`Lighthouse ${o.category} lowered to ${o.minScore} until ${o.restoreBy}: ${o.reason}`);
  }
}

// ── Repo contract ─────────────────────────────────────────────────────────
let pkg = {};
try { pkg = JSON.parse(readFileSync('package.json', 'utf8')); } catch { err('package.json missing or invalid.'); }
for (const s of REQUIRED_SCRIPTS) if (!pkg.scripts?.[s]) err(`package.json is missing the "${s}" script (standard names are required; CI calls them).`);
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const d of REQUIRED_DEV_DEPS) if (!allDeps[d]) err(`Missing dev dependency ${d}. Run: npm i -D ${REQUIRED_DEV_DEPS.join(' ')}`);
for (const f of RETIRED_KIT_FILES)
  if (existsSync(f)) err(`${f} is a local copy of the old ship-gate kit. Delete it — the central Ship Gate repo is the single source now.`);
if (existsSync('tests/e2e/smoke.spec.ts')) warn('tests/e2e/smoke.spec.ts looks like the old kit copy. Delete it unless it holds site-specific tests.');

function fail() {
  for (const e of errors) console.log(`::error::${e}`);
  console.log(`Ship Gate: ${errors.length} problem(s) — see above.`);
  process.exit(1);
}
if (errors.length) fail();

// ── Generate this run's config under .ship-gate/ (gitignored) ────────────────
mkdirSync('.ship-gate', { recursive: true });
const PORT = 4321;
const origin = `http://localhost:${PORT}`;

writeFileSync('.ship-gate/pages.json', JSON.stringify({ pages, formPages }, null, 2));

const lhAssertions = {};
for (const [cat, t] of Object.entries(assertions))
  lhAssertions[`categories:${cat}`] = [t.level, { minScore: t.minScore, aggregationMethod: 'median-run' }];
writeFileSync(
  '.ship-gate/lighthouserc.json',
  JSON.stringify(
    {
      ci: {
        collect: {
          startServerCommand: `npm run preview -- --port ${PORT}`,
          startServerReadyPattern: `localhost:${PORT}`,
          url: lighthouseUrls.map((p) => origin + p),
          numberOfRuns: 3,
        },
        assert: { assertions: lhAssertions },
        upload: { target: 'filesystem', outputDir: '.lighthouseci' },
      },
    },
    null,
    2,
  ),
);

writeFileSync(
  '.ship-gate/playwright.config.ts',
  `// Generated by Ship Gate — do not edit or commit.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  use: { baseURL: '${origin}', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --port ${PORT}',
    url: '${origin}',
    cwd: '..',
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
copyFileSync(join(HERE, '..', 'e2e', 'smoke.spec.ts'), '.ship-gate/smoke.spec.ts');

exportEnv(turnstileEnv.siteKey, TURNSTILE_TEST_KEYS.siteKey);
exportEnv(turnstileEnv.secretKey, TURNSTILE_TEST_KEYS.secretKey);
console.log(`Ship Gate prepared: ${pages.length} page(s), ${formPages.length} form page(s), ${lighthouseUrls.length} Lighthouse URL(s).`);
