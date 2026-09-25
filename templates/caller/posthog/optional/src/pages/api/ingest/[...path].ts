// Optional reverse proxy for PostHog (posthog-hybrid): the browser talks to the site's own
// origin (/api/ingest), so ad blockers don't drop events and CSP needs only 'self'.
// Needs on-demand rendering (the Cloudflare adapter). Then set POSTHOG_API_HOST to
// '/api/ingest' in src/lib/posthog-options.ts and posthog.apiHost to "/api/ingest" in
// ship-gate.config.json.
import type { APIRoute } from 'astro';

export const prerender = false;

const API = 'eu.i.posthog.com';
const ASSETS = 'eu-assets.i.posthog.com';

export const ALL: APIRoute = async ({ request, params }) => {
  const url = new URL(request.url);
  const path = `/${params.path ?? ''}`;
  const host = path.startsWith('/static/') || path.startsWith('/array/') ? ASSETS : API;
  const headers = new Headers(request.headers);
  headers.delete('cookie'); // the site's cookies are not PostHog's business
  headers.set('host', host);
  // PostHog geolocates by the visitor's address, not the Worker's.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  return fetch(`https://${host}${path}${url.search}`, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  });
};
