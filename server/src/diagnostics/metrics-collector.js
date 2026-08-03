// In-memory rolling metrics collector.
//
// Tracks the most recent samples for each named operation (bounded ring
// buffer per operation — never an unbounded array) and computes count,
// success/failure counts and duration percentiles (p50/p95/p99) on
// demand. No payloads are ever stored, only durations and a boolean.

const DEFAULT_MAX_SAMPLES = 200;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function createMetricsCollector({ maxSamples = DEFAULT_MAX_SAMPLES } = {}) {
  // operation -> { samples: Float64Array-like ring, count, successCount, failureCount, idx }
  const series = new Map();
  // Bounded per operation: at least 1 sample, at most 1000. The default
  // (200) sits comfortably inside the spec's 100-1000 recommendation.
  const max = Math.max(1, Math.min(1000, maxSamples));

  function getSeries(operation) {
    let s = series.get(operation);
    if (!s) {
      s = {
        samples: new Array(max),
        count: 0,
        successCount: 0,
        failureCount: 0,
        idx: 0,
      };
      series.set(operation, s);
    }
    return s;
  }

  function record(operation, durationMs, success = true) {
    const s = getSeries(String(operation));
    s.samples[s.idx] = Number(durationMs) || 0;
    s.idx = (s.idx + 1) % max;
    if (s.count < max) s.count += 1;
    if (success) s.successCount += 1;
    else s.failureCount += 1;
  }

  function summary(operation) {
    const s = series.get(String(operation));
    if (!s || s.count === 0) {
      return {
        operation: String(operation),
        count: 0,
        successCount: 0,
        failureCount: 0,
        averageMs: null,
        minMs: null,
        maxMs: null,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
      };
    }
    const vals = s.samples.slice(0, s.count).sort((a, b) => a - b);
    const total = vals.reduce((acc, v) => acc + v, 0);
    return {
      operation: String(operation),
      count: s.count,
      successCount: s.successCount,
      failureCount: s.failureCount,
      averageMs: Math.round((total / vals.length) * 100) / 100,
      minMs: Math.round(vals[0] * 100) / 100,
      maxMs: Math.round(vals[vals.length - 1] * 100) / 100,
      p50Ms: Math.round(percentile(vals, 50) * 100) / 100,
      p95Ms: Math.round(percentile(vals, 95) * 100) / 100,
      p99Ms: Math.round(percentile(vals, 99) * 100) / 100,
    };
  }

  // Summaries for every known operation (bounded by the number of ops).
  function all() {
    return [...series.keys()].map(summary);
  }

  function reset() {
    series.clear();
  }

  return { record, summary, all, reset };
}
