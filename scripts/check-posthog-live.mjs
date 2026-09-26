#!/usr/bin/env node
// Ship Gate post-deploy (posthog-hybrid): production's home page starts PostHog with a live key.
//
//   node check-posthog-live.mjs   (reads SHIP_GATE_SITE_URL, SHIP_GATE_POSTHOG_API_HOST,
//                                  SHIP_GATE_POSTHOG_TEST_KEY; exported by prepare.mjs post-deploy)
//
// Fails when the page carries no PostHog project key, inline or in a same-origin script it
// loads (PUBLIC_POSTHOG_KEY was unset in the production build); when it carries Ship Gate's
// CI key or a personal key (phx_); and when PostHog does not know the key. The key check is
// one read-only GET of the project's remote config, the file every page load fetches.
// With a same-origin proxy (apiHost a path such as "/ph"), it also fetches the session
// replay recorder through the proxy: a 200 with a JavaScript content type, not the site's
// HTML 404 page or a redirect, proves the proxy reaches PostHog's assets host.
// No dependencies: Node built-ins only.

const site = process.env.SHIP_GATE_SITE_URL;
const apiHost = process.env.SHIP_GATE_POSTHOG_API_HOST || 'https://eu.i.posthog.com';
const testKey = process.env.SHIP_GATE_POSTHOG_TEST_KEY;
const KEY = /ph[cx]_[A-Za-z0-9]{20,}/g;
const fail = (m) => { console.log(`::error::${m}`); process.exit(1); };

async function text(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

let html;
try { html = await text(`${site}/`); } catch (e) { fail(`Could not fetch production HTML to check PostHog: ${e.message}.`); }

// The page, then its same-origin scripts and the modules they import (the npm embed bundles the key).
const seen = new Set();
let all = html;
const queue = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)].map((m) => new URL(m[1] ?? m[2] ?? m[3], `${site}/`).href);
while (queue.length && seen.size < 40) {
  const url = queue.shift();
  if (seen.has(url) || new URL(url).origin !== new URL(site).origin) continue;
  seen.add(url);
  let js;
  try { js = await text(url); } catch { continue; }
  all += `\n${js}`;
  for (const m of js.matchAll(/(?:import|export)\s*(?:[^'"()]*?\bfrom\s*)?["']([^"']+\.m?js)["']|import\(\s*["']([^"']+\.m?js)["']\s*\)/g))
    queue.push(new URL(m[1] ?? m[2], url).href);
}

const keys = [...new Set(all.match(KEY) ?? [])];
if (keys.some((k) => k.startsWith('phx_'))) fail('A PostHog personal API key (phx_…) is public on production. Rotate it in PostHog now.');
if (testKey && keys.includes(testKey)) fail("Production ships Ship Gate's CI PostHog key. Set PUBLIC_POSTHOG_KEY to the project key in the Workers Builds build variables.");
const key = keys.find((k) => k.startsWith('phc_'));
if (!key) fail('PostHog does not start on production: no project key on the home page or in its scripts. Set PUBLIC_POSTHOG_KEY in the Workers Builds build variables and render the PostHog component in the base layout.');

// Remote config: 200 for a live project, 404 for a key PostHog doesn't know.
const assets = apiHost.startsWith('/') ? `${site}${apiHost}` : apiHost.replace('.i.posthog.com', '-assets.i.posthog.com');
const configUrl = `${assets}/array/${key}/config.js`;
let res;
try { res = await fetch(configUrl); } catch (e) { fail(`Could not reach PostHog at ${configUrl}: ${e.message}.`); }
if (res.status === 404) fail(`PostHog does not know the project key production ships (${key.slice(0, 12)}…). Check PUBLIC_POSTHOG_KEY.`);
if (!res.ok) fail(`PostHog's remote config answered ${res.status} for production's key (${configUrl}).`);
if (apiHost.startsWith('/')) {
  const recorder = `${site}${apiHost}/static/recorder.js`;
  let r;
  try { r = await fetch(recorder, { redirect: 'manual' }); } catch (e) { fail(`Could not reach the PostHog proxy at ${recorder}: ${e.message}.`); }
  const type = r.headers.get('content-type') ?? '';
  if (r.status !== 200 || !/javascript/i.test(type))
    fail(`The PostHog proxy does not serve PostHog's assets: ${recorder} answered ${r.status} (${type || 'no content type'}), not 200 JavaScript. Route ${apiHost}/* to posthogProxy in the Worker entry (templates/caller/posthog/src/worker.ts).`);
  console.log(`The PostHog proxy at ${apiHost} serves PostHog's assets.`);
}
console.log(`Production starts PostHog with a live project key (${key.slice(0, 12)}…).`);
