#!/usr/bin/env node
// Ship Gate post-deploy: the robots.txt production actually serves. A CDN or
// platform setting (managed robots.txt, "block AI bots") can rewrite it after the
// build passed the gate.
//
//   node check-robots-live.mjs     (reads SHIP_GATE_SITE_URL and SHIP_GATE_SMOKE_PATHS)
//
// Fails when production blocks Googlebot, Bingbot or an AI search crawler from a
// smoke path; reports which AI training crawlers are blocked.
// No dependencies: Node built-ins only.

import { SEARCH_CRAWLERS, AI_SEARCH_CRAWLERS, AI_TRAINING_TOKENS, parseRobots, robotsAllows } from './discovery.mjs';

const site = process.env.SHIP_GATE_SITE_URL;
const paths = (process.env.SHIP_GATE_SMOKE_PATHS || '/').split(/\s+/).filter((p) => p && !/\.(txt|xml)$/.test(p));
const res = await fetch(`${site}/robots.txt?cb=${Date.now()}`);
if (res.status === 404) { console.log('::warning::Production serves no robots.txt — every crawler is allowed.'); process.exit(0); }
if (!res.ok) { console.log(`::error::Production robots.txt answered ${res.status}. Crawlers treat 5xx as "disallow everything".`); process.exit(1); }
const robots = parseRobots(await res.text());
const errors = [];
for (const bot of [...SEARCH_CRAWLERS, ...AI_SEARCH_CRAWLERS]) {
  const blocked = paths.filter((p) => !robotsAllows(robots, bot, p));
  if (blocked.length) errors.push(`Production robots.txt blocks ${bot} from ${blocked.join(', ')}. Check the CDN's managed robots.txt and AI-crawler settings.`);
}
const training = AI_TRAINING_TOKENS.filter((t) => !robotsAllows(robots, t, '/'));
console.log(`AI training crawlers blocked in production: ${training.length ? training.join(', ') : 'none'}.`);
for (const e of errors) console.log(`::error::${e}`);
if (errors.length) process.exit(1);
console.log('Production robots.txt lets search and AI search crawlers reach the key pages.');
