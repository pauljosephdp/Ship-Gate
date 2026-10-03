## What changed

## Why

## How it was checked
<!-- `verify` runs the whole gate on this pull request. Nothing builds a branch on Cloudflare: production is the first Cloudflare build. -->

## Checklist
- [ ] CI `verify` is green, including the discovery table in the job summary
- [ ] Checked the change locally on mobile and desktop (layout, animations)
- [ ] Brand review: no drift from this site's brand guide or design system
- [ ] New pages: in the sitemap, with a unique title, meta description, canonical and Open Graph image
- [ ] New structured data describes only what the page visibly says
- [ ] Forms: bot protection renders and server-side verification works locally (the Worker tests) and after the deploy
- [ ] Tracking: tags load the way this site's policies require; consent respected
- [ ] Copy: no unverified figures; every `[TO CONFIRM]` resolved or deliberately left
- [ ] New key templates or form pages added to `ship-gate.config.json`
