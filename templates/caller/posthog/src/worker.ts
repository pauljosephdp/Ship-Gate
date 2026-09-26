// The Worker entry (wrangler config: "main": "./src/worker.ts"), for the optional PostHog
// proxy. A site that already has a worker.ts adds the posthogProxy import and the first
// line of fetch. Static assets are served before the Worker runs; /ph/* never matches one.
import { handle } from '@astrojs/cloudflare/handler';
import { posthogProxy } from './lib/server/posthog-proxy';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return posthogProxy(request) ?? handle(request, env, ctx);
  },
};
