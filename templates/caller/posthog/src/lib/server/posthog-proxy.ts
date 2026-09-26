// Same-origin reverse proxy for PostHog (posthog-hybrid), run from the Worker entry
// (src/worker.ts) before Astro. The browser talks to the site's own origin, so ad
// blockers don't drop events and CSP needs only 'self'. In the Worker entry it needs no
// on-demand rendering, and Astro's trailingSlash never redirects PostHog's POSTs.
// Set POSTHOG_API_HOST to '/ph' in src/lib/posthog-options.ts and posthog.apiHost to
// "/ph" in ship-gate.config.json. A pure function: tests stub fetch.
const API = 'eu.i.posthog.com';
const ASSETS = 'eu-assets.i.posthog.com';

// null when the request is not for PostHog, so the caller falls through to Astro.
export function posthogProxy(request: Request, prefix = '/ph'): Promise<Response> | null {
  const url = new URL(request.url);
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null;
  const path = url.pathname.slice(prefix.length) || '/';
  const host = path.startsWith('/static/') || path.startsWith('/array/') ? ASSETS : API;
  const headers = new Headers(request.headers);
  headers.delete('cookie'); // the site's cookies are not PostHog's business
  headers.set('host', host);
  // PostHog geolocates by the visitor's address, not the Worker's.
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body;
  return fetch(`https://${host}${path}${url.search}`, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit).then((res) => {
    // PostHog never sets cookies on the site's domain.
    const out = new Headers(res.headers);
    out.delete('set-cookie');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  });
}
