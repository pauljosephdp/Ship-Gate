# Intent: posthog-secrets asks for the Turnstile secret only when a form uses Turnstile

Author: Claude
Source: site CI (web-baseline 6.15.1 upgrade PRs on Playway and LowLightKing, 15 Nov 2026)
Status: accepted
Accepted-by: Paul, 15 Nov 2026 ("merge the upgrade PRs when green")

## Problem

Under `posthog-hybrid` with `turnstile-forms`, the `posthog-secrets` guard (an error from v4) requires the Turnstile
secret in the wrangler config's `secrets.required`, even when no form in `src` uses Turnstile. Playway removed its only
form on 3 Sep 2026 and LowLightKing's forms are `turnstile-exempt`, so neither Worker holds a Turnstile secret.
Declaring one would fail every deploy, and not declaring it fails `verify`: the sites cannot pass either way.

## Outcome

The Turnstile secret joins `need` only when `src` has a Turnstile marker (`cf-turnstile` or `<Turnstile`, any case),
the same test guard 3b uses. `POSTHOG_API_KEY` stays required. A site with a Turnstile form is unchanged.

## Who is affected

Sites on `turnstile-forms` with no Turnstile form: they pass. No conforming site can start failing, so this is a patch.
