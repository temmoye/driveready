const requestCounts = new Map<string, number>();
const requestDurations = new Map<string, { count: number; total_ms: number }>();
const providerCounts = new Map<string, number>();
const jobCounts = new Map<string, number>();

function increment(counter: Map<string, number>, key: string, by = 1) {
  counter.set(key, (counter.get(key) ?? 0) + by);
}

export function recordRequestMetric(input: {
  durationMs: number;
  method: string;
  route: string;
  statusCode: number;
}) {
  const key = `${input.method} ${input.route} ${input.statusCode}`;
  increment(requestCounts, key);
  const existing = requestDurations.get(key) ?? {
    count: 0,
    total_ms: 0,
  };
  requestDurations.set(key, {
    count: existing.count + 1,
    total_ms: existing.total_ms + input.durationMs,
  });
}

export function recordProviderMetric(name: string, outcome: 'success' | 'failure') {
  increment(providerCounts, `${name}:${outcome}`);
}

export function recordJobMetric(name: string, by = 1) {
  increment(jobCounts, name, by);
}

export function metricsSnapshot() {
  return {
    requests: Object.fromEntries(requestCounts),
    request_timings: Object.fromEntries(
      [...requestDurations.entries()].map(([key, value]) => [
        key,
        {
          count: value.count,
          average_ms: value.count > 0 ? Number((value.total_ms / value.count).toFixed(2)) : 0,
        },
      ]),
    ),
    providers: Object.fromEntries(providerCounts),
    jobs: Object.fromEntries(jobCounts),
  };
}
