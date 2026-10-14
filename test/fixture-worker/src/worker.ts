// The Worker answers the pages rendered on request (wrangler.jsonc run_worker_first); it gives them the same
// security headers and CSP that public/_headers gives the static files.
import { cf, finalize } from '@astrojs/cloudflare/fetch';
import { astro, FetchState } from 'astro/fetch';

const HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
};

export default {
  async fetch(request, env, ctx) {
    const state = new FetchState(request);
    const response = (await cf(state, env, ctx)) ?? finalize(state, await astro(state));
    const out = new Response(response.body, response);
    for (const [name, value] of Object.entries(HEADERS)) if (!out.headers.has(name)) out.headers.set(name, value);
    return out;
  },
} satisfies ExportedHandler<Env>;
