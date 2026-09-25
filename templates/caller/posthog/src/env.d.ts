/// <reference types="astro/client" />
// Build-time markers (astro.config.mjs → vite.define) and the PostHog browser globals.
declare const __BUILD_SHA__: string;
declare const __DEPLOY_ENV__: 'production' | 'preview' | 'local';

interface ImportMetaEnv {
  /** PostHog project key (phc_…). Public by design; set it in Workers Builds, never in code. */
  readonly PUBLIC_POSTHOG_KEY?: string;
}

interface Window {
  posthog?: unknown;
  __posthog_initialized?: boolean;
}
