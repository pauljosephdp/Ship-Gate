#!/usr/bin/env node
// Ship Gate — validate the calling site and generate this run's test config.
//
//   node prepare.mjs verify      [config]  → checks contract + config, writes test config
//   node prepare.mjs after-build [config]  → after the build: resolves page lists, writes
//                                            the Lighthouse config and run.json for the checks
//   node prepare.mjs post-deploy [config]  → exports site URL, smoke paths, policies and discovery levels
//
// Run from the site directory (the action's working-directory). Standards live
// HERE, not in site repos. A site may make one stricter freely; it may loosen one
// only with a reason and a restore date (thresholdOverrides, guardExemptions).
// No dependencies: Node built-ins only.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticRoot, indexablePages, escapeRe } from './site-files.mjs';
import { RULES as DISCOVERY_RULES, LEVELS as DISCOVERY_LEVELS, SEARCH_CRAWLERS, CRAWLER_TOKEN, AI_TRAINING_MODES } from './discovery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [modeArg = 'verify', configPath = 'ship-gate.config.json'] = process.argv.slice(2);
const mode = modeArg === 'lighthouse' ? 'after-build' : modeArg; // v1.1 pre-release name
const SITE = process.cwd();
// Generated files live OUTSIDE the site on CI, so `astro check` never type-checks them.
const OUT = process.env.SHIP_GATE_DIR || (process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'ship-gate') : resolve('.ship-gate'));
const PORT = 4321;
const ORIGIN = `http://localhost:${PORT}`;

// ── The standard ──
// Deterministic lab signals fail the build. Throttled performance on a shared
// CI runner moves several points between identical runs (a measured baseline
// moved 89–96 on identical pages), so it warns; a site that wants it to fail raises
// it to "error" in its own config.
// Not asserted:
//   categories:seo — Lighthouse fails robots-txt on the Content-Signal directive
//                    (a deliberate ai-train=no) and is-crawlable on deliberate
//                    noindex pages. The audits that matter are asserted one by one.
//   canonical      — on localhost every canonical points at another origin, so it
//                    always fails. check-structure.mjs checks canonicals instead.
const STANDARD = {
  'categories:accessibility': { level: 'error', minScore: 1 },
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
};
// Audits a v1.x config may still name. They are no longer asserted, so an override is a no-op.
const RETIRED_AUDITS = ['categories:seo', 'canonical'];
const LEVEL_RANK = { warn: 1, error: 2 };
// Other companies' code is blocked in Lighthouse, so a vendor release never moves a site's score.
const BLOCKED_URLS = ['*posthog*', '*hubspot*', '*hsforms*', '*hs-scripts*', '*hs-analytics*', '*clarity.ms*',
  '*googletagmanager*', '*google-analytics*', '*doubleclick.net*', '*connect.facebook.net*', '*hotjar*',
  '*snap.licdn.com*', '*analytics.tiktok.com*', '*/cdn-cgi/*', '*challenges.cloudflare.com*'];
// The tracking vendors' hosts: under consent-before-tracking, none may load before consent.
// Matched on the request's hostname (the host or a subdomain), so a site's own file named
// after a vendor is not a tracker. HubSpot form embeds (hsforms.net, hsforms.com) are forms,
// not tags, as in guards.sh; HubSpot tracking is still caught.
const TRACKER_HOSTS = ['posthog.com', 'hubspot.com', 'hs-scripts.com', 'hs-analytics.net', 'clarity.ms',
  'googletagmanager.com', 'google-analytics.com', 'doubleclick.net', 'connect.facebook.net', 'hotjar.com',
  'hotjar.io', 'snap.licdn.com', 'analytics.tiktok.com'];

// Stack policies: opinions about which vendors a site uses and how. Off by default, so
// the core gate fits any Astro site; a site (or a portfolio) opts in by name.
export const POLICIES = {
  'posthog-server-only': 'PostHog runs server-side only (posthog-node in server paths, EU host, no key in the client)',
  'posthog-hybrid': 'PostHog runs in the browser on every page and on the server (posthog-js or the snippet, plus posthog-node, EU host)',
  'tags-via-zaraz': 'Every third-party tag, GTM included, loads through Cloudflare Zaraz',
  'turnstile-forms': 'Every public form carries Cloudflare Turnstile',
  'workers-builds-only': 'Cloudflare Workers Builds is the only deployer (no Pages config, no Cloudflare tokens in workflows)',
  'market-cn': 'The site serves mainland China: no Google, YouTube, Facebook, X or Gravatar resources, ASCII URLs',
  'rtl-logical-css': 'The site serves right-to-left languages: built CSS uses logical properties, not left/right',
  'consent-before-tracking': 'No tracking cookie or tracker loads before the visitor consents',
  'analytics-always-on': 'Google Analytics (a Zaraz tool in Consent Mode v2) and PostHog (posthog-hybrid) load on every page, with or without consent; neither stores anything until the visitor accepts',
};

// Guards a site may exempt for a while, with a reason and a restore date. A guard
// tied to a policy runs only when the site opts into that policy.
// Never exemptible: committed secrets, and anything that skips the PR gate.
export const GUARDS = {
  'posthog-client': { policy: 'posthog-server-only', what: 'PostHog in the browser (client SDK, snippet, direct use outside server paths, client bundle, browser calls)' },
  'posthog-public-var': { policy: ['posthog-server-only', 'posthog-hybrid'], what: 'PostHog variable with a PUBLIC_ prefix (with posthog-hybrid: a personal key or secret)' },
  'posthog-us-host': { policy: ['posthog-server-only', 'posthog-hybrid'], what: 'PostHog US host' },
  'posthog-env-tag': { policy: ['posthog-server-only', 'posthog-hybrid'], what: 'PostHog events without __DEPLOY_ENV__' },
  'posthog-missing': { policy: 'posthog-hybrid', what: 'PostHog not initialised on every page' },
  'posthog-server': { policy: 'posthog-hybrid', what: 'posthog-node missing, or used outside server paths' },
  'posthog-csp': { policy: 'posthog-hybrid', what: 'a Content-Security-Policy that blocks PostHog' },
  'direct-tags': { policy: 'tags-via-zaraz', what: 'third-party tags loaded directly instead of through Zaraz' },
  turnstile: { policy: 'turnstile-forms', what: 'forms without Turnstile' },
  'pages-config': { policy: 'workers-builds-only', what: 'Pages config instead of Workers' },
  'cloudflare-in-workflows': { policy: 'workers-builds-only', what: 'Cloudflare API token or wrangler write in a workflow' },
  'blocked-in-cn': { policy: 'market-cn', what: 'resources blocked in mainland China' },
  consent: { policy: 'consent-before-tracking', what: 'tracking before consent' },
  'node-pin': { what: 'Node pin missing or below the floor' },
  'public-lighthouse': { what: 'Lighthouse reports in public storage' },
};
const NEVER_EXEMPT = { 'posthog-key': 'a hard-coded PostHog key', 'env-file': 'a committed env file', 'push-to-main': 'a workflow pushing to main' };

const REQUIRED_SCRIPTS = ['check', 'build'];
const REQUIRED_DEV_DEPS = ['@astrojs/check'];
const OLD_KIT_FILES = ['scripts/guards.sh', 'scripts/check-dist.sh'];
const OWN_LIGHTHOUSE_CONFIGS = ['lighthouserc.cjs', 'lighthouserc.js', 'lighthouserc.json', '.lighthouserc.json', '.lighthouserc.js'];
// A gate must never write to production. These fragments in any script it runs fail the contract.
const PRODUCTION_WRITES = new RegExp([
  String.raw`wrangler(@[\d.]+)?\s+(deploy|publish|secret|versions\s+(deploy|upload)|pages\s+deploy|r2\s+object\s+(put|delete)|kv\s+key\s+(put|delete)|kv:key)`,
  String.raw`--remote\b`,
  String.raw`migrations\s+apply\b(?!.*--local)`,
  String.raw`\bd1\s+execute\b(?!.*--local)`,
  String.raw`\bgit\s+push\b`,
  String.raw`indexnow`,
].join('|'), 'i');
// The same, as it appears inside a Node script the npm script runs.
const PRODUCTION_WRITES_IN_CODE = /api\.indexnow\.org|['"]wrangler['"][\s\S]{0,80}['"](deploy|secret|r2|kv|d1)['"]|wrangler\s+(deploy|secret|r2\s+object|kv\s+key|d1\s+execute)/;
// posthog-hybrid builds with this project key, so the browser SDK renders in CI without a real
// key in GitHub. Split so no key-shaped string sits in this file. Never valid at PostHog, and
// every PostHog request is aborted in the browser tests anyway; post-deploy fails if it ships.
const POSTHOG_TEST_KEY = 'ph' + 'c_ShipGateCiOnlyNotARealProjectKey0000000000';
const POSTHOG_EU = { api: 'https://eu.i.posthog.com', assets: 'https://eu-assets.i.posthog.com' };
const TURNSTILE_TEST_KEYS = { siteKey: '1x00000000000000000000AA', secretKey: '1x0000000000000000000000000000000AA' };
const DEFAULT_SECURITY_HEADERS = ['x-content-type-options', 'referrer-policy', 'frame-protection'];
const DEFAULT_REFLOW_WIDTHS = [320, 360, 390];

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
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

if (typeof cfg.siteUrl !== 'string' || !/^https:\/\/[^/]+$/.test(cfg.siteUrl))
  err('siteUrl must be an https origin with no path or trailing slash, e.g. "https://example.com".');
const smokePaths = cfg.smokePaths ?? ['/', '/robots.txt', '/sitemap-index.xml'];
if (!isPathList(smokePaths) || smokePaths.length === 0) err('smokePaths must be a non-empty list of paths starting with "/".');
const policies = cfg.policies ?? [];
if (!Array.isArray(policies) || policies.some((p) => !(p in POLICIES)))
  err(`policies must be a list drawn from: ${Object.keys(POLICIES).join(', ')}.`);
const policyOn = (p) => Array.isArray(policies) && policies.includes(p);
if (policyOn('posthog-server-only') && policyOn('posthog-hybrid'))
  err('policies: posthog-server-only and posthog-hybrid contradict each other (no PostHog in the browser vs PostHog on every page). Keep one.');

// ── PostHog in the browser and on the server (posthog-hybrid) ──
const posthogCfg = cfg.posthog ?? {};
const hybrid = policyOn('posthog-hybrid');
if (typeof posthogCfg !== 'object' || Array.isArray(posthogCfg)) err('posthog must be an object, e.g. { "embed": "npm" }.');
else for (const k of Object.keys(posthogCfg)) if (!['embed', 'cookieless', 'apiHost'].includes(k)) err(`posthog.${k} is not a setting. Use embed, cookieless, apiHost.`);
if (cfg.posthog !== undefined && !hybrid) warn('posthog settings are only used by the posthog-hybrid policy. Add the policy or remove them.');
const posthog = {
  embed: posthogCfg.embed ?? 'snippet',
  cookieless: posthogCfg.cookieless ?? 'on_reject',
  apiHost: typeof posthogCfg.apiHost === 'string' ? posthogCfg.apiHost.replace(/\/+$/, '') : posthogCfg.apiHost ?? POSTHOG_EU.api,
};
if (!['snippet', 'npm'].includes(posthog.embed)) err('posthog.embed must be "snippet" (the Astro guide\'s inline loader) or "npm" (posthog-js bundled).');
if (!['on_reject', 'always', 'off'].includes(posthog.cookieless)) err('posthog.cookieless must be "on_reject" (the default), "always" or "off".');
// EU Cloud, or a same-origin path the site proxies to it.
if (!(posthog.apiHost === POSTHOG_EU.api || (typeof posthog.apiHost === 'string' && /^\/[A-Za-z0-9._~\/-]+$/.test(posthog.apiHost))))
  err(`posthog.apiHost must be "${POSTHOG_EU.api}" (EU Cloud) or a same-origin proxy path such as "/ph".`);
if (hybrid && posthog.cookieless === 'off' && policyOn('consent-before-tracking'))
  err('posthog.cookieless "off" sets PostHog cookies before consent, which consent-before-tracking forbids. Use "on_reject" (cookieless until the visitor accepts) or "always".');
// ── Analytics on every page (analytics-always-on) ──
// Google Analytics runs as a Zaraz tool, sent from Cloudflare's edge through the site's own
// /cdn-cgi/zaraz/, so a browser request to a Google host is still a direct tag and _ga before
// consent still fails the consent test: Consent Mode keeps GA cookieless until the visitor accepts.
const alwaysOn = policyOn('analytics-always-on');
if (alwaysOn && !hybrid)
  err('policies: analytics-always-on needs posthog-hybrid (PostHog in the browser on every page). Add it.');
if (alwaysOn && !policyOn('tags-via-zaraz'))
  err('policies: analytics-always-on needs tags-via-zaraz (Google Analytics runs as a Zaraz tool, in Consent Mode). Add it.');
if (alwaysOn && hybrid && posthog.cookieless === 'off')
  err('posthog.cookieless "off" sets PostHog cookies from the first page view; analytics-always-on loads PostHog before consent only because it stores nothing. Use "on_reject" or "always".');
const posthogHosts = typeof posthog.apiHost === 'string' && posthog.apiHost.startsWith('/') ? [] : ['posthog.com'];
// Other search engines' crawlers the site must admit, on top of Googlebot and Bingbot.
const searchCrawlers = cfg.discovery?.searchCrawlers ?? [];
if (!isNameList(searchCrawlers, CRAWLER_TOKEN))
  err('discovery.searchCrawlers must be a list of crawler tokens such as "Baiduspider", "Yeti" or "YandexBot".');
else for (const c of searchCrawlers) if (SEARCH_CRAWLERS.some((b) => b.toLowerCase() === c.toLowerCase()))
  err(`discovery.searchCrawlers: ${c} is always checked — remove it.`);

// ── Discovery rules (SEO, AEO, GEO, AIO): raising a level is free; lowering needs a reason and a date ──
const discoveryLevels = Object.fromEntries(Object.entries(DISCOVERY_RULES).map(([k, r]) => [k, r.level]));
const dOverrides = cfg.discoveryOverrides ?? [];
if (!Array.isArray(dOverrides)) err('discoveryOverrides must be a list.');
for (const [i, o] of (Array.isArray(dOverrides) ? dOverrides : []).entries()) {
  const where = `discoveryOverrides[${i}] (${o?.rule ?? '?'})`;
  if (!(o?.rule in DISCOVERY_RULES)) { err(`${where}: rule must be one of ${Object.keys(DISCOVERY_RULES).join(', ')}.`); continue; }
  if (!(o.level in DISCOVERY_LEVELS)) { err(`${where}: level must be "error", "warn" or "off".`); continue; }
  const std = DISCOVERY_RULES[o.rule].level;
  if (o.level === std) { err(`${where}: changes nothing — remove it.`); continue; }
  if (DISCOVERY_LEVELS[o.level] < DISCOVERY_LEVELS[std]) {
    if (!checkLoosening(where, o)) continue;
    warn(`Discovery rule ${o.rule} lowered to ${o.level} until ${o.restoreBy}: ${o.reason}`);
  } else console.log(`Discovery rule ${o.rule} raised to ${o.level} by this site.`);
  discoveryLevels[o.rule] = o.level;
}
const discovery = cfg.discovery ?? {};
for (const k of Object.keys(discovery)) if (!['sitemap', 'ignoreLinks', 'searchCrawlers', 'aiTraining'].includes(k)) err(`discovery.${k} is not a setting. Use sitemap, ignoreLinks, searchCrawlers, aiTraining.`);
// AI training is off by default: "block" disallows the training crawlers, "reserve" lets
// them fetch under Content-Signal ai-train=no, "allow" opts in. Every other crawler is always allowed.
const aiTraining = discovery.aiTraining ?? 'block';
if (!AI_TRAINING_MODES.includes(aiTraining)) err(`discovery.aiTraining must be ${AI_TRAINING_MODES.map((m) => `"${m}"`).join(', ').replace(/, ([^,]*)$/, ' or $1')} (default "block").`);
if (discovery.sitemap !== undefined && !(typeof discovery.sitemap === 'string' && /^\/\S+\.xml$/.test(discovery.sitemap)))
  err('discovery.sitemap must be the sitemap\'s path, e.g. "/sitemap-index.xml".');
if (discovery.ignoreLinks !== undefined && !isPathList(discovery.ignoreLinks))
  err('discovery.ignoreLinks must be a list of path prefixes served by the Worker, not the static build, e.g. "/api/".');

if (mode === 'post-deploy') {
  if (errors.length) fail();
  exportEnv('SHIP_GATE_SITE_URL', cfg.siteUrl);
  exportEnv('SHIP_GATE_SMOKE_PATHS', smokePaths.join(' '));
  exportEnv('SHIP_GATE_POLICIES', policies.join(' '));
  exportEnv('SHIP_GATE_DISCOVERY_LEVELS', JSON.stringify(discoveryLevels));
  exportEnv('SHIP_GATE_SEARCH_CRAWLERS', searchCrawlers.join(' '));
  exportEnv('SHIP_GATE_AI_TRAINING', aiTraining);
  if (hybrid) {
    exportEnv('SHIP_GATE_POSTHOG_API_HOST', posthog.apiHost);
    exportEnv('SHIP_GATE_POSTHOG_TEST_KEY', POSTHOG_TEST_KEY);
  }
  console.log('Post-deploy config loaded.');
  process.exit(0);
}
if (mode !== 'verify' && mode !== 'after-build') {
  console.log(`::error::Unknown mode "${modeArg}". Use "verify", "after-build" or "post-deploy".`);
  process.exit(1);
}

const server = cfg.server ?? 'static';
if (!['static', 'preview'].includes(server)) err('server must be "static" (serve the built files) or "preview" (npm run preview).');
const distDir = typeof cfg.distDir === 'string' ? cfg.distDir.replace(/\/+$/, '') || '.' : cfg.distDir ?? 'dist';
if (typeof distDir !== 'string' || distDir.startsWith('/') || distDir.split(/[\\/]/).includes('..') || !/^[A-Za-z0-9._/-]+$/.test(distDir))
  err('distDir must be a relative path inside the site directory, e.g. "dist".');

const pagesList = (v) => v === 'all' || (isPathList(v) && v.length > 0);
const lighthouseUrls = cfg.lighthouseUrls ?? cfg.pages;
if (!pagesList(lighthouseUrls))
  err('lighthouseUrls must be "all" (every indexable page the build emits) or a non-empty list of paths starting with "/".');
const e2ePages = cfg.e2ePages ?? cfg.pages;
if (!pagesList(e2ePages)) err('e2ePages must be "all" (every indexable page the build emits) or a non-empty list of paths starting with "/".');
const extraBlocked = cfg.lighthouseBlockedUrls ?? [];
if (!isNameList(extraBlocked, /^\S+$/)) err('lighthouseBlockedUrls must be a list of URL patterns such as "*/relay/*".');
const blocked = [...BLOCKED_URLS, ...(Array.isArray(extraBlocked) ? extraBlocked.filter((s) => typeof s === 'string') : []),
  // A same-origin PostHog proxy is still PostHog: keep it out of the measurement too.
  ...(hybrid && typeof posthog.apiHost === 'string' && posthog.apiHost.startsWith('/') ? [`*${posthog.apiHost}/*`] : [])];

// Structure bands and the other post-build inputs. Only stricter-or-equal choices exist here,
// so none of them needs a reason.
const structure = { titleMax: 75, ...(cfg.structure ?? {}) };
for (const [k, v] of Object.entries(structure)) {
  if (!['titleMin', 'titleMax', 'descMin', 'descMax'].includes(k)) err(`structure.${k} is not a setting. Use titleMin, titleMax, descMin, descMax.`);
  else if (!Number.isInteger(v) || v < 1 || v > 400) err(`structure.${k} must be a whole number of characters.`);
}
if (structure.titleMax > 75) err('structure.titleMax cannot be above 75 — longer titles are truncated in results.');
const copyAllowlist = cfg.copyAllowlist ?? [];
if (!isNameList(copyAllowlist, /\S/)) err('copyAllowlist must be a list of exact strings such as "[Your Name]".');
const securityHeaders = cfg.securityHeaders ?? DEFAULT_SECURITY_HEADERS;
if (!isNameList(securityHeaders, /^[a-z0-9-]+$/)) err('securityHeaders must be a list of lower-case header names (or "frame-protection").');
else for (const h of DEFAULT_SECURITY_HEADERS) if (!securityHeaders.includes(h)) err(`securityHeaders must keep "${h}" — add to the list, never remove from it.`);
const reflowWidths = cfg.reflowWidths ?? DEFAULT_REFLOW_WIDTHS;
if (!Array.isArray(reflowWidths) || !reflowWidths.every((w) => Number.isInteger(w) && w >= 280 && w <= 1440) || !reflowWidths.includes(320))
  err('reflowWidths must be a list of viewport widths in px that includes 320 (WCAG 1.4.10).');
// Keyboard operability warns by default while sites adopt it; a site may raise it to error.
const keyboard = cfg.keyboard ?? 'warn';
if (!['warn', 'error'].includes(keyboard)) err('keyboard must be "warn" (the default) or "error".');
const consentEssentialCookies = cfg.consentEssentialCookies ?? [];
if (!isNameList(consentEssentialCookies, /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/))
  err('consentEssentialCookies must be a list of cookie names, e.g. "session" or "cf_clearance".');
else if (consentEssentialCookies.length && !policyOn('consent-before-tracking'))
  warn('consentEssentialCookies lists cookies, but only the consent-before-tracking policy uses it. Add the policy or remove the list.');

// ── Assertions: stricter is always allowed; looser needs a reason and a restore date ──
function strictness(std, o) {
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

// A loosening (threshold or guard) needs a real reason and a restore date in the future.
function checkLoosening(where, o) {
  if (typeof o.reason !== 'string' || o.reason.trim().length < 10) { err(`${where}: loosening the standard needs a real reason (at least 10 characters).`); return false; }
  if (!isDate(o.restoreBy)) { err(`${where}: loosening the standard needs restoreBy as a YYYY-MM-DD date.`); return false; }
  if (o.restoreBy < today) { err(`${where}: expired on ${o.restoreBy}. Fix it and remove the entry, or renew it with a new reason and date.`); return false; }
  return true;
}

const assertions = {};
for (const [id, s] of Object.entries(STANDARD)) assertions[id] = { ...s };
const overrides = cfg.thresholdOverrides ?? [];
if (!Array.isArray(overrides)) err('thresholdOverrides must be a list.');
for (const [i, o] of (Array.isArray(overrides) ? overrides : []).entries()) {
  // v1 configs named categories directly ("performance"); accept that form.
  const id = o?.audit ?? (o?.category ? `categories:${o.category}` : undefined);
  const where = `thresholdOverrides[${i}] (${id ?? '?'})`;
  if (RETIRED_AUDITS.includes(id)) { warn(`${where}: Ship Gate no longer asserts ${id}, so this override does nothing. Remove it.`); continue; }
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
    if (!checkLoosening(where, o)) continue;
    warn(`Lighthouse ${id} loosened until ${o.restoreBy}: ${o.reason}`);
  } else {
    console.log(`Lighthouse ${id} raised above the standard by this site.`);
  }
  for (const k of ['level', 'minScore', 'maxNumericValue']) if (o[k] !== undefined) assertions[id][k] = o[k];
}

// ── Guard exemptions ──
const exempt = [];
const exemptions = cfg.guardExemptions ?? [];
if (!Array.isArray(exemptions)) err('guardExemptions must be a list.');
for (const [i, x] of (Array.isArray(exemptions) ? exemptions : []).entries()) {
  const where = `guardExemptions[${i}] (${x?.guard ?? '?'})`;
  if (x?.guard in NEVER_EXEMPT) { err(`${where}: ${NEVER_EXEMPT[x.guard]} can never be exempted.`); continue; }
  if (!(x?.guard in GUARDS)) { err(`${where}: guard must be one of ${Object.keys(GUARDS).join(', ')}.`); continue; }
  const pol = [GUARDS[x.guard].policy ?? []].flat();
  if (pol.length && !pol.some(policyOn)) { err(`${where}: this guard belongs to the "${pol.join('" or "')}" policy, which this site does not use, so the exemption changes nothing — remove it.`); continue; }
  if (!checkLoosening(where, x)) continue;
  warn(`Guard "${x.guard}" (${GUARDS[x.guard].what}) exempted until ${x.restoreBy}: ${x.reason}`);
  exempt.push(x.guard);
}

// ── Repo contract ──
let pkg = {};
try { pkg = JSON.parse(readFileSync('package.json', 'utf8')); } catch { err(`package.json missing or invalid in ${SITE}.`); }
const scripts = pkg.scripts ?? {};
const required = server === 'preview' ? [...REQUIRED_SCRIPTS, 'preview'] : REQUIRED_SCRIPTS;
for (const s of required) if (!scripts[s]) err(`package.json is missing the "${s}" script (Ship Gate calls it by that name).`);
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const d of REQUIRED_DEV_DEPS) if (!allDeps[d]) err(`Missing dev dependency ${d} (npm run check needs it). Run: npm i -D ${d}`);

// What a script really runs: its own text, the pre/post scripts npm runs around it,
// every package script it calls (npm, pnpm, yarn, run-s, run-p, npm-run-all), and
// the Node and shell files it starts. Returns the offending fragment, or null.
const scriptNames = (pattern) => pattern.includes('*')
  ? Object.keys(scripts).filter((n) => globRe(pattern).test(n)) : [pattern];
function globRe(glob) { return new RegExp('^' + glob.split('*').map(escapeRe).join('[^:]*') + '$'); }
function productionWrite(name, seen = new Set()) {
  if (seen.has(name) || scripts[name] === undefined) return null;
  seen.add(name);
  const body = scripts[name];
  const direct = body.match(PRODUCTION_WRITES);
  if (direct) return `"${name}": ${direct[0]}`;
  const called = [`pre${name}`, `post${name}`];
  for (const m of body.matchAll(/\b(?:npm|pnpm|yarn)\s+(?:run(?:-script)?\s+)?(?:(?:-[\w-]+)\s+)*([A-Za-z0-9:_.-]+)/g)) called.push(m[1]);
  for (const m of body.matchAll(/\b(?:run-s|run-p|npm-run-all)\b((?:\s+(?!&&|\|\||;)[^\s;&|]+)+)/g))
    for (const arg of m[1].trim().split(/\s+/)) if (!arg.startsWith('-')) called.push(...scriptNames(arg));
  for (const c of called) {
    const inner = productionWrite(c, seen);
    if (inner) return inner;
  }
  for (const m of body.matchAll(/\b(?:node|tsx)\s+(?:--[\w-]+(?:=\S+)?\s+)*([\w./-]+\.(?:m?js|cjs|ts|mts))/g)) {
    if (!existsSync(m[1])) continue;
    const hit = jsCode(readFileSync(m[1], 'utf8')).match(PRODUCTION_WRITES_IN_CODE);
    if (hit) return `"${name}" runs ${m[1]}, which contains ${hit[0].slice(0, 60)}`;
  }
  for (const m of body.matchAll(/(?:\b(?:bash|sh|zsh)\s+(?:-\w+\s+)*|(?:^|[\s;&|(])(?=\.{0,2}\/))([\w./-]+\.(?:sh|bash))\b/g)) {
    if (!existsSync(m[1])) continue;
    const code = shellCode(readFileSync(m[1], 'utf8'));
    const hit = code.match(PRODUCTION_WRITES) ?? code.match(PRODUCTION_WRITES_IN_CODE);
    if (hit) return `"${name}" runs ${m[1]}, which contains ${hit[0].slice(0, 60)}`;
  }
  return null;
}
// A file's code without its comments, so prose that names a command ("`wrangler deploy`
// reads this") never reads as the command. Conservative: strings, template literals and
// regex literals are kept whole, and "//" after ":" (a URL) is never a comment.
function jsCode(src) {
  let out = '', i = 0, prev = '';
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); const skip = end < 0 ? src.slice(i) : src.slice(i, end + 2);
      out += skip.replace(/[^\n]/g, ''); i += skip.length; continue; }
    if (c === '/' && n === '/' && src[i - 1] !== ':') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"' || c === "'" || c === '`' || (c === '/' && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prev))) {
      // A string or regex runs to its closing quote; ' and " strings and regexes end at a newline.
      let j = i + 1, inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n' && c !== '`') break;
        if (c === '/' && d === '[') inClass = true;
        else if (c === '/' && d === ']') inClass = false;
        else if (d === c && !inClass) { j++; break; }
        j++;
      }
      out += src.slice(i, j); prev = c === '/' ? 'x' : c; i = j; continue;
    }
    out += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return out;
}
// Shell: whole-line comments, and trailing " # …" comments outside quotes.
const shellCode = (src) => src.split('\n').map((line) => {
  if (/^\s*#/.test(line)) return '';
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && /\s/.test(line[i - 1] ?? '')) return line.slice(0, i);
  }
  return line;
}).join('\n');
// Everything CI runs: the scripts it calls by name, and the lifecycle scripts npm ci runs.
for (const s of ['preinstall', 'install', 'postinstall', 'prepare', 'build', 'check', 'lint', 'test',
  ...(server === 'preview' ? ['preview'] : [])]) {
  const w = productionWrite(s);
  if (w) err(`The "${s}" script writes to production (${w}). CI runs it on every PR; move deploys, remote migrations and submissions out of it.`);
}

// Site-specific checks: npm scripts the gate runs by name. Never ones that touch production.
const checks = cfg.checks ?? {};
const PHASES = ['preBuild', 'postBuild', 'browser'];
for (const k of Object.keys(checks)) if (!PHASES.includes(k)) err(`checks.${k} is not a phase. Use ${PHASES.join(', ')}.`);
const checkLists = {};
for (const phase of PHASES) {
  const list = checks[phase] ?? [];
  checkLists[phase] = [];
  if (!isNameList(list, /^[A-Za-z0-9:_.-]+$/)) { err(`checks.${phase} must be a list of npm script names.`); continue; }
  for (const name of list) {
    if (!scripts[name]) { err(`checks.${phase}: "${name}" is not a script in package.json.`); continue; }
    if (['build', 'check', 'lint'].includes(name)) { err(`checks.${phase}: "${name}" already runs as a standard step — remove it.`); continue; }
    const w = productionWrite(name);
    if (w) { err(`checks.${phase}: "${name}" touches production (${w}). A merge gate must be read-only.`); continue; }
    checkLists[phase].push(name);
  }
}

if (checkLists.browser.length && !allDeps.playwright && !allDeps['@playwright/test'])
  err('checks.browser runs the site\'s own Playwright, but neither playwright nor @playwright/test is a dependency.');

const py = cfg.python;
if (py !== undefined) {
  if (typeof py?.version !== 'string' || !/^3\.\d+$/.test(py.version)) err('python.version must be a 3.x version such as "3.11".');
  if (!isNameList(py?.packages ?? [], /^[A-Za-z0-9._-]+(==[A-Za-z0-9.]+)?$/)) err('python.packages must be a list of pip package names, optionally pinned with ==.');
  else for (const p of py?.packages ?? []) if (!p.includes('==')) warn(`python.packages: pin ${p} with ==, or a new release can turn the gate red overnight.`);
}

for (const f of OLD_KIT_FILES)
  if (existsSync(f)) err(`${f} is a local copy of the old ship-gate kit. Delete it — the central Ship Gate repo is the single source now.`);
for (const f of OWN_LIGHTHOUSE_CONFIGS)
  if (existsSync(f)) err(`${f}: Ship Gate runs Lighthouse now. Move any stricter thresholds into thresholdOverrides in ${configPath}, then delete ${f}.`);
if (existsSync('tests/e2e/smoke.spec.ts')) warn('tests/e2e/smoke.spec.ts looks like the old kit copy. Delete it unless it holds site-specific tests.');

const pages = cfg.pages;
if (!isPathList(pages) || pages.length === 0)
  err('pages must be a non-empty list of paths starting with "/" — one per key template (home, service/product, contact, article).');
const formPages = cfg.formPages ?? [];
if (!isPathList(formPages)) err('formPages must be a list of paths starting with "/".');
const turnstile = policyOn('turnstile-forms');
if (!turnstile && formPages.length) warn('formPages lists pages, but only the turnstile-forms policy uses it. Add the policy or remove the list.');
const turnstileEnv = {
  siteKey: cfg.turnstileEnv?.siteKey ?? 'PUBLIC_TURNSTILE_SITE_KEY',
  secretKey: cfg.turnstileEnv?.secretKey ?? 'TURNSTILE_SECRET_KEY',
};
for (const v of Object.values(turnstileEnv))
  if (!/^[A-Z][A-Z0-9_]*$/.test(v)) err(`turnstileEnv name "${v}" is not a valid environment variable name.`);

const serveCommand = server === 'static'
  ? `node "${join(HERE, 'serve-static.mjs')}" "${distDir}" ${PORT}`
  : `npm run preview -- --port ${PORT}`;

if (errors.length) fail();

// ── After-build mode: page lists can now see every emitted page ──
if (mode === 'after-build') {
  const root = staticRoot(distDir);
  if (!existsSync(root)) { console.log(`::error::${root} not found — the build must run first.`); process.exit(1); }
  const all = indexablePages(root).map((p) => p.path);
  const resolvePages = (v, label) => {
    if (v !== 'all') return v;
    if (all.length === 0) { console.log(`::error::${label}: no indexable HTML pages found under ${root}.`); process.exit(1); }
    return all;
  };
  const lhUrls = resolvePages(lighthouseUrls, 'lighthouseUrls');
  // SHIP_GATE_LIGHTHOUSE_RUNS (the action's lighthouse-runs input) overrides the count: pull
  // requests use 1, since performance only warns and the other categories are deterministic.
  const runsEnv = process.env.SHIP_GATE_LIGHTHOUSE_RUNS ?? '';
  if (runsEnv !== '' && !/^[1-5]$/.test(runsEnv)) { console.log(`::error::lighthouse-runs must be a number from 1 to 5, got "${runsEnv}".`); process.exit(1); }
  const runs = runsEnv !== '' ? Number(runsEnv) : lighthouseUrls === 'all' ? 1 : 3;
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
        url: lhUrls.map((p) => ORIGIN + p),
        numberOfRuns: runs,
        settings: { chromeFlags: '--no-sandbox --headless=new', blockedUrlPatterns: blocked },
      },
      assert: { assertions: lh },
      // Filesystem only. Temporary public storage would publish every report at a public URL.
      upload: { target: 'filesystem', outputDir: join(OUT, 'reports', 'lighthouse') },
    },
  }, null, 2));
  // run.json: everything the post-build scans and Playwright specs need.
  writeFileSync(join(OUT, 'run.json'), JSON.stringify({
    siteUrl: cfg.siteUrl,
    root: resolve(root),
    pages: resolvePages(e2ePages, 'e2ePages'),
    formPages,
    structure,
    copyAllowlist,
    securityHeaders,
    reflowWidths,
    exempt,
    policies,
    keyboard,
    consentEssentialCookies,
    // Cookieless PostHog may load before consent (posthog-hybrid); the consent test then
    // checks that it writes no cookie or storage until the visitor accepts.
    trackerHosts: hybrid && posthog.cookieless !== 'off' ? TRACKER_HOSTS.filter((h) => h !== 'posthog.com') : TRACKER_HOSTS,
    posthog: hybrid ? { ...posthog, hosts: posthogHosts, testKey: POSTHOG_TEST_KEY, assetsHost: POSTHOG_EU.assets } : null,
    discovery: { levels: discoveryLevels, sitemap: discovery.sitemap, ignoreLinks: discovery.ignoreLinks ?? [], searchCrawlers, aiTraining },
  }, null, 2));
  console.log(`Ship Gate after build: ${all.length} indexable page(s) in ${root}; Lighthouse ${lhUrls.length} URL(s) × ${runs} run(s).`);
  process.exit(0);
}

// ── Verify mode ──
mkdirSync(OUT, { recursive: true });
// Ship Gate's own test tooling, pinned by its lockfile. Sites don't carry these dependencies.
for (const f of ['package.json', 'package-lock.json']) copyFileSync(join(HERE, '..', 'tools', f), join(OUT, f));
for (const f of ['smoke.spec.ts', 'reflow.spec.ts', 'csp.spec.ts', 'edge.spec.ts', 'keyboard.spec.ts', 'consent.spec.ts', 'helpers.ts']) copyFileSync(join(HERE, '..', 'e2e', f), join(OUT, f));
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
`,
);

exportEnv('SHIP_GATE_DIR', OUT);
exportEnv('SHIP_GATE_DIST', distDir);
exportEnv('SHIP_GATE_SERVE', serveCommand);
exportEnv('SHIP_GATE_HAS_LINT', scripts.lint ? '1' : '');
exportEnv('SHIP_GATE_HAS_TEST', scripts.test && !Object.values(checkLists).flat().includes('test') ? '1' : '');
for (const phase of PHASES) exportEnv(`SHIP_GATE_CHECKS_${phase.toUpperCase()}`, checkLists[phase].join(' '));
exportEnv('SHIP_GATE_PYTHON', py?.version ?? '');
exportEnv('SHIP_GATE_PIP', (py?.packages ?? []).join(' '));
exportEnv('SHIP_GATE_EXEMPT', exempt.join(' '));
exportEnv('SHIP_GATE_POLICIES', policies.join(' '));
if (hybrid) {
  exportEnv('PUBLIC_POSTHOG_KEY', POSTHOG_TEST_KEY);
  exportEnv('SHIP_GATE_POSTHOG_EMBED', posthog.embed);
}
if (turnstile) {
  exportEnv(turnstileEnv.siteKey, TURNSTILE_TEST_KEYS.siteKey);
  exportEnv(turnstileEnv.secretKey, TURNSTILE_TEST_KEYS.secretKey);
  exportEnv('SHIP_GATE_TURNSTILE_SECRET', turnstileEnv.secretKey);
}
const n = (p) => checkLists[p].length;
console.log(`Ship Gate prepared: ${pages.length} key page(s), ${formPages.length} form page(s), ` +
  `${n('preBuild') + n('postBuild') + n('browser')} site check(s), server "${server}", ` +
  `policies: ${policies.length ? policies.join(', ') : 'none'}, config in ${OUT}.`);
