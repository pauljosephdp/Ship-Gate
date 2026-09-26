// Unit tests for templates/caller/posthog/src/lib/server/posthog-proxy.ts.
// Node 22 strips the types; fetch is stubbed, so nothing leaves the machine.
//   node --test test/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { posthogProxy } from '../templates/caller/posthog/src/lib/server/posthog-proxy.ts';

let seen;
globalThis.fetch = async (url, init) => {
  seen = { url, init, body: init.body ? await new Response(init.body).text() : undefined };
  return new Response('ok', { status: 200, headers: { 'content-type': 'text/javascript', 'set-cookie': 'ph=1', 'x-kept': 'y' } });
};
const req = (path, init = {}) => new Request(`https://example.com${path}`, init);

test('ignores paths outside the prefix', () => {
  assert.equal(posthogProxy(req('/')), null);
  assert.equal(posthogProxy(req('/phone/')), null);
  assert.equal(posthogProxy(req('/api/ingest/e/')), null);
});

test('static and array go to the assets host', async () => {
  await posthogProxy(req('/ph/static/recorder.js?v=1'));
  assert.equal(seen.url, 'https://eu-assets.i.posthog.com/static/recorder.js?v=1');
  await posthogProxy(req('/ph/array/phc_x/config.js'));
  assert.equal(seen.url, 'https://eu-assets.i.posthog.com/array/phc_x/config.js');
});

test('everything else goes to the API host, POST body and query intact', async () => {
  await posthogProxy(req('/ph/e/?ip=0&ver=1', { method: 'POST', body: '{"a":1}' }));
  assert.equal(seen.url, 'https://eu.i.posthog.com/e/?ip=0&ver=1');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.body, '{"a":1}');
  assert.equal(seen.init.redirect, 'manual');
});

test('a custom prefix works', async () => {
  await posthogProxy(req('/api/ingest/decide/'), '/api/ingest');
  assert.equal(seen.url, 'https://eu.i.posthog.com/decide/');
});

test('strips site cookies, forwards the visitor IP, sets the host', async () => {
  await posthogProxy(req('/ph/e/', { method: 'POST', body: 'x', headers: { cookie: 'session=secret', 'cf-connecting-ip': '203.0.113.7' } }));
  const h = seen.init.headers;
  assert.equal(h.get('cookie'), null);
  assert.equal(h.get('x-forwarded-for'), '203.0.113.7');
  assert.equal(h.get('host'), 'eu.i.posthog.com');
});

test('drops Set-Cookie from PostHog, keeps the rest', async () => {
  const res = await posthogProxy(req('/ph/static/array.js'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('x-kept'), 'y');
  assert.equal(res.headers.get('content-type'), 'text/javascript');
  assert.equal(await res.text(), 'ok');
});
