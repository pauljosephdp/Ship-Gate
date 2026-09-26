# Ship Gate

One merge gate for any Astro site: accessibility, performance, security
headers, and whether search engines, answer engines and AI assistants can
find, read and cite the site (SEO, AEO, GEO and AIO readiness).

Site repos do not copy these files. They call this repo, pinned to a version.
A rule or threshold changes here once, and reaches each site through that
site's own reviewed Dependabot PR.

The core gate makes no vendor choices for a site. Opinions about which vendors
a site uses (analytics, tag management, bot protection, deploy pipeline) are
**stack policies**, off by default; a site or a portfolio opts in by name.

## What lives where

**Here, identical for every site:** stack guards, the contract check, the
structure, placeholder and discovery scans, the opt-in stack policies, the Playwright
suite (axe, reflow, CSP, redirects and headers), Lighthouse standards, the
static server, the test tooling and its versions (`tools/package-lock.json`),
and the post-deploy check.

**In each site repo, small and site-specific:**

| File | Purpose |
|---|---|
| `.github/workflows/ci.yml` | Calls `pauljosephdp/Ship-Gate@vX.Y.Z` in a job named `verify`; drafts run the fast stage only |
| `.github/workflows/post-deploy.yml` | Calls `pauljosephdp/Ship-Gate/post-deploy@vX.Y.Z` once Workers Builds reports the deploy |
| `.github/workflows/full-sweep.yml` | Weekly: the gate against every page (`"all"`), which pull requests only sample |
| `ship-gate.config.json` | Site URL, pages, policies, the site's own checks, stricter or temporarily looser thresholds |
| `.github/dependabot.yml` | Bumps npm packages and the pinned Ship Gate version, grouped, without rebasing open PRs; reads this private repo with the `SHIP_GATE_READ_TOKEN` Dependabot secret (step 14) |
| `.github/pull_request_template.md` | The review checklist |

Templates for all six are in `templates/caller/`. Sites on the `posthog-hybrid`
policy also copy `templates/caller/posthog/` (see PostHog in the browser and on the server).
Sites on `analytics-always-on` also follow `templates/caller/analytics/` and
`templates/caller/legal/` (see Analytics on every page).

## The gate

`verify` runs, in order:

1. Contract and config check, then stack guards
2. `npm ci`, `astro check`, lint (if the site has `lint`), unit tests (if it has `test`)
3. Site checks before the build, then the build
4. On the built output: structure scan, discovery scan (SEO, AEO, GEO, AIO),
   placeholder scan, the client-bundle PostHog scan (`posthog-server-only`
   policy) or the PostHog scan (`posthog-hybrid` policy), the market scan (`market-cn` and `rtl-logical-css` policies), site
   checks after the build
5. Against the served build: site browser checks, then the Playwright suite
   (smoke + axe on desktop 1440 and Pixel 7, keyboard, reflow, CSP, consent,
   edge files)
6. Lighthouse CI (mobile)

Every check runs even after another fails, so a PR shows all its failures at
once; checks that need the build skip when the build fails. A summary table at
the end names each check's result, and the job fails if any check failed.
When a check fails, the reports (Playwright traces, Lighthouse HTML, the
discovery table) upload as a build artifact for 5 days, never to public
storage. A green run uploads nothing: its summary table is the record, and
storing reports for every green run filled the account's artifact quota. Each
run also deletes its branch's older reports, so a branch keeps at most its
latest failed run's and a green run leaves none. Other branches' reports stay,
since someone may be reading one. Deleting needs `actions: write`, which the
caller `ci.yml` and `full-sweep.yml` grant; without it (a fork's PR, an older
caller) the step logs a notice and the reports simply expire.

**Stages.** The `stage` input decides how far the gate runs: `full` (the
default) runs everything above; `browser` stops before Lighthouse; `scans`
stops after step 4, with no browser, in about two minutes. Skipped checks read
"➖ not run" and the summary says which stage ran. The caller template passes
`scans` for a draft pull request and `full` otherwise, and re-runs when the
draft is marked ready for review. A draft cannot merge, so nothing reaches
`main` without the full gate, and a PR iterated as a draft pays for one full
run instead of one per push.

**What a run costs.** Actions bills a private repo's runner by the minute,
rounded up per job, and PR `verify` time is dominated by the browser suite and
Lighthouse, which scale with the pages they cover. Keep `e2ePages` to the
listed `pages` and `lighthouseUrls` to one page per template on pull requests
(a list runs three times per URL, `"all"` once), and put `"all"` in the
weekly `full-sweep.yml`, which the template builds from the same config.

The built site is served by `scripts/serve-static.mjs`, which behaves like
Cloudflare Workers static assets: it applies `_redirects` and `_headers`, hides
`.assetsignore` files, and redirects `/about` to `/about/` as Workers does. So
CSP, security headers and redirects are tested on the PR, not discovered in
production. Nothing in the gate runs `wrangler`: some site configs run a remote
migration whenever wrangler starts.

### Lighthouse standard

Deterministic lab signals fail the build. Throttled performance on a shared CI
runner moves several points between identical runs, so performance warns: a
gate that fails on runner noise is a gate that gets switched off. One measured
baseline of 24 September 2026 (performance 89–96 across 37 identical-quality
pages) would have failed a hard 0.90 floor on pages that are fine.

| Audit | Standard | Enforcement |
|---|---|---|
| Accessibility score | 1.0 | fail |
| Best Practices score | ≥ 0.90 | fail |
| Cumulative Layout Shift | ≤ 0.05 | fail |
| `document-title`, `meta-description`, `http-status-code`, `link-text`, `crawlable-anchors`, `hreflang` | pass | fail |
| Performance score | ≥ 0.90 | warn |
| Largest Contentful Paint | ≤ 4000 ms | warn |
| Total Blocking Time | ≤ 300 ms | warn |

The SEO category score is not asserted. Lighthouse fails `robots-txt` on the
Content-Signal directive (a deliberate `ai-train=no`) and `is-crawlable` on
deliberate noindex pages, so the category would fail correct sites. The SEO
audits that matter are asserted one by one instead. `canonical` is not asserted
either: served from localhost, every canonical points at another origin. The
discovery scan checks canonicals against `siteUrl` instead.

Accessibility is 1.0 because axe already fails any WCAG 2.2 AA violation, and
well-built pages score 100. A site below it loosens it with a reason
and a date, like any other threshold.

Third-party code is blocked during measurement (PostHog, HubSpot, Clarity,
Google tags, Zaraz, Turnstile), so a vendor's release never moves a site's
score. `"lighthouseUrls": "all"` tests every indexable page the build emits
(not 404, noindex, meta-refresh stubs or verification files), one run each,
so a new page is gated the day it ships. A list of paths runs three times each
and takes the median.

### Browser checks

On every page in `e2ePages` (default: `pages`; `"all"` for every indexable page):

- **Smoke:** 200, one `h1`, a title and one meta description, no JS errors.
  With `posthog-server-only`, no browser calls to PostHog. With
  `posthog-hybrid` (desktop), every page tries to reach PostHog and defines
  `window.posthog`; with the npm embed the real SDK must also be loaded,
  capturing before any consent choice, and in the configured cookieless mode.
  With `turnstile-forms`, a Turnstile widget on every `formPages` page.
- **axe, WCAG 2.2 AA** (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`),
  desktop and mobile, after scrolling the page and letting fade-in animations
  finish, so a card mid-fade is not scanned.
- **Keyboard** (desktop): pressing Tab reaches every control, focus is never
  trapped (WCAG 2.1.2), every focused control is on screen (2.4.11) and changes
  visibly when focused (2.4.7): an outline, ring, border, background, colour or
  underline that isn't there without focus. It warns by default;
  `"keyboard": "error"` makes it fail. axe checks the markup; this presses the keys.
- **Reflow:** no horizontal scroll at 320, 360 and 390px and at 200% zoom
  (1280px at 2x), WCAG 1.4.10 and 1.4.4. Content inside its own `overflow-x`
  scroller or clipper passes; the failure names the elements past the edge.
- **CSP:** a page that sends a Content-Security-Policy (enforced or Report-Only)
  must load with zero violations.
- **Consent** (`consent-before-tracking` policy, desktop): before any
  interaction, no cookie is set beyond Cloudflare's essential ones and
  `consentEssentialCookies`, and nothing from a tracking vendor's host
  (PostHog, HubSpot tracking, Clarity, Google Analytics/Tag Manager,
  DoubleClick, Meta, Hotjar, LinkedIn, TikTok) is requested or present in the
  markup. Matching is by hostname, so the site's own files named after a
  vendor pass, and HubSpot form embeds (`hsforms.net`) are allowed. With
  `posthog-hybrid` in a cookieless mode, PostHog may load before consent, but
  must write no `ph_` cookie and no `ph_`/`__ph` localStorage or
  sessionStorage key. With the npm embed and `"cookieless": "on_reject"`, a
  second test accepts (`posthog.opt_in_capturing()`) and expects PostHog to
  start storing its identity. With `analytics-always-on`, Google Analytics
  also runs before consent, but as a Zaraz tool: its hits go through the
  site's own `/cdn-cgi/zaraz/`, so a request to a Google host still means a
  direct tag, and a `_ga` cookie before consent still fails.

Other origins are blocked in the browser, so a vendor outage never fails a PR.
CSP still reports a disallowed URL before any request is made.

Once per run, the **edge** checks: every static `_redirects` rule answers with
its status and `Location`; every on-site destination answers 200 (no chains);
the home page sends `securityHeaders` (default `X-Content-Type-Options`,
`Referrer-Policy`, and `X-Frame-Options` or CSP `frame-ancestors`); `/_astro/`
assets are `immutable`; an unknown path answers 404 with the site's 404 page;
`.assetsignore` files are not served.

### Build-output scans

- **Structure** (every indexable page): exactly one `h1`; no skipped heading
  levels; `target="_blank"` carries `rel="noopener"`; a title (at most 75
  characters, or the site's `structure` band) and meta description, each unique
  across the site. Every file: no
  unrendered `{{token}}`. `_headers` and `_redirects` parse, with no
  merge-conflict markers. Every on-site link in `llms.txt` exists. Zero pages
  scanned is a failure.
- **Placeholder copy** (every indexable page): no `[Client name]`-style
  brackets, `TODO:`, `TBD`, `FIXME` or lorem ipsum in visible text. Citations
  like `[1]` and labels like `[PDF]` pass; `copyAllowlist` takes exact strings.
- **Client bundle** (`posthog-server-only` policy): no PostHog code or key in
  anything the browser downloads.
- **PostHog** (`posthog-hybrid` policy, "PostHog on every page" in the
  summary): the build runs with Ship Gate's CI-only project key in
  `PUBLIC_POSTHOG_KEY`, and every indexable page must carry it, inline (the
  snippet) or in a same-origin script the page loads, following its imports
  (the npm embed). Any other project key or a personal key (`phx_`) in client
  output fails. Every Content-Security-Policy that applies to a page, from
  `_headers` or a `<meta>` tag, must allow PostHog's assets host in
  `script-src`, its API and assets hosts in `connect-src`, `blob:` workers
  (session replay), and for the snippet `'unsafe-inline'` with no hashes. The
  snippet holds the key, so no one hash fits CI and production. A same-origin
  proxy (`posthog.apiHost` a path) needs only `'self'`. The browser tests
  abort PostHog's requests, to its hosts and to a same-origin proxy path alike
  (the static server has nothing behind the proxy), so lazily loaded replay and
  survey code would otherwise never meet the CSP before production.

### Discovery scan: SEO, AEO, GEO and AIO readiness

Whether search engines, answer engines and AI assistants can crawl the site,
understand it and quote it. It reads the built output (no browser, no network),
so it runs in seconds on every page and gives the same answer every run.

The four terms overlap, so each rule sits under the one it matters most to:

- **SEO**: search engines can crawl and index every page.
- **AEO** (answer engine optimisation): the page states its facts as
  schema.org JSON-LD, which answer engines and rich results read.
- **GEO** (generative engine optimisation): AI assistants such as ChatGPT,
  Claude and Perplexity can reach the page, read it without running JavaScript,
  and cite it with a title, summary and image.
- **AIO** (AI Overviews): Google's AI Overviews and AI Mode draw on the normal
  Search index, so a page qualifies by being indexed and snippet-eligible. Google
  documents no extra markup for them.

| Area | Rule | Default | Fails when |
|---|---|---|---|
| SEO | `robots-txt` | error | no `robots.txt` in the build, a line that doesn't parse, or no `User-agent` group; after deploy, also not 200 or not `text/plain` |
| SEO | `robots-sitemap` | error | `robots.txt` has no `Sitemap:` line on `siteUrl` |
| SEO | `robots-blocks-page` | error | an indexable page is disallowed for Googlebot or Bingbot |
| SEO | `sitemap` | error | no sitemap, or it doesn't parse, lists another origin, or has a malformed `lastmod`; sitemap indexes are followed |
| SEO | `sitemap-coverage` | error | an indexable, self-canonical page is missing, or the sitemap lists a noindex, redirecting, canonicalised or missing URL |
| SEO | `sitemap-lastmod` | warn | a URL has no `lastmod`, or one in the future |
| SEO | `sitemap-xml` | warn | `/sitemap.xml` is neither built nor redirected to the sitemap (agents probe that path without reading `robots.txt`) |
| SEO | `sitemap-live` | error | after deploy: a sitemap named in production `robots.txt` doesn't answer 200 with XML |
| SEO | `canonical` | error | not exactly one canonical, not on `siteUrl`, or it names a URL that redirects or is not an indexable page |
| SEO | `html-lang` | error | `<html>` has no valid `lang` |
| SEO | `viewport` | error | no `width=device-width` viewport |
| SEO | `internal-links` | error | an `<a href>` on the site resolves to no built file and no `_redirects` rule |
| SEO | `redirect-permanence` | warn | a `_redirects` rule answers 302 or 307, a temporary move (302 is Cloudflare's default when a rule names no status) |
| SEO | `rtl-direction` | error | a page in a right-to-left language (`ar`, `he`, `fa`, `ur`, `ps`, `yi`, `ckb` and others) has no `dir="rtl"` on `<html>` or `<body>` |
| SEO | `hreflang-pairs` | warn | an `hreflang` alternate names a URL on the site that isn't an indexable page, or a page that doesn't link back |
| AEO | `structured-data` | error | JSON-LD doesn't parse, lacks a schema.org `@context` or `@type`, or lacks key properties (below) |
| AEO | `site-entity` | error | the home page declares no Organization, LocalBusiness or Person, or its `url` is off-site |
| AEO | `entity-sameas` | warn | that entity has no `sameAs` profile links |
| AEO | `faq-visible` | error | a FAQPage question is not visible on the page (structured data must describe visible content). Text is read as rendered, so inline markup such as `CuSO<sub>4</sub>` matches `CuSO4` |
| AEO | `breadcrumbs` | warn | a page two or more levels deep has no BreadcrumbList |
| GEO | `ai-search-crawlers` | error | `robots.txt` blocks an AI search or user-fetch crawler from an indexable page: OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User, Applebot, DuckAssistBot |
| GEO | `ai-training` | error | an AI training token (GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, meta-externalagent, Bytespider) can fetch `/`, or a `Content-Signal` says `ai-train=yes`; with `"aiTraining": "reserve"`, a training token that can fetch `/` is governed by a group with no `ai-train=no` signal; with `"aiTraining": "allow"`, the reverse of the default. Build and after deploy |
| GEO | `ai-uses-allowed` | error | a `Content-Signal` sets `search=no` or `ai-input=no`. Build and after deploy |
| GEO | `ai-crawler-rules` | warn | no `User-agent` group names an AI crawler (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, Google-Extended, …) |
| GEO | `content-signals` | warn | `robots.txt` has no `Content-Signal` line, or one that doesn't declare all of `search`, `ai-input` and `ai-train` ([contentsignals.org](https://contentsignals.org)) |
| GEO | `content-signals-format` | error | a `Content-Signal` entry isn't `search`, `ai-input` or `ai-train` `=yes`/`=no`, or sits before any `User-agent` line |
| GEO | `link-headers` | warn | `_headers` gives `/` no `Link` header with rel `api-catalog`, `service-desc`, `service-doc` or `describedby` (RFC 8288, RFC 9727), a value doesn't parse, or an on-site target isn't built; after deploy, the real header |
| GEO | `markdown-negotiation` | warn | after deploy: `Accept: text/markdown` on `/` doesn't return `text/markdown`, or a browser request no longer gets HTML |
| GEO | `open-graph` | error | no `og:title`, `og:description` or absolute `og:image`, an `og:image` on the site that the build lacks, or an off-site `og:url` |
| GEO | `article-dates` | warn | an Article has no `dateModified` |
| GEO | `rendered-content` | warn | fewer than 50 words of text in the HTML (content rendered by JavaScript) |
| GEO | `llms-txt` | warn | no `/llms.txt` |
| GEO | `llms-txt-format` | error | `/llms.txt` lacks the `# Name` heading, `> summary` line or links ([llmstxt.org](https://llmstxt.org)) |
| GEO | `markdown-mirrors` | warn | a `.md` or `.txt` file linked from `llms.txt` has no `X-Robots-Tag: noindex` (or canonical `Link`) header in `_headers` |
| AIO | `snippet-controls` | warn | an indexable page sets `nosnippet` or `max-snippet:0` |
| AIO | `image-preview` | warn | an indexable page sets `max-image-preview:none` |

**Key properties** checked by `structured-data`: Article types need
`headline`, `datePublished` and `author`. Organization and Person need `name`,
and LocalBusiness types need `name` and `address`. Every schema.org subtype
counts (Hotel, Dentist, Attorney, Plumber…), from
`scripts/schema-org-types.json`; regenerate it with
`node tools/schema-org-types.mjs` after a schema.org release. WebSite needs `name` and
`url`. Product needs `name` plus `offers`, `review` or `aggregateRating`. Event
needs `name`, `startDate` and `location`. FAQPage needs Questions with
`acceptedAnswer.text`, and BreadcrumbList needs `position`, `name` and `item`.
Recipe and VideoObject get Google's required properties. Where Google defines
required properties, these match them; otherwise they are the minimum that
identifies the thing.

**AI training is off by default; everything else is on.** `ai-training` fails
unless `robots.txt` disallows `/` for every model-training token: GPTBot,
ClaudeBot, Google-Extended, Applebot-Extended, CCBot, meta-externalagent and
Bytespider. Every other crawler stays allowed: blocking a search crawler fails
`robots-blocks-page`, and blocking an AI search or user-fetch crawler such as
OAI-SearchBot or PerplexityBot fails `ai-search-crawlers`, because it removes the
site from that product's answers. `ai-uses-allowed` fails a `Content-Signal` that
turns off `search` or `ai-input`. Google-Extended controls Gemini training and
grounding only; blocking it does not affect Google Search or AI Overviews.

A site that wants its content used for training says so once, with no expiry
date; `ai-training` then fails if any training token is blocked or the signal
says `ai-train=no`:

```json
"discovery": { "aiTraining": "allow" }
```

A site that lets training crawlers fetch but reserves training in its terms
sets `"reserve"`. Fetching is then allowed; `ai-training` fails unless every
training token that can fetch `/` is governed by a group whose
`Content-Signal` says `ai-train=no`: its own named group if it has one (a bot
with its own group ignores the `*` group), otherwise the `*` group. A governing
group with no `ai-train` signal fails, and any `ai-train=yes` fails. A token
that is disallowed from `/` also passes: stricter is allowed. Cocoon and
Playway do this, with `Content-Signal: search=yes, ai-input=yes, ai-train=no`
in every group, backed by their terms:

```json
"discovery": { "aiTraining": "reserve" }
```

```
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /

User-agent: GPTBot
User-agent: ClaudeBot
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /
```

**Other search engines.** `robots-blocks-page` always checks Googlebot and
Bingbot. A site that serves China, Korea or Russia adds their crawlers, in the
build scan and after deploy:

```json
"discovery": { "searchCrawlers": ["Baiduspider", "Yeti", "YandexBot"] }
```

`Yeti` is Naver's crawler. Some checklists give Naver title and description
limits of 40 and 80 characters. A site that wants them tightens the existing
band, `"structure": { "titleMax": 40, "descMax": 80 }`; the gate doesn't
hard-code them.

**Markdown mirrors.** Plain-text copies of pages for AI tools (`/llms/about.md`)
duplicate the HTML. A `robots.txt` `Disallow` does not keep a URL out of the
index: a blocked URL can still be indexed from links, and the crawler never
sees a `noindex` it isn't allowed to fetch. Send the header instead, for a
folder of mirrors:

```
/llms/*
  X-Robots-Tag: noindex
```

**What it does not claim.** `llms.txt` is a proposal: some AI tools read it,
but Google Search does not use it, so it only warns. No markup guarantees a
citation in an AI answer; these rules make sure nothing on the site prevents
one.

The result table goes to the job summary and `reports/discovery.md` in the
build artifact. Error findings fail the step and warnings are annotated.
`discoveryOverrides` raises or lowers a rule, the same way thresholds are
overridden:

```json
"discoveryOverrides": [
  { "rule": "llms-txt", "level": "error" },
  { "rule": "open-graph", "level": "warn",
    "reason": "Social images ship with the redesign", "restoreBy": "2026-12-31" }
]
```

**An explicit AI policy.** A bot with its own `User-agent` group ignores the
`*` group entirely, so a named group must repeat every `Disallow` that bot
should obey. `Claude-Web` and `anthropic-ai` are retired tokens; the scan notes
them. A minimal file that passes every robots rule:

```
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=no
Allow: /

User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: CCBot
User-agent: meta-externalagent
User-agent: Bytespider
Disallow: /

Sitemap: https://example.com/sitemap-index.xml
```

With `@astrojs/sitemap`, add `/sitemap.xml /sitemap-index.xml 301` to
`public/_redirects`, and give agents a `Link` in `public/_headers`:

```
/
  Link: </llms.txt>; rel="describedby"; type="text/markdown"
```

The caller template starts the post-deploy check when Cloudflare Workers
Builds reports a successful build of `main` (its `check_run`), not on the push,
so no runner sits idle while the deploy runs; it passes the deployed commit as
`sha`. A site deployed some other way triggers it on `push` instead, and `sha`
defaults to the triggering commit. After adopting the template, confirm the
check starts on the next merge.

After deploy, the post-deploy action first waits (up to `wait-minutes`) until
production's home page carries that commit (`sha`) in its `build-sha` meta tag,
and fails if it never does. Every page it inspects is fetched in full before
it is searched, so a match can't be lost to a closed pipe. It then checks what
production **actually serves**, at the site's discovery levels: `robots.txt` is 200, `text/plain`,
has a `User-agent` group, blocks AI training (per `discovery.aiTraining`), keeps
search and AI input on in its `Content-Signal`, and doesn't block Googlebot,
Bingbot, a `discovery.searchCrawlers` crawler or an AI search crawler from a
smoke path;
every sitemap it names answers with XML; the home page sends its `Link` header;
and `Accept: text/markdown` gets Markdown (Cloudflare's Markdown for Agents
does this at the edge, so the build can't test it). A CDN's managed robots.txt,
"block AI bots" setting or transform rule can change any of these after the
build passed. It also fails when `/`, `/robots.txt` or a smoke path answers
**403 or 429** to a plain request: a WAF rule or rate limit that refuses
ordinary traffic refuses crawlers too, and AI platforms treat the site as
unreachable. It warns when a page has neither `ETag` nor `Last-Modified`, which
crawlers use to refetch only what changed. It never spoofs a crawler's user
agent: a correctly configured WAF blocks spoofed bots, so that test would fail
good sites. With `posthog-server-only` it fails when production's home page
carries PostHog client code or a project key, and when that page can't be
fetched at all. With `posthog-hybrid` it fails when production's home page (or
a same-origin script it loads) carries no PostHog project key, carries Ship
Gate's CI key or a personal key, or carries a key PostHog doesn't know: one
read-only GET of the project's remote config (`/array/<key>/config.js`), which
answers 404 for an unknown key. With a same-origin proxy (`posthog.apiHost` a
path such as `"/ph"`), it also fetches `<siteUrl><apiHost>/static/recorder.js`
and fails unless that answers 200 with a JavaScript content type: an HTML 404
page or a redirect means the proxy isn't reaching PostHog. A plain-text 404 is
the proxy refusing `/static/` on purpose (a site with session replay off keeps
`recorder.js` from ever loading through its own origin), so it warns instead;
the remote config, which must not come back as HTML, already proved the proxy
reaches PostHog's assets host. With
`analytics-always-on` it warns when production's home page has no Zaraz loader
(`/cdn-cgi/zaraz/`), because then Google Analytics runs nowhere. It warns rather
than fails: a Zaraz setting is not a fault in the deployed commit, and a
post-deploy failure means roll back.

With a `crux-api-key` input (a Google API key with the Chrome UX Report API
enabled, passed as a secret), it also reports **field Core Web Vitals** for
phones and warns when p75 LCP is over 2.5 s, INP over 200 ms or CLS over 0.1.
Lab tools cannot measure INP; only real visits can. Sites with too little
traffic have no Chrome UX Report data, and the step says so and passes. If
the API can't be reached, the step warns and passes.

**Not checked: DNS-AID.** DNS for AI Discovery
(`_index._agents.example.com` SVCB records) is an individual Internet-Draft,
not adopted by an IETF working group, and only applies to sites that run agent
endpoints. It is left out until it is adopted.

### Stack policies

Off unless the site lists them in `policies`. Each one turns on its guards and
checks:

| Policy | What it enforces |
|---|---|
| `posthog-server-only` | `posthog-node` only inside `src/lib/server`, `src/pages/api`, `src/actions` or `src/middleware`; EU host; the key is never `PUBLIC_` and never hard-coded; every event tagged with `__DEPLOY_ENV__`; no PostHog in the client bundle, in browser requests, or in production HTML. Markdown content (`src/content/**/*.md`, `*.mdx`) may name `posthog.com` in prose, as a privacy policy's disclosure does ("PostHog Privacy Policy: posthog.com/privacy"); `posthog-node`, `POSTHOG_`, `new PostHog(`, `posthog.init` and ingestion hosts (`i.posthog.com`, `eu.i.posthog.com`, `us-assets.i.posthog.com`) still fail there. The client-bundle and production-HTML checks look for `posthog-js`, `posthog.init`, ingestion hosts and keys, so the disclosure passes them too |
| `tags-via-zaraz` | No tag loads directly. GTM (loader URLs and inline `GTM-XXXX` ids), Google Analytics, Meta, Hotjar, LinkedIn, TikTok, Microsoft Clarity and HubSpot tracking (`hs-scripts`, `hs-analytics`) go through Cloudflare Zaraz. HubSpot form embeds (`js-*.hsforms.net`) are allowed: they are the portfolio's form standard until HubSpot's forms API is available. They render their own form, so list only Turnstile forms in `formPages`. A tag host that loads nothing passes: `_headers` comment lines and `Content-Security-Policy` values (a client-side Zaraz tool such as Clarity needs its hosts in the CSP), and a bare `www.clarity.ms` in prose or a link. Clarity's loader (`clarity.ms/tag`) still fails |
| `turnstile-forms` | Every `<form>` carries Cloudflare Turnstile (a non-public form opts out with `<!-- turnstile-exempt: reason -->`), and the widget renders on every `formPages` page. The site's Turnstile env vars get Cloudflare's always-pass test keys |
| `workers-builds-only` | No Pages config (`pages_build_output_dir`), and no workflow holds a Cloudflare API token or runs a `wrangler` write. Workers Builds is the only deployer |
| `market-cn` | No page, stylesheet or script in the build loads from a host blocked in mainland China: Google (Fonts, Maps, reCAPTCHA, tags), YouTube, Facebook, Instagram, X/Twitter, Vimeo, Gravatar. A blocked font or script stalls the page until it times out. Links and JSON-LD `sameAs` load nothing and pass. jsDelivr and unpkg warn; non-ASCII URLs warn |
| `rtl-logical-css` | Warns with a count of physical `left`/`right` declarations in the built CSS (`margin-left`, `padding-right`, `left:`, `text-align: left`, `float: right`, `border-left`), which don't mirror under `dir="rtl"`. Use logical properties (`margin-inline-start`, `inset-inline-start`, `text-align: start`). Never fails: some physical values are right |
| `posthog-hybrid` | PostHog in the browser on every page **and** on the server, every feature on, EU Cloud. `posthog-node` is a dependency and stays in server paths, flushing, with `__DEPLOY_ENV__` on every event; a component in `src` calls `posthog.init(` and registers `environment: __DEPLOY_ENV__`; with `"embed": "npm"`, `posthog-js` is a dependency. Only `PUBLIC_POSTHOG_KEY` is public: a `PUBLIC_POSTHOG_*PERSONAL*`/`*SECRET*` variable, a US host, or a hard-coded `phc_`/`phx_` key fails. A wrangler config without `secrets.required` listing `POSTHOG_API_KEY` (and, with `turnstile-forms`, the `turnstileEnv` secret) warns, and becomes an error in v4. Then the PostHog scan, the browser checks and the post-deploy check above. Can't be combined with `posthog-server-only`. See PostHog in the browser and on the server |
| `consent-before-tracking` | The browser consent check: no non-essential cookie and no tracker before the visitor chooses. Strictly necessary cookies go in `consentEssentialCookies` |
| `analytics-always-on` | Google Analytics and PostHog load on every page, with or without consent, and neither stores anything until the visitor accepts. Needs `posthog-hybrid` (with `posthog.cookieless` `"on_reject"` or `"always"`) and `tags-via-zaraz`. GA4 is a Zaraz tool with no consent purpose, in Google Consent Mode v2 with every signal denied by default. Then the post-deploy Zaraz check. See Analytics on every page |

```json
"policies": ["posthog-server-only", "tags-via-zaraz", "turnstile-forms", "workers-builds-only"]
```

`market-cn` checks what a gate can see in the build. Serving mainland China
also needs an ICP licence and mainland hosting or CDN, which are outside any
build check.

A portfolio that shares a stack puts the same list in every site's config.

### PostHog in the browser and on the server (`posthog-hybrid`)

PostHog loads on every page, with or without consent, and the server sends its
own events into the same visitor's session. The files to copy are in
`templates/caller/posthog/`; the fixture's `posthog-hybrid` variant builds from
these same files, so CI proves them on every Ship Gate change.

| Template | Put it at | What it does |
|---|---|---|
| `src/lib/posthog-options.ts` | same path | Every browser feature on: `defaults: '2026-08-30'`, `person_profiles: 'always'`, autocapture, `capture_pageview: 'history_change'`, page leave, heatmaps, dead clicks, exceptions, web vitals and network timing, session replay (cross-origin iframes, console logs), surveys and feature flags, `cross_subdomain_cookie`, and `cookieless_mode: 'on_reject'` with `opt_out_capturing_by_default` |
| `src/components/PostHog.astro` | same path, in the base layout's `<head>` | The npm embed: bundles `posthog-js` into a same-origin `/_astro/` script, initialises once (`<ClientRouter>`-safe), adds `tracing_headers` for the site's own host, registers `environment: __DEPLOY_ENV__`, and registers it again after every `opt_in_capturing()` and `opt_out_capturing()` (opting in moves posthog-js to cookie storage, which drops the tag; every event after consent would then slip past the "not production" filter) |
| `src/components/PostHogSnippet.astro` | instead of `PostHog.astro` | The snippet from PostHog's Astro guide, EU host, same options and the same re-tagging after consent, no npm dependency; needs `'unsafe-inline'` under a CSP |
| `src/lib/server/analytics.ts` | same path | `posthog-node` for Workers: `track`, `trackError` (error tracking) and `flag` (feature flags), flushed with `waitUntil`, tagged with `environment`. Each joins the browser's visitor through, in order: the `X-POSTHOG-DISTINCT-ID`/`X-POSTHOG-SESSION-ID` tracing headers, the ids the form sent in its body (`posthog: { distinctId, sessionId }` from `window.posthog`, read with `browserIds(body)` and passed as the last argument; the tracing headers come from a lazily loaded extension, so the first form post often lacks them), then the PostHog cookie's `distinct_id` and `$sesid[1]`. With none, a random id with `$process_person_profile: false`, so anonymous visitors never merge into one person. Logs `[analytics] sending <event> key phc_xxxx… (N chars)` and PostHog's own errors (`shutdown()` hides them), and warns once with the Worker's binding names (never values) when `POSTHOG_API_KEY` is missing |
| `src/env.d.ts` | merge | Declares `__BUILD_SHA__`, `__DEPLOY_ENV__`, `PUBLIC_POSTHOG_KEY` and `window.posthog` |
| `csp.txt` | merge into `public/_headers` | The CSP sources PostHog needs |
| `src/lib/server/posthog-proxy.ts` and `src/worker.ts` | same paths; wrangler `"main": "./src/worker.ts"` | Optional same-origin reverse proxy at `/ph`, so ad blockers don't drop events and CSP needs only `'self'`. It runs in the Worker entry before Astro, so it needs no on-demand rendering and `trailingSlash: 'always'` never redirects PostHog's POSTs. `/ph/static/*` and `/ph/array/*` go to `eu-assets.i.posthog.com`, the rest to `eu.i.posthog.com`; the site's cookies and PostHog's `Set-Cookie` are dropped, and `CF-Connecting-IP` goes on as `X-Forwarded-For` so PostHog still geolocates. A site with its own `worker.ts` adds the import and `posthogProxy(request) ?? handle(request, env, ctx)`. Then set `apiHost` to `/ph` in both the options file and the config. Unit-tested in `test/posthog-proxy.test.mjs`; the fixture (a static site) doesn't build it |
| `optional/src/components/PostHogZarazConsent.astro` | same path, right after the PostHog component | Zaraz consent → PostHog and Google Analytics: on `zarazConsentAPIReady` and `zarazConsentChoicesUpdated`, the purpose's `true` calls `opt_in_capturing()` and grants `analytics_storage` (`zaraz.set('google_consent_update', …)`); `false` calls `opt_out_capturing()` and denies it. Does nothing until `zaraz.consent.APIReady`, so a returning visitor who said yes is never opted out on first paint. Set `PURPOSE_ID`. Astro inlines a script this small, which a CSP without `'unsafe-inline'` blocks without an error, so add `vite: { build: { assetsInlineLimit: (file) => (/ZarazConsent/.test(file) ? false : undefined) } }` to `astro.config.mjs` to keep it a same-origin file |
| `optional/src/lib/hubspot-conversion.ts` | same path | `trackHubSpotForm(formId, event)`: on a HubSpot embed's `hsFormCallback`/`onFormSubmitted` for that form, `zaraz.track` and `posthog.capture` the event with the form ID only |

```json
"policies": ["posthog-hybrid", "consent-before-tracking"],
"posthog": { "embed": "npm", "cookieless": "on_reject", "apiHost": "https://eu.i.posthog.com" }
```

Consent. With `"cookieless": "on_reject"` (the default), PostHog loads and
captures on every page before any choice, counting visitors with PostHog's
daily-salted server hash, and writes no cookie or storage until the visitor
accepts (`posthog.opt_in_capturing()` from the site's banner). Then it uses
cookies as usual. `"always"` never stores anything and needs no banner. `"off"`
(remove both consent lines from the options file) sets cookies from the first
page view without asking. That is not lawful in the EU without consent, so it is
refused together with `consent-before-tracking`. Cookieless events need
*Cookieless server hash mode* in the PostHog project; without consent, visitors
count as new people each day, and GeoIP and bot enrichment are lost. Keep
`posthog.cookieless` and `posthog.apiHost` in step with the options file: with
the npm embed the smoke test compares them.

Consent copy: in one short test, session replay started only after opt-in.
That isn't confirmed yet, so adoption guides and cookie-policy text must not
claim replay runs before consent.

### Analytics on every page (`analytics-always-on`)

Google Analytics and PostHog load on every page, with or without consent.
Neither stores anything in the browser until the visitor accepts analytics in
the Zaraz consent modal.

- **PostHog:** `posthog-hybrid` with `"cookieless": "on_reject"`, as above.
- **Google Analytics 4:** a Zaraz tool assigned to **no** consent purpose, so it
  always loads. Zaraz's *Set Google Consent Mode v2 state* setting has every
  signal denied by default. GA then sends hits without cookies, and sets
  `_ga`/`_ga_*` only after `PostHogZarazConsent.astro` grants
  `analytics_storage`.
- **Ads and marketing tools** (Meta, LinkedIn, TikTok, HubSpot tracking) stay
  on a Marketing purpose and load only after consent.

| Template | What it is |
|---|---|
| `templates/caller/analytics/zaraz-setup.md` | The Zaraz dashboard checklist: GA4 tool, Consent Mode default, purposes, and a one-time check on production |
| `templates/caller/legal/analytics-disclosure.md` | Paste-ready cookie and privacy policy text for GA4 and PostHog before and after consent, with the choices section. Not legal advice: review it with counsel |
| `templates/caller/posthog/optional/src/components/PostHogZarazConsent.astro` | The consent bridge (see the PostHog table) |

```json
"policies": ["posthog-hybrid", "tags-via-zaraz", "consent-before-tracking", "analytics-always-on"],
"posthog": { "embed": "npm", "cookieless": "on_reject" }
```

The gate can't see Zaraz: it runs only on Cloudflare's edge. Before merge,
Ship Gate checks the config, the consent test (no `_ga` or `ph_` storage
before consent) and the consent bridge's build. After deploy, it checks that
the Zaraz loader is on production. Cloudflare doesn't document whether the Zaraz
GA4 tool sets any cookie while `analytics_storage` is denied. So do the
checklist's production check once per site before its cookie policy says "no
cookies before consent".

Legal note: some EU and UK regulators consider measuring visitors before
consent unlawful even without cookies. The lawful basis and the policy wording
are the site owner's decisions.

**PostHog project settings.**
- *Cookieless server hash mode* = 2 (stateful), under Settings → Web analytics.
  Without it, events captured before consent are dropped.
- Turn on session replay (with console logs and network), heatmaps,
  autocapture, web vitals, exception autocapture, dead clicks and surveys.
- Add *`environment` is not `production`* to the internal and test account
  filter.

**Where each key goes** (Cloudflare dashboard, the Worker):
- `PUBLIC_POSTHOG_KEY`: Settings → Build → *Build variables*. It is read at
  build time and baked into the pages.
- `POSTHOG_API_KEY`, and with `turnstile-forms` the Turnstile secret: Settings
  → *Variables and Secrets*, type **Secret**. A plaintext variable there is
  wiped by the next deploy (the wrangler config owns plaintext vars).
- Both PostHog keys are the same `phc_` project key. A `phx_` personal key is
  refused by PostHog without an error, and it's a personal credential that must
  never sit in a site.
- List every runtime secret under `secrets.required` in the wrangler config:
  ```jsonc
  "secrets": { "required": ["POSTHOG_API_KEY", "TURNSTILE_SECRET_KEY"] }
  ```
  `wrangler deploy` and `wrangler versions upload` (every preview) then fail
  when one is unset, instead of shipping a Worker that silently sends nothing.
  Once `secrets` is set, `wrangler dev` loads only the secrets listed, so list
  all of them. Ship Gate warns when the list is missing (an error from v4).

CI never needs a real key: Ship Gate builds with its own CI-only key, and
post-deploy fails if that one reaches production.

Testing a form by hand: a Turnstile token works for one submission only, so
reload the page before submitting again.

### Guards

These apply to every site:

- **No committed `.env` or `.dev.vars` files**, anywhere in the repository, even
  outside the site directory. `.example` files are fine.
- **Node pinned** in `.nvmrc` or `.node-version`, at 22.12.0 or later (Astro
  7's floor). A bare `22` warns: pin the exact version so CI and Workers Builds
  agree.
- **No workflow pushes to `main`.** Pushing to `main` skips the PR and its
  checks. There is no exemption; a bot opens a PR like anyone else.
- **Lighthouse reports stay private.** Temporary public storage fails.
- **One dependency bot.** Dependabot and Renovate together warn: every update
  would arrive twice.

The contract check also refuses any script CI runs that writes to production:
`build`, `check`, `lint`, `test`, `preview`, the install scripts `npm ci` runs
(`preinstall`, `install`, `postinstall`, `prepare`) and site checks. Production
writes are `wrangler deploy`/`secret`/`versions deploy`, R2 or KV writes,
`--remote`, remote migrations, `git push` and IndexNow submissions. It follows
the `pre`/`post` scripts npm runs around each one, calls through `npm`, `pnpm`,
`yarn`, `run-s`, `run-p` and `npm-run-all` (globs included), and reads the Node
and shell files a script starts, with their comments stripped first: a JSDoc
line or `# …` comment that names `wrangler deploy` is prose, not a command
(`/* … */` and `//` comments in Node files, but never the `//` of a URL or
anything inside a string; whole-line and trailing ` #` comments in shell
files). So `"verify": "npm run deploy"`,
`"postbuild": "node scripts/ping-indexnow.mjs"` and `execSync('wrangler deploy')`
in a Node file are caught too. CI builds every PR; a
merge gate must be read-only.

### Guard exemptions

A site that breaks a guard today can adopt the gate now and fix it on a
deadline:

```json
"guardExemptions": [
  { "guard": "node-pin", "reason": "Node upgrade lands with the Astro bump",
    "restoreBy": "2026-11-30" }
]
```

The guard then warns on every run instead of failing, until `restoreBy`, when
the build fails again. Core guards: `node-pin`, `public-lighthouse`. Policy
guards, exemptible only when the site uses the policy:

- `posthog-server-only`: `posthog-client` (SDK, snippet, direct use outside
  server paths, client bundle, browser calls), `posthog-public-var`,
  `posthog-us-host` and `posthog-env-tag`
- `posthog-hybrid`: `posthog-missing` (no browser init, or a page without it),
  `posthog-server` (`posthog-node` missing or outside server paths),
  `posthog-csp`, `posthog-public-var`, `posthog-us-host` and `posthog-env-tag`
- `tags-via-zaraz`: `direct-tags`
- `turnstile-forms`: `turnstile`
- `workers-builds-only`: `pages-config` and `cloudflare-in-workflows`
- `market-cn`: `blocked-in-cn`
- `consent-before-tracking`: `consent`
- `analytics-always-on`: no guards of its own; it relies on `tags-via-zaraz`'s
  `direct-tags`, the `consent` check, and `posthog-hybrid`'s guards

Never exemptible: a committed env file, a workflow pushing to `main`, and (with
`posthog-server-only` or `posthog-hybrid`) a hard-coded PostHog key.

## Site configuration

`ship-gate.config.json` in the site directory:

| Field | Default | Meaning |
|---|---|---|
| `siteUrl` | required | Production origin, e.g. `https://example.com` |
| `pages` | required | One path per key template: home, service or product, contact, article |
| `policies` | `[]` | Stack policies this site follows; see Stack policies |
| `formPages` | `[]` | Every page with a public form (the `turnstile-forms` policy checks the widget there) |
| `smokePaths` | `/`, `/robots.txt`, `/sitemap-index.xml` | Checked on production after deploy |
| `server` | `static` | `static` serves the built files (handles `dist/client` from the Cloudflare adapter); `preview` runs `npm run preview` |
| `distDir` | `dist` | The build output folder |
| `lighthouseUrls` | same as `pages` | A list of paths, or `"all"` for every indexable page the build emits |
| `e2ePages` | same as `pages` | Pages for smoke, axe, reflow and CSP; a list or `"all"` |
| `lighthouseBlockedUrls` | `[]` | Extra URL patterns to block during Lighthouse, e.g. `"*/relay/*"` |
| `structure` | `{ "titleMax": 75 }` | Title and description bands: `titleMin`, `titleMax` (≤ 75), `descMin`, `descMax` |
| `copyAllowlist` | `[]` | Exact strings the placeholder scan allows, e.g. `"[Your Name]"` |
| `securityHeaders` | see Browser checks | Headers the home page must send; add to the list, never remove |
| `reflowWidths` | `[320, 360, 390]` | Narrow widths for the reflow check; must include 320 |
| `keyboard` | `warn` | `error` makes keyboard findings fail the gate |
| `consentEssentialCookies` | `[]` | With `consent-before-tracking`: cookie names that are strictly necessary and may be set before consent |
| `checks.preBuild` | `[]` | npm script names to run before the build (`test` already runs if present) |
| `checks.postBuild` | `[]` | npm script names to run against the built output |
| `checks.browser` | `[]` | npm script names run against the served build; they get `SHIP_GATE_BASE_URL` and `BASE_URL`, and use the site's own Playwright |
| `guardExemptions` | `[]` | See Guard exemptions |
| `discoveryOverrides` | `[]` | Raise or lower a discovery rule; see Discovery scan |
| `discovery.sitemap` | from `robots.txt`, else `/sitemap-index.xml` or `/sitemap.xml` | The sitemap's path |
| `discovery.ignoreLinks` | `[]` | Path prefixes the Worker serves rather than the static build, e.g. `"/api/"`; the link check skips them |
| `discovery.aiTraining` | `"block"` | `"block"`: AI training crawlers must be disallowed. `"reserve"`: they may fetch, but the group governing each must say `Content-Signal: ai-train=no`. `"allow"`: they must not be disallowed. See Discovery scan |
| `discovery.searchCrawlers` | `[]` | Crawler tokens that must reach every indexable page besides Googlebot and Bingbot, e.g. `"Baiduspider"`, `"Yeti"` |
| `python` | none | `{ "version": "3.11", "packages": ["fonttools"] }` for Python checks |
| `posthog.embed` | `"snippet"` | With `posthog-hybrid`: `"snippet"` (the inline loader from PostHog's Astro guide) or `"npm"` (`posthog-js` bundled) |
| `posthog.cookieless` | `"on_reject"` | With `posthog-hybrid`: `"on_reject"`, `"always"` or `"off"`; must match `cookieless_mode` in the options file |
| `posthog.apiHost` | `"https://eu.i.posthog.com"` | With `posthog-hybrid`: EU Cloud, or a same-origin proxy path such as `"/ph"` (the proxy template's default) |
| `turnstileEnv` | `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | With `turnstile-forms`: env names that receive Cloudflare's always-pass test keys |
| `thresholdOverrides` | `[]` | See below |

Site checks are npm script names only, never raw commands. A check that needs
arguments gets its own script, e.g. `"lastmod:check": "node scripts/gen-lastmod.mjs --check"`.

## Threshold overrides

A site may make any standard **stricter** with no reason needed:

```json
"thresholdOverrides": [
  { "audit": "categories:performance", "level": "error" },
  { "audit": "categories:accessibility", "minScore": 1 },
  { "audit": "categories:best-practices", "minScore": 1 }
]
```

A site may make one **looser** only with a reason and a restore date:

```json
"thresholdOverrides": [
  { "audit": "largest-contentful-paint", "maxNumericValue": 5000,
    "reason": "Hero video pending re-encode", "restoreBy": "2026-12-31" }
]
```

The gate rejects a loosening with no reason, one past its restore date, one
that changes nothing, and any audit not in the standard. An expired override
fails the build until the standard is restored or the override is renewed.
The v1 form `{ "category": "performance", ... }` is still accepted.

## One-time setup of this repo

1. **Allow the site repos to use it** (only while this repo is private).
   Settings → Actions → General → Access → *Accessible from repositories
   owned by* this account or organisation. Without this, every site's `verify`
   fails to download the action.
2. **Protect `main`.** Settings → Rules → Rulesets: require a pull request,
   require the `self-test` check, block force pushes and deletions.
3. **Releases are automatic.** The `release` job in `self-test.yml` publishes
   the tag and GitHub release for the newest `CHANGELOG.md` version on the first
   green push to `main` that carries it (see Changing Ship Gate). Nothing to do
   by hand; site templates pin these tags. If a push run was cancelled before
   it released, run the Self-test workflow on `main` by hand (Actions → Self-test
   → Run workflow). It re-runs every check, then publishes the missing release.
   Never create a release tag by hand: only green commits are tagged.

## What stays in the site repo

Checks about one brand or one site's content stay in the site repo and run
through `checks`: brand-token contrast, font glyph coverage, design-drift
scans, copy canon, price wording, voice lint, image budgets, motion and
navigation scripts. Ship Gate never learns a brand's name, colours or voice.
(`docs/portfolio-ci-audit-2026-09-24.md` is the dated audit of the first
portfolio that adopted the gate, kept as history.)

Never in the gate, whatever the site: deploys, `wrangler` against production,
remote D1 migrations, R2 or KV writes, Worker secrets, IndexNow submissions,
content syncs that commit, and paid API calls. Checks against production
belong in `post-deploy.yml` or a scheduled workflow.

## Adopting it in a site repo

1. Copy `templates/caller/` into the repo. The workflows and `dependabot.yml`
   go at the repo root; `ship-gate.config.json` goes in the site directory. Add
   `gitignore-additions.txt` to the site's `.gitignore`.
2. If the site is not at the repo root, set `working-directory` in both
   workflow files and the npm `directory` in `dependabot.yml`.
3. Delete what Ship Gate now owns: old kit copies (`scripts/guards.sh`,
   `scripts/check-dist.sh`) and the site's own `lighthouserc.*`. Move any
   stricter Lighthouse thresholds into `thresholdOverrides` first.
4. Move the site's existing CI checks into `checks`, then delete the old
   workflow steps they replace. Keep scheduled operational workflows (IndexNow,
   content sync) as they are, unless a guard flags them.
5. Fill in `pages`, and `policies` if the site follows any stack policy
   (`formPages` too with `turnstile-forms`).
6. Make the site discoverable, or the discovery scan lists what is missing: a
   `robots.txt` with a `Sitemap:` line, a sitemap (`@astrojs/sitemap`), one
   canonical, Open Graph tags and `lang` in the base layout, and Organization or
   Person JSON-LD on the home page. Run the scan locally (below) before the
   first PR.
7. Keep the standard script names `check` and `build`, and `preview` if
   `server` is `preview`. Ship Gate installs its own Playwright, axe and
   Lighthouse CI; the site needs none of them for the gate.
8. Pin Node 22.12.0 or later in `.nvmrc` or `.node-version`, and set the same
   `NODE_VERSION` build variable in Workers Builds.
9. Add the build-time markers to `astro.config.mjs`:
   ```js
   vite: {
     define: {
       __BUILD_SHA__: JSON.stringify(process.env.WORKERS_CI_COMMIT_SHA ?? 'local'),
       __DEPLOY_ENV__: JSON.stringify(
         process.env.WORKERS_CI_BRANCH === 'main' ? 'production'
           : process.env.WORKERS_CI ? 'preview' : 'local'),
     },
   },
   ```
   Declare both in `src/env.d.ts` and put
   `<meta name="build-sha" content={__BUILD_SHA__} />` in the base layout
   `<head>`. With `posthog-server-only`, also add `environment: __DEPLOY_ENV__`
   to every event in `src/lib/server/analytics.ts`; the wrapper must send
   nothing when `POSTHOG_API_KEY` is absent.
   With `posthog-hybrid`, copy `templates/caller/posthog/` and follow PostHog in
   the browser and on the server.
10. With `posthog-server-only` or `posthog-hybrid`, in the site's PostHog project, add *`environment` is not `production`* to
   the internal and test account filter, applied by default.
11. Ruleset on the site's `main`: require a pull request, require the `verify`
    check, require the branch to be up to date, block force pushes and
    deletions. Required approvals: 0 while one person is the only committer.
12. Workers Builds: production branch `main`, non-production branch builds on,
    preview URLs on.
13. Turn on secret scanning, push protection and Dependabot alerts.
14. Let Dependabot see Ship Gate's releases. This repo is private, so the
    template's `dependabot.yml` reads it through a `git` registry whose token is
    the Dependabot secret `SHIP_GATE_READ_TOKEN`. Create one fine-grained
    personal access token (resource owner `pauljosephdp`, only
    `pauljosephdp/Ship-Gate`, permission Contents: read-only), then add it to
    each site under Settings → Secrets and variables → **Dependabot** (not
    Actions) as `SHIP_GATE_READ_TOKEN`. Without it, Dependabot's
    `github_actions` job fails with "Repository not found" and never raises the
    Ship Gate pin. When the token expires, renew it and update the secret in
    every site.

Claude Code prompt for steps 1–9:

> Adopt Ship Gate v3.5.2 in this repo following pauljosephdp/Ship-Gate README
> "Adopting it in a site repo", steps 1–9. Carry every existing CI check into
> `checks` rather than dropping it. Run `npm run check` and `npm run build`
> locally, then the discovery scan, and fix or list every failure. Open a PR
> titled "chore: adopt ship gate v3.5.2". Do not change deploy configuration
> or Cloudflare settings.

Run the discovery scan locally after `npm run build`, from the site directory,
with a checkout of Ship Gate beside it:

```sh
node ../Ship-Gate/scripts/prepare.mjs after-build && node ../Ship-Gate/scripts/check-discovery.mjs
```

## Changing Ship Gate

Every change goes through a PR to this repo, and `self-test` must pass.
`scripts/self-test.sh` builds fixture sites at run time and proves each guard,
config rule, scan, server behaviour and generated Lighthouse setting still fires
on bad input and passes on good input. Add a case there for every new rule. It
also runs the template unit tests (`node --test test/*.test.mjs`, which import
the `.ts` templates through Node 22's type stripping).

The `fixture` jobs then run the whole action, end to end, against
`test/fixture-site` (a tiny Astro site) and against copies broken one way each
by `test/break-fixture.sh`: missing alt text, a too-wide element, a CSP
violation, a dead redirect, two `h1`s, a directly loaded tag, an AI search
crawler blocked in `robots.txt`, invalid JSON-LD, an Arabic page without
`dir="rtl"`, a Google Fonts stylesheet (`market-cn`), a link with its focus
ring removed, a tracking cookie before consent, PostHog missing from some pages
or blocked by the CSP (`posthog-hybrid`). The conforming
run, one that shows a site file named after a tracking vendor, and
`posthog-hybrid` (the fixture switched to `posthog-hybrid`, built from
`templates/caller/posthog/` with `posthog-js` and `posthog-node` installed at
the versions `break-fixture.sh` pins) must pass;
each broken run must fail on the check that owns the fault (`test/expect-gate.sh`).
Each variant stops at the stage that owns its fault (`expect-gate.sh --stage`),
passed as the action's `stage` input, so every fixture run exercises the same
input the caller template uses for drafts: `scans` variants stop after the
post-build scans, `browser` variants skip Lighthouse, and only the conforming
run does everything. Skipped checks read "➖ not run" in the summary, and
`expect-gate.sh` asserts that too. Fixture runs upload no reports; the
summary table in the log is what `expect-gate.sh` reads. Two jobs share the variants,
`fixture (browser)` and `fixture (scans)`; a new variant goes in a free `vN`
slot, and `self-test` fails until it has an expectation, a stage and a slot.
The fixture jobs exercise the verify action only, so they run when a change
touches it: `action.yml`, `scripts/` (not `self-test.sh`, `release.sh`,
`check-readme.sh` or the post-deploy `check-*-live.mjs`), `e2e/`, `tools/`,
`test/`, the Playwright and Lighthouse configs, or `self-test.yml`. Pull
requests skip them while in draft and when they touch none of those (docs,
`post-deploy/`, `templates/`). A push to `main` skips them when it touches none
of those since the previous `main` commit, or when its pull request already
passed both fixture jobs on the exact same tree (each passing job uploads a
`fixtures-passed-<tree>-<group>` artifact); if `main` moved in between, or on
a manual run, everything runs.
Within a fixture job, only the first variant installs. `break-fixture.sh` keeps
the fixture's and the test tools' `node_modules`, and the action, again only
from this repo's own checkout, reuses them: no `npm ci`, no npm or Playwright
cache restore. Sites always install from scratch.

Open a PR as a draft and push to it freely: only `self-test` runs (about a
minute). Mark it ready for review once the work is final; the fixture jobs
then run once. Ship Gate's own `.github/dependabot.yml` groups each ecosystem's
updates into one PR and does not rebase open PRs when `main` moves, since each
push to a Dependabot PR runs the whole suite. Comment `@dependabot rebase` on
one that conflicts.

**README.md stays current.** `scripts/check-readme.sh` runs in `self-test` and
fails when:
- a PR changes what Ship Gate does (`action.yml`, `post-deploy/`, `scripts/`,
  `e2e/`, `templates/`, `tools/`, workflows) without changing this README;
- a version this README or the caller templates tell sites to pin is not the
  newest `CHANGELOG.md` version.

Changes to tests, `CLAUDE.md`, `CHANGELOG.md` and `docs/` alone need no README
change.

Every PR that should ship adds a section at the top of `CHANGELOG.md`, headed
`## vX.Y.Z — YYYY-MM-DD`. When the PR merges and `self-test` passes on
`main`, with every `fixture` job passed there or on the same tree in the PR, the `release` job (`scripts/release.sh`)
creates the tag and a GitHub release with that section as its notes. A version
already released, or a heading marked `(not released)`, publishes nothing (the
`release` job does not even start a runner), so
a PR that changes only docs or CI can leave the changelog alone. A red `main`
never releases. Choose the version by its effect on site repos:

- **Major** (v2.0.0): a site must change something to stay green. A new failing
  guard, a new required script, a stricter standard.
- **Minor** (v1.2.0): new warnings, new optional config, new checks that a
  conforming site already passes.
- **Patch** (v1.1.1): fixes that make no conforming site fail.

Dependabot then opens a PR in each site repo, and that PR runs through the
site's own `verify` before merging. A bad release fails on one PR instead of
breaking every site at once.

## Out of scope

Some items on common SEO and GEO checklists are not checked by the gate. Each
is left out for a reason:

- **Content quality for AI answers:** self-contained "answer island"
  paragraphs, statistics density, expert quotes, fluency, keyword density.
  These are editorial judgements. A heuristic would fail good pages, and no
  search or AI vendor documents a threshold for them. Keep them in editorial
  review, or in a site's own `checks`.
- **WAF and bot management:** allowlisting AI crawlers' published IP ranges,
  reverse-DNS verification, rate-limit exceptions, blocking crawlers that send
  no user agent. These live in the CDN, where a CI runner can't see them.
  Post-deploy catches the symptom (403/429 to a plain request). On Cloudflare,
  allow verified bots in bot management and rate-limiting rules rather than
  matching user-agent strings, which anyone can spoof.
- **Legal and regional compliance:** prohibited content, VAT logic, ICP
  licensing, privacy-policy accuracy.
- **Accessibility overlays:** text-to-speech toggles, contrast widgets and
  reading guides are not WCAG conformance. The gate tests the page itself
  (axe, keyboard, reflow).
- **IndexNow submission:** a write to a search engine. The contract forbids it
  in the gate; keep it in a scheduled workflow.

## Open items

- **[TO CONFIRM]** Dependabot can open Ship Gate bump PRs from a private repo
  in a personal account. If it can't, bump the pinned version by hand in each
  site's two workflow files.
- **[TO CONFIRM]** `WORKERS_CI_COMMIT_SHA` and `WORKERS_CI_BRANCH` are present
  in production builds, so the post-deploy SHA check and environment tagging
  both work.
- The discovery scan reads the static build. Pages rendered on request by the
  Worker are outside it: list their prefixes in `discovery.ignoreLinks`, and
  cover them with a site browser check.
- Pages that render on the server rather than at build time are not served by
  the `static` server, which serves only what `output: 'static'` emits. A site that adds server-rendered pages to `pages` sets
  `"server": "preview"`, which has not yet been proven with the Cloudflare
  adapter in CI.
