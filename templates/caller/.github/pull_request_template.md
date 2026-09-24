## What changed

## Why

## Preview URL
<!-- Paste the Cloudflare Workers Builds preview link -->

## Checklist
- [ ] CI `verify` is green
- [ ] Checked the preview on mobile and desktop (layout, GSAP animations, reduced-motion)
- [ ] Brand review skill run for this site: no drift (Portus / FullFrameGear: manual check against brand guide)
- [ ] Forms: Turnstile renders and server-side verification works on the preview
- [ ] Tracking: all tags (incl. GTM) via Zaraz only; business events server-side via PostHog; consent respected
- [ ] PostHog: preview events carry `environment: "preview"` and are excluded from production dashboards
- [ ] PostHog: new events fired from `src/lib/server` wrapper and confirmed arriving in PostHog EU from the preview
- [ ] Copy: no unverified figures; every `[TO CONFIRM]` resolved or deliberately left
- [ ] New key templates or form pages added to `ship-gate.config.json`
