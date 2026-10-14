import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Static by default; pages opt into rendering on request with `export const prerender = false`.
export default defineConfig({ site: 'https://example.com', output: 'static', trailingSlash: 'always', adapter: cloudflare() });
