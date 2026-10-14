import type { APIRoute } from 'astro';

// Rendered on request, and not a page: the on-demand check only needs it to answer.
export const prerender = false;

export const GET: APIRoute = () =>
  new Response('<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Ship Gate fixture</title></channel></rss>', {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
