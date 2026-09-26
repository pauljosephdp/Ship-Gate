// PostHog on the server (posthog-node), for the posthog-hybrid policy. Server paths only
// (src/lib/server, src/pages/api, src/actions, src/middleware): nothing here reaches the browser.
// Sends nothing when POSTHOG_API_KEY (a Worker secret; the same phc_ project key) is absent.
import { PostHog } from 'posthog-node';

type Env = { POSTHOG_API_KEY?: string };
type Ctx = { waitUntil(p: Promise<unknown>): void };
type Properties = Record<string, unknown>;
/** The browser's PostHog ids, sent in a form post's body (see browserIds). */
export type BrowserIds = { distinctId?: string; sessionId?: string };

const HOST = 'https://eu.i.posthog.com';
let warned = false;

// One client per request: a Worker may not outlive the response, so flush every event
// at once and hand the flush to waitUntil, or events are silently dropped.
function client(env: Env) {
  const key = env.POSTHOG_API_KEY?.trim();
  if (!key) {
    // Binding names only, never values: shows whether the secret reached this Worker at all.
    if (!warned) console.warn(`[analytics] POSTHOG_API_KEY is not set; no server events. Bindings: ${Object.keys(env).join(', ') || 'none'}`);
    warned = true;
    return null;
  }
  const ph = new PostHog(key, { host: HOST, flushAt: 1, flushInterval: 0 });
  // shutdown() swallows PostHog's own errors (a wrong or phx_ key is refused silently).
  ph.on('error', (e) => console.error('[analytics] PostHog error:', e));
  return { ph, key };
}

const id = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : undefined);

/**
 * The browser's ids from a parsed JSON form body. Posthog-js adds the tracing headers from a
 * lazily loaded extension, so the first form post often goes out without them. Send the ids
 * in the body too:
 *   posthog: { distinctId: window.posthog?.get_distinct_id(), sessionId: window.posthog?.get_session_id() }
 */
export function browserIds(body: unknown): BrowserIds {
  const p = (body as { posthog?: Record<string, unknown> } | null)?.posthog;
  return { distinctId: id(p?.distinctId), sessionId: id(p?.sessionId) };
}

// The browser's identity for this request, so server events join the visitor's session:
// the tracing headers posthog-js adds to requests to the site's own host (tracing_headers),
// then ids sent in the body, then the PostHog cookie (present only after consent). With
// none of them, a random id that creates no person profile: a shared id would merge every
// anonymous visitor into one person.
export function visitor(request: Request, key?: string, ids: BrowserIds = {}) {
  const h = request.headers;
  let cookie: { distinct_id?: unknown; $sesid?: unknown[] } = {};
  if (key) {
    const name = `ph_${key}_posthog=`;
    const raw = (h.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(name))?.slice(name.length);
    try { cookie = raw ? JSON.parse(decodeURIComponent(raw)) : {}; } catch { /* not PostHog's JSON */ }
  }
  const distinctId = id(h.get('x-posthog-distinct-id')) ?? ids.distinctId ?? id(cookie.distinct_id);
  const sessionId = id(h.get('x-posthog-session-id')) ?? ids.sessionId ?? id(cookie.$sesid?.[1]);
  return distinctId
    ? { distinctId, sessionId, anonymous: false }
    : { distinctId: crypto.randomUUID(), sessionId, anonymous: true };
}

// Every event carries the deploy environment, so preview traffic stays out of production data.
const tag = (properties: Properties, v: ReturnType<typeof visitor>) => ({
  ...properties,
  environment: __DEPLOY_ENV__,
  ...(v.sessionId ? { $session_id: v.sessionId } : {}),
  ...(v.anonymous ? { $process_person_profile: false } : {}),
});

const sending = (event: string, key: string) => console.log(`[analytics] sending ${event} key ${key.slice(0, 8)}… (${key.length} chars)`);

export function track(env: Env, ctx: Ctx, request: Request, event: string, properties: Properties = {}, ids?: BrowserIds) {
  const c = client(env);
  if (!c) return;
  const v = visitor(request, c.key, ids);
  sending(event, c.key);
  c.ph.capture({ distinctId: v.distinctId, event, properties: tag(properties, v) });
  ctx.waitUntil(c.ph.shutdown());
}

// Error tracking: report a caught server error against the visitor who hit it.
export function trackError(env: Env, ctx: Ctx, request: Request, error: unknown, properties: Properties = {}, ids?: BrowserIds) {
  const c = client(env);
  if (!c) return;
  const v = visitor(request, c.key, ids);
  sending('$exception', c.key);
  c.ph.captureException(error, v.distinctId, tag(properties, v));
  ctx.waitUntil(c.ph.shutdown());
}

// Feature flags on the server, for the same visitor the browser evaluates them for.
// An anonymous visitor gets a fresh random id, so percentage rollouts vary per request.
export async function flag(env: Env, ctx: Ctx, request: Request, key: string, ids?: BrowserIds) {
  const c = client(env);
  if (!c) return undefined;
  const { distinctId } = visitor(request, c.key, ids);
  try {
    return await c.ph.getFeatureFlag(key, distinctId);
  } finally {
    ctx.waitUntil(c.ph.shutdown());
  }
}
