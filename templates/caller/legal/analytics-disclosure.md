# Analytics disclosure for the cookie and privacy policy (analytics-always-on)

Paste-ready text for a site that runs Google Analytics 4 (through Cloudflare Zaraz, in Google
Consent Mode v2) and PostHog (EU Cloud) on every page, as `analytics-always-on` requires.

**This is not legal advice. Review it with counsel before publishing.** Some EU and UK
regulators consider measuring visitors before consent unlawful even when no cookie is
set. Your lawful basis (usually legitimate interests, with a balancing test on file)
and your consent banner's wording are decisions for the site owner.

Before publishing:
- Fill in the `[brackets]`.
- Check the cookie names and lifetimes in your own browser: accept Analytics, then look
  in DevTools → Application → Cookies.
- Don't claim that session replay runs before consent. It hasn't been confirmed; see
  Ship Gate's README.

---

## Analytics

We measure how people use this site so we can improve it. Two services do this on every
page, whether or not you accept analytics cookies. Until you accept, neither stores anything
on your device.

**Google Analytics 4** (Google Ireland Ltd / Google LLC) runs through Cloudflare Zaraz, in
Google Consent Mode.
- Before you choose, or if you decline, it sets no cookies. It sends Google page-view
  signals without an identifier: the page, time, browser, approximate location and your
  consent choice. Google may use them to estimate overall traffic.
- If you accept, it sets `_ga` and `_ga_[ID]` (up to 2 years) to recognise return visits.
- Google may process data in the United States under the EU–US Data Privacy Framework.
- [Google's privacy policy](https://policies.google.com/privacy).

**PostHog** (PostHog Inc., hosted in the EU) records page views, clicks and site
performance, and may run surveys.
- Before you choose, or if you decline, it stores nothing on your device. It counts
  visits with a one-way code, made from your IP address and browser details, that
  changes every day and can't identify you on its own.
- If you accept, it sets `ph_[project key]_posthog` (1 year) to recognise return visits.
  [It may also record your session to help us fix problems.]
- [PostHog's privacy policy](https://posthog.com/privacy).

## Your choices

Use [the cookie settings link] to accept or decline analytics cookies at any time.
Declining stops Google Analytics and PostHog from storing anything on your device; it does
not delete what they measured before. Advertising tags [list them, or "We use none"] load
only if you accept Marketing.
