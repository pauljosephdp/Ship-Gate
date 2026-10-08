// Ship Gate CI health: control bands over a workflow's recent runs (the AI-native SDLC
// "closing the loop" play). Detection is deterministic; no model is involved here.
//
//   node ci-health.mjs <runs.json> --timeout <minutes>   (runs.json: the GitHub API's workflow_runs)
//
// Duration bands: mean and standard deviation of the baseline (every usable run but the latest
// three), then Western Electric rules on the latest three:
//   rule 1  one run beyond 3σ               → tier 3
//   rule 2  two of three beyond 2σ          → tier 2
//   1σ      the latest run beyond 1σ        → tier 1
// A run within 20% of the job timeout is tier 3 whatever the bands say: the next one may time out.
// Failure rate: the latest ten runs against the baseline's rate, beyond 3 binomial σ and at
// least 30% → tier 2.
// Tiers: 0 healthy, 1 log, 2 diagnose (Claude reads, read-only), 3 propose (an issue in intent.md form).
import { readFileSync, appendFileSync } from 'node:fs';

const MIN_BASELINE = 8;
const SIGMA_FLOOR_MIN = 0.5; // minutes: identical runs must not make every wobble a breach

const minutes = (r) => (Date.parse(r.updated_at) - Date.parse(r.run_started_at ?? r.created_at)) / 60000;

// Completed runs worth measuring, oldest first. Short runs are docs-only passes or superseded
// cancellations; a timed_out run, or a cancelled one near the timeout, counts as a failure.
export function usableRuns(runs, timeoutMinutes) {
  return runs
    .filter((r) => r.status === 'completed')
    .map((r) => ({ id: r.id, url: r.html_url, at: r.run_started_at ?? r.created_at, min: minutes(r), conclusion: r.conclusion }))
    .filter((r) => r.min >= 1)
    .filter((r) => r.conclusion === 'success' || r.conclusion === 'failure' || r.conclusion === 'timed_out'
      || (r.conclusion === 'cancelled' && r.min >= 0.9 * timeoutMinutes))
    .map((r) => ({ ...r, failed: r.conclusion !== 'success' }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

export function evaluate(runs, { timeoutMinutes }) {
  const used = usableRuns(runs, timeoutMinutes);
  const reasons = [];
  let tier = 0;
  const raise = (t, why) => { tier = Math.max(tier, t); reasons.push(`tier ${t}: ${why}`); };
  const latest = used.slice(-3);
  const baseline = used.slice(0, -3);

  for (const r of latest)
    if (r.min >= 0.8 * timeoutMinutes)
      raise(3, `run ${r.id} took ${r.min.toFixed(1)} min, within 20% of the ${timeoutMinutes}-minute timeout`);

  let stats = { runs: used.length, baseline: baseline.length };
  if (baseline.length >= MIN_BASELINE && latest.length === 3) {
    const durations = baseline.map((r) => r.min);
    const m = mean(durations), s = Math.max(sd(durations), SIGMA_FLOOR_MIN);
    stats = { ...stats, meanMin: +m.toFixed(2), sigmaMin: +s.toFixed(2), latestMin: latest.map((r) => +r.min.toFixed(1)) };
    const beyond = (k) => latest.filter((r) => r.min > m + k * s);
    if (beyond(3).length >= 1) raise(3, `rule 1: ${beyond(3).length} of the latest 3 runs beyond 3σ (${(m + 3 * s).toFixed(1)} min)`);
    if (beyond(2).length >= 2) raise(2, `rule 2: ${beyond(2).length} of the latest 3 runs beyond 2σ (${(m + 2 * s).toFixed(1)} min)`);
    if (latest.at(-1).min > m + s) raise(1, `the latest run (${latest.at(-1).min.toFixed(1)} min) is beyond 1σ (${(m + s).toFixed(1)} min)`);

    const recent = used.slice(-10), base = used.slice(0, -10);
    if (base.length >= MIN_BASELINE) {
      const p = base.filter((r) => r.failed).length / base.length;
      const q = recent.filter((r) => r.failed).length / recent.length;
      const limit = p + 3 * Math.sqrt(Math.max(p * (1 - p), 0.01) / recent.length);
      stats = { ...stats, failureRateBaseline: +p.toFixed(2), failureRateRecent: +q.toFixed(2) };
      if (q > limit && q >= 0.3) raise(2, `failure rate ${Math.round(q * 100)}% over the latest ${recent.length} runs, against ${Math.round(p * 100)}% before`);
    }
  } else {
    reasons.push(`not enough history for bands (${baseline.length} baseline runs, need ${MIN_BASELINE})`);
  }
  return { tier, reasons, stats, latest: latest.map((r) => ({ id: r.id, url: r.url, min: +r.min.toFixed(1), conclusion: r.conclusion })) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, ...rest] = process.argv.slice(2);
  const ti = rest.indexOf('--timeout');
  const timeoutMinutes = Number(ti >= 0 ? rest[ti + 1] : 30);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const result = evaluate(data.workflow_runs ?? data, { timeoutMinutes });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tier=${result.tier}\n`);
}
