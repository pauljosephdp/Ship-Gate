// PostHog browser options for the posthog-hybrid policy: every feature on, EU Cloud.
// Shared by both embeds, PostHog.astro (npm) and PostHogSnippet.astro (the Astro docs'
// snippet), so the two never drift. Keep it plain JSON: the snippet passes it to an
// inline script. tracing_headers is added at init, from the page's own hostname.
//
// Consent: cookieless_mode 'on_reject' with opt_out_capturing_by_default loads PostHog
// on every page before any choice and counts visitors with PostHog's daily-salted
// server hash; no cookie or storage is written until the visitor accepts
// (posthog.opt_in_capturing()), then PostHog uses cookies as usual. Turn on
// "Cookieless server hash mode" in the PostHog project (Settings → Web analytics),
// or cookieless events are dropped.
//   'always' — never store anything, no cookie banner needed.
//   remove both lines — cookies from the first page view, without asking (not
//   lawful in the EU without consent; Ship Gate refuses it with consent-before-tracking).
// Keep ship-gate.config.json → posthog.cookieless and posthog.apiHost in step.
export const POSTHOG_API_HOST = 'https://eu.i.posthog.com'; // or '/ph' with the optional proxy (src/lib/server/posthog-proxy.ts)

export const posthogOptions = {
  api_host: POSTHOG_API_HOST,
  ui_host: 'https://eu.posthog.com',
  defaults: '2026-08-30',
  person_profiles: 'always',
  autocapture: true,
  capture_pageview: 'history_change',
  capture_pageleave: true,
  capture_heatmaps: true,
  capture_dead_clicks: true,
  capture_exceptions: true,
  capture_performance: { web_vitals: true, network_timing: true },
  session_recording: { recordCrossOriginIframes: true },
  enable_recording_console_log: true,
  cookieless_mode: 'on_reject',
  opt_out_capturing_by_default: true,
  cross_subdomain_cookie: true,
} as const;
