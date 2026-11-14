// Unit tests for standards/standards.json and scripts/standards.mjs: the one rule file Ship Gate and
// website-audit share. Every list a check reads comes from the file, so its shape is the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  STANDARDS, SEARCH_CRAWLERS, AI_SEARCH_CRAWLERS, AI_TRAINING_TOKENS, AI_AGENT_TOKENS, CONSENT_TRACKERS,
  CHINA_BLOCKED, trackerMatches, hostPattern,
} from '../scripts/standards.mjs';

const tokens = new Set(STANDARDS.agents.map((a) => a.token));

test('every agent names a source or says it has none, and every group names known agents', () => {
  for (const a of STANDARDS.agents) {
    assert.ok('source' in a, `${a.token} has no source key`);
    assert.ok(a.source === null || /^https:\/\//.test(a.source), `${a.token} source is not a URL`);
    if (a.source === null) assert.ok(a.note, `${a.token} has no source and no note saying why`);
  }
  for (const [name, list] of Object.entries(STANDARDS.groups))
    for (const t of list) assert.ok(tokens.has(t), `groups.${name} names ${t}, which is not in agents`);
});

test('crawler lists: search engines, AI search and user fetch, training', () => {
  assert.deepEqual(SEARCH_CRAWLERS, ['Googlebot', 'bingbot']);
  for (const t of [...STANDARDS.groups.searchMustAllow, ...STANDARDS.groups.userFetchShouldAllow])
    assert.ok(SEARCH_CRAWLERS.includes(t) || AI_SEARCH_CRAWLERS.includes(t), `${t} is checked by neither rule`);
  assert.deepEqual(AI_TRAINING_TOKENS, STANDARDS.groups.trainingOnly);
  // A crawler the site must allow is never one it must block.
  for (const t of AI_TRAINING_TOKENS) assert.ok(!AI_SEARCH_CRAWLERS.includes(t) && !SEARCH_CRAWLERS.includes(t), t);
  assert.ok(AI_AGENT_TOKENS.includes('GPTBot') && !AI_AGENT_TOKENS.includes('Googlebot'));
});

test('JSON-LD table: every row is a list of property names, "a|b" for alternatives', () => {
  for (const [type, props] of Object.entries(STANDARDS.jsonLdRequired)) {
    assert.ok(Array.isArray(props) && props.length, type);
    for (const p of props) assert.match(p, /^[A-Za-z]+(\|[A-Za-z]+)*$/, `${type}: ${p}`);
  }
});

test('trackers: host, subdomain, label run and path; never the path alone', () => {
  assert.ok(trackerMatches('google-analytics.com', 'https://www.google-analytics.com/g/collect'));
  assert.ok(trackerMatches('criteo', 'https://static.criteo.net/js/ld.js'));
  assert.ok(trackerMatches('adservice.google', 'https://adservice.google.com/ddm'));
  assert.ok(trackerMatches('facebook.com/tr', 'https://www.facebook.com/tr?id=1'));
  assert.ok(!trackerMatches('facebook.com/tr', 'https://www.facebook.com/example'));
  assert.ok(!trackerMatches('hubspot.com', 'http://localhost:4321/_astro/hubspot-partner-badge.svg'));
  assert.ok(!trackerMatches('x.com', 'https://notx.com/'));
  // The consent list covers every vendor the v3 consent test caught.
  for (const url of ['https://eu.i.posthog.com/e', 'https://js.hs-scripts.com/1.js', 'https://www.clarity.ms/tag/x',
    'https://www.googletagmanager.com/gtm.js', 'https://connect.facebook.net/en_US/fbevents.js', 'https://static.hotjar.com/c.js',
    'https://snap.licdn.com/li.lms-analytics/insight.min.js', 'https://analytics.tiktok.com/i18n/pixel/events.js',
    'https://stats.g.doubleclick.net/r', 'https://script.hotjar.io/x', 'https://track.hubspot.com/__ptq.gif'])
    assert.ok(CONSENT_TRACKERS.some((t) => trackerMatches(t, url)), url);
  // Forms and fonts are not consent-sensitive.
  assert.ok(!CONSENT_TRACKERS.some((t) => trackerMatches(t, 'https://js-eu1.hsforms.net/forms/embed/1.js')));
  assert.ok(!CONSENT_TRACKERS.some((t) => trackerMatches(t, 'https://fonts.googleapis.com/css2')));
});

test('China hosts: the v3 market-cn list is kept, URLs match, links in prose do not', () => {
  for (const h of ['google.com', 'googleapis.com', 'gstatic.com', 'youtube.com', 'youtu.be', 'facebook.net', 'instagram.com',
    'twitter.com', 'x.com', 'twimg.com', 'vimeo.com', 'gravatar.com'])
    assert.ok(CHINA_BLOCKED.includes(h), h);
  const re = new RegExp(hostPattern(CHINA_BLOCKED), 'gi');
  assert.match('<link href="https://fonts.googleapis.com/css2">', re);
  assert.match('url(//i.ytimg.com/vi/x/0.jpg)', new RegExp(hostPattern(CHINA_BLOCKED), 'gi'));
  assert.match('src="https://d1.cloudfront.net/gtm.js"', new RegExp(hostPattern(CHINA_BLOCKED), 'gi'));
  assert.doesNotMatch('src="https://example.com/x.combined.js"', new RegExp(hostPattern(CHINA_BLOCKED), 'gi'));
  assert.doesNotMatch('the google.com homepage', new RegExp(hostPattern(CHINA_BLOCKED), 'gi'));
});

test('no script keeps its own copy of a list the rule file owns', () => {
  const dir = new URL('../scripts/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => /\.(mjs|sh)$/.test(n) && n !== 'standards.mjs' && n !== 'self-test.sh')) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(src, /'OAI-SearchBot',\s*'ChatGPT-User'/, `${f} lists AI search crawlers itself`);
    assert.doesNotMatch(src, /'GPTBot',\s*'ClaudeBot'/, `${f} lists training tokens itself`);
    assert.doesNotMatch(src, /youtube-nocookie\\\.com\|ytimg/, `${f} lists China hosts itself`);
    assert.doesNotMatch(src, /TRACKER_HOSTS\s*=/, `${f} lists trackers itself`);
  }
});

test('JSON-LD scope: every scoped row exists, and names positions', () => {
  for (const [row, scope] of Object.entries(STANDARDS.jsonLdScope).filter(([k]) => k !== '_doc')) {
    assert.ok(row in STANDARDS.jsonLdRequired, `jsonLdScope.${row} has no jsonLdRequired row`);
    assert.ok(Array.isArray(scope.at) && scope.at.length, `jsonLdScope.${row}.at`);
    if (scope.of) assert.ok(Array.isArray(scope.of), `jsonLdScope.${row}.of`);
  }
});
