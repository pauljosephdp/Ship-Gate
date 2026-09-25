// PostHog on the server (posthog-node), for the posthog-hybrid policy. Server paths only
// (src/lib/server, src/pages/api, src/actions, src/middleware): nothing here reaches the browser.
// Sends nothing when POSTHOG_API_KEY (a Worker secret; the same phc_ project key) is absent.
import { PostHog } from 'posthog-node';

type Env = { POSTHOG_API_KEY?: string };
type Ctx = { waitUntil(p: Promise<unknown>): void };
type Properties = Record<string, unknown>;

const HOST = 'https://eu.i.posthog.com';

// One client per request: a Worker may not outlive the response, so flush every event
// at once and hand the flush to waitUntil, or events are silently dropped.
function client(env: Env) {
  return env.POSTHOG_API_KEY ? new PostHog(env.POSTHOG_API_KEY, { host: HOST, flushAt: 1, flushInterval: 0 }) : null;
}

// The browser's identity for this request, so server events join the visitor's session:
// the tracing headers posthog-js adds to requests to the site's own host (tracing_headers),
// then the PostHog cookie (present only after consent), else an anonymous server id.
export function visitor(request: Request, key?: string) {
  const h = request.headers;
  let distinctId = h.get('x-posthog-distinct-id') ?? undefined;
  if (!distinctId && key) {
    const name = `ph_${key}_posthog=`;
    const raw = (h.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(name))?.slice(name.length);
    try { distinctId = raw ? JSON.parse(decodeURIComponent(raw)).distinct_id : undefined; } catch { /* not PostHog's JSON */ }
  }
  return { distinctId: distinctId ?? 'server', sessionId: h.get('x-posthog-session-id') ?? undefined };
}

// Every event carries the deploy environment, so preview traffic stays out of production data.
const tag = (properties: Properties, sessionId?: string) =>
  ({ ...properties, environment: __DEPLOY_ENV__, ...(sessionId ? { $session_id: sessionId } : {}) });

export function track(env: Env, ctx: Ctx, request: Request, event: string, properties: Properties = {}) {
  const ph = client(env);
  if (!ph) return;
  const { distinctId, sessionId } = visitor(request, env.POSTHOG_API_KEY);
  ph.capture({ distinctId, event, properties: tag(properties, sessionId) });
  ctx.waitUntil(ph.shutdown());
}

// Error tracking: report a caught server error against the visitor who hit it.
export function trackError(env: Env, ctx: Ctx, request: Request, error: unknown, properties: Properties = {}) {
  const ph = client(env);
  if (!ph) return;
  const { distinctId, sessionId } = visitor(request, env.POSTHOG_API_KEY);
  ph.captureException(error, distinctId, tag(properties, sessionId));
  ctx.waitUntil(ph.shutdown());
}

// Feature flags on the server, for the same visitor the browser evaluates them for.
export async function flag(env: Env, ctx: Ctx, request: Request, key: string) {
  const ph = client(env);
  if (!ph) return undefined;
  const { distinctId } = visitor(request, env.POSTHOG_API_KEY);
  try {
    return await ph.getFeatureFlag(key, distinctId);
  } finally {
    ctx.waitUntil(ph.shutdown());
  }
}
