# Zaraz setup (analytics-always-on)

Google Analytics and PostHog run on every page, with or without consent. Neither stores
anything in the visitor's browser until the visitor accepts analytics. Ship Gate can't see the Zaraz dashboard, so work through this list once per site.
After every new Zaraz tool, check Consent again: **a tool with no purpose loads without
consent**.

## Zaraz (Cloudflare dashboard → the zone → Zaraz)

1. **Tools → Google Analytics 4.** Add or keep the GA4 tool with the site's measurement ID.
   Load GA only here: `tags-via-zaraz` fails a GA or GTM tag in the site's code.
2. **Settings → "Set Google Consent Mode v2 state".** Turn it on, with all four signals
   denied by default: `ad_storage`, `ad_user_data`, `ad_personalization` and
   `analytics_storage`. GA then sends hits without cookies until the visitor accepts.
3. **Consent → enable the consent modal**, with these purposes:
   - **Analytics.** Assign **no tools** to it. `PostHogZarazConsent.astro` reads the answer
     (set its `PURPOSE_ID` to this purpose's ID). On yes it grants `analytics_storage` for
     GA and opts PostHog in. On no it denies both.
   - **Marketing.** Assign every ads or marketing tool to it: Meta, LinkedIn, TikTok and
     HubSpot tracking. These load only after consent.
4. **Consent → Assign purposes.** Leave the GA4 tool with **no purpose**, so it loads on
   every page. Every other tool has a purpose.
5. Publish.

## PostHog

6. Follow the `posthog-hybrid` templates (`templates/caller/posthog/`), keeping
   `cookieless_mode: 'on_reject'` with `opt_out_capturing_by_default`. Then render
   `optional/src/components/PostHogZarazConsent.astro` right after the PostHog component,
   and add its `assetsInlineLimit` line to `astro.config.mjs` so a CSP doesn't block it.

## Check it once on production

7. In a private window, with no choice made yet:
   - DevTools → Application → Cookies should show no `_ga`, `_ga_*` or `ph_*`
     cookie, and there should be no `ph_*` localStorage key.
   - Network should show requests to `/cdn-cgi/zaraz/` (GA) and to PostHog (or its `/ph`
     proxy).
8. Accept Analytics. `_ga`, `_ga_*` and `ph_*` should appear. Reject in another private
    window: nothing should be stored.

Cloudflare doesn't document whether the Zaraz GA4 tool sets any cookie while
`analytics_storage` is denied. Step 7 is how you know. Do it before the cookie policy
says "no cookies before consent".
