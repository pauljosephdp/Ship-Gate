// Ship Gate — the one rule file, standards/standards.json, and what the scripts derive from it.
// Ship Gate owns the file; website-audit (pauljosephdp/Skills) carries a generated copy, so a rule
// changes once, here, for the merge gate and the live auditor alike. Every list a check reads comes
// from the file; nothing in scripts/ keeps its own copy.
// No dependencies: Node built-ins only.

import { readFileSync } from 'node:fs';

export const STANDARDS = JSON.parse(readFileSync(new URL('../standards/standards.json', import.meta.url), 'utf8'));
const { agents, groups } = STANDARDS;

// The two web search engines robots-blocks-page always checks (an indexable page they can't
// fetch can't rank). Every other must-allow crawler is an AI search one: ai-search-crawlers.
export const SEARCH_CRAWLERS = ['Googlebot', 'bingbot'].filter((t) => groups.searchMustAllow.includes(t));
// AI search and user-fetch crawlers: blocking one removes the site from that product's answers.
export const AI_SEARCH_CRAWLERS = [...groups.searchMustAllow.filter((t) => !SEARCH_CRAWLERS.includes(t)),
  ...groups.userFetchShouldAllow.filter((t) => !groups.searchMustAllow.includes(t))];
// Tokens that only control model training. Blocking them never affects search, so AI training is
// off by default by blocking these (discovery.aiTraining "reserve" or "allow" change that).
export const AI_TRAINING_TOKENS = [...groups.trainingOnly];
// Naming any AI crawler in a User-agent line states an explicit AI policy. Search engines that
// also feed AI answers (Googlebot, bingbot, Applebot) are named for search, so they don't count.
const NOT_AI_POLICY = new Set([...SEARCH_CRAWLERS, 'Applebot'].map((t) => t.toLowerCase()));
export const AI_AGENT_TOKENS = agents.map((a) => a.token).filter((t) => !NOT_AI_POLICY.has(t.toLowerCase()));
export const RETIRED_TOKENS = STANDARDS.retiredTokens;
export const TRAINING_OPT_OUT = STANDARDS.trainingOptOut;
export const JSON_LD_REQUIRED = STANDARDS.jsonLdRequired;
export const LLMS_TXT = STANDARDS.llmsTxt;
export const BUILD_CHECKS = STANDARDS.buildChecks;
export const CHINA_BLOCKED = STANDARDS.chinaBlockedHosts.hosts;
export const CHINA_UNRELIABLE = STANDARDS.chinaUnreliableHosts.hosts;

// The trackers the consent test fails on before consent: every entry of a consent-sensitive category.
export const CONSENT_TRACKERS = [...new Set(STANDARDS.trackerVendors.consentSensitive
  .flatMap((c) => STANDARDS.trackerVendors.categories[c] ?? []))];

// Does a tracker entry match this URL? By host only, never by path alone: the host, a subdomain of
// it, or a dot-separated run of its labels; an entry with a path also needs that path prefix.
// e2e/helpers.ts carries the same rule (it is copied into the run folder and can't import this).
export function trackerMatches(entry, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const slash = entry.indexOf('/');
  const host = (slash < 0 ? entry : entry.slice(0, slash)).toLowerCase();
  const path = slash < 0 ? '' : entry.slice(slash);
  return `.${u.hostname.toLowerCase()}.`.includes(`.${host}.`) && (!path || u.pathname.startsWith(path));
}

// A regex source for host entries inside text: "//" (scheme-relative or after a scheme), any
// subdomains, the host, then the end of the host part; an entry with a path matches as a prefix.
// Capture group 1 is the entry that matched.
export function hostPattern(entries) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = entries.map((e) => esc(e) + (e.includes('/') ? '' : `(?=[/:"'?#\\s)]|$)`));
  return `\\/\\/(?:[a-z0-9-]+\\.)*(${alt.join('|')})`;
}
