// Unit tests for scripts/ci-health.mjs: the control bands must stay quiet on a steady workflow
// and fire on drift, spikes, near-timeouts and a run of failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, usableRuns } from '../scripts/ci-health.mjs';

const T0 = Date.parse('2026-09-01T00:00:00Z');
const run = (i, min, conclusion = 'success') => ({
  id: i, html_url: `https://example.test/${i}`, status: 'completed', conclusion,
  run_started_at: new Date(T0 + i * 3600e3).toISOString(),
  updated_at: new Date(T0 + i * 3600e3 + min * 60e3).toISOString(),
});
const steady = (n, base = 10) => Array.from({ length: n }, (_, i) => run(i, base + (i % 3) * 0.5));

test('steady durations: healthy', () => {
  assert.equal(evaluate(steady(20), { timeoutMinutes: 30 }).tier, 0);
});

test('one spike beyond 3σ: tier 3 (rule 1)', () => {
  const r = evaluate([...steady(17), run(17, 10), run(18, 10.5), run(19, 19)], { timeoutMinutes: 30 });
  assert.equal(r.tier, 3);
  assert.match(r.reasons.join(' '), /rule 1/);
});

test('slow drift, two of three beyond 2σ: tier 2 (rule 2)', () => {
  const r = evaluate([...steady(17), run(17, 11.6), run(18, 10), run(19, 11.6)], { timeoutMinutes: 30 });
  assert.equal(r.tier, 2);
  assert.match(r.reasons.join(' '), /rule 2/);
});

test('a run within 20% of the timeout: tier 3 even without history', () => {
  const r = evaluate([run(0, 25), run(1, 26), run(2, 27)], { timeoutMinutes: 30 });
  assert.equal(r.tier, 3);
  assert.match(r.reasons.join(' '), /within 20%/);
});

test('timed-out cancellations count; superseded short cancellations do not', () => {
  const used = usableRuns([run(0, 30.3, 'cancelled'), run(1, 0.5, 'cancelled'), run(2, 10, 'skipped')], 30);
  assert.deepEqual(used.map((r) => r.id), [0]);
  assert.equal(used[0].failed, true);
});

test('a run of failures: tier 2', () => {
  const runs = [...steady(20), ...Array.from({ length: 10 }, (_, i) => run(20 + i, 10, i % 2 ? 'failure' : 'success'))];
  const r = evaluate(runs, { timeoutMinutes: 30 });
  assert.equal(r.tier, 2);
  assert.match(r.reasons.join(' '), /failure rate/);
});

test('short history: no bands, says so', () => {
  const r = evaluate(steady(5), { timeoutMinutes: 30 });
  assert.equal(r.tier, 0);
  assert.match(r.reasons.join(' '), /not enough history/);
});
