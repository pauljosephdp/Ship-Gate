// Ship Gate — the stack policies, the guards and what a site's standard takes over. Read by
// prepare.mjs (validation, exemptions, delegation) and results.mjs (one record per guard).
// No dependencies.

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
  'first-party-only': 'Every sitemap page loads only first-party resources (exceptions listed in allowedOrigins)',
};
// "standard": a site that runs a standard whose own check owns some of Ship Gate's source guards.
// Those guards are skipped (not exempted: the standard's check still runs, inside this gate, as one of
// the site's checks). The contract fails unless that check is wired into a phase AND its script runs
// the standard's checker in the mode that enforces every rule (`run`). A guard is delegated only when
// the standard cannot waive it either: web-baseline's conform.mjs --final enforces every phase, but a
// recorded deviation (docs/baseline/deviations.json) can accept a forbidden path (tailwind.config.*)
// or missing required content (secrets.required, the PostHog layout wiring), so those guards stay
// here. Its Node runtime pin has no deviation, so node-pin is delegated. env-file is never delegated:
// a committed secret is never exemptible.
export const STANDARDS_DELEGATED = {
  'web-baseline': {
    check: 'conform:check',
    run: /\bnode\s+(?:\.\/)?scripts\/standard\/conform\.mjs\b[^&|;]*\s--final\b/,
    runText: 'node scripts/standard/conform.mjs --ci --final',
    guards: ['node-pin'],
  },
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
  'posthog-secrets': { policy: 'posthog-hybrid', what: 'POSTHOG_API_KEY (and the Turnstile secret) missing from the wrangler config\'s secrets.required' },
  'direct-tags': { policy: 'tags-via-zaraz', what: 'third-party tags loaded directly instead of through Zaraz' },
  turnstile: { policy: 'turnstile-forms', what: 'forms without Turnstile' },
  'pages-config': { policy: 'workers-builds-only', what: 'Pages config instead of Workers' },
  'cloudflare-in-workflows': { policy: 'workers-builds-only', what: 'Cloudflare API token or wrangler write in a workflow' },
  'blocked-in-cn': { policy: 'market-cn', what: 'resources blocked in mainland China' },
  consent: { policy: 'consent-before-tracking', what: 'tracking before consent' },
  'node-pin': { what: 'Node pin missing or below the floor' },
  'public-lighthouse': { what: 'Lighthouse reports in public storage' },
};
export const NEVER_EXEMPT = { 'posthog-key': 'a hard-coded PostHog key', 'env-file': 'a committed env file', 'push-to-main': 'a workflow pushing to main' };

// Every guard scripts/guards.sh raises (err ID …), with the policies it belongs to (none: every site).
// self-test.sh fails when guards.sh raises an id that is not listed here.
export const SOURCE_GUARDS = Object.fromEntries([
  'posthog-client', 'posthog-public-var', 'posthog-us-host', 'posthog-key', 'posthog-env-tag', 'posthog-server',
  'posthog-missing', 'posthog-secrets', 'direct-tags', 'turnstile', 'env-file', 'pages-config', 'node-pin',
  'push-to-main', 'cloudflare-in-workflows', 'public-lighthouse',
].map((id) => [id, [GUARDS[id]?.policy ?? (id === 'posthog-key' ? ['posthog-server-only', 'posthog-hybrid'] : [])].flat()]));
