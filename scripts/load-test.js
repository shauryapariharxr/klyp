/**
 * Load test for klyp.
 *
 * Run: node scripts/load-test.js [BASE_URL]
 * Defaults to http://localhost:3123
 *
 * Phases:
 *   1. Static page reads  — 20s at 50 concurrent connections
 *   2. PIN verify churn   — 15s at 20 connections (valid-format wrong PINs;
 *                           exercises scrypt + DB lookups + the rate limiter,
 *                           which will start answering 429 partway through)
 *   3. Create-transfer    — 10s at 5 connections (real DB writes; deliberately
 *                           below the 10/hour per-IP cap for the UI path, and
 *                           short enough to stay inside it overall)
 *
 * Dependency-free: uses Node's global fetch. Reports req/s, status-code
 * breakdown and latency percentiles per phase.
 */

const BASE = process.argv[2] ?? "http://localhost:3123";

function phase(name, durationMs, concurrency, worker) {
  return new Promise((resolve) => {
    const counts = { ok: 0, fail: 0, statuses: {} };
    const latencies = [];
    let stop = false;
    const start = Date.now();

    setTimeout(() => (stop = true), durationMs);

    async function runWorker() {
      while (!stop) {
        const t0 = performance.now();
        let status = 0;
        try {
          status = await worker();
        } catch {
          status = 0;
        }
        const dt = performance.now() - t0;
        latencies.push(dt);
        counts.statuses[status] = (counts.statuses[status] ?? 0) + 1;
        if (status >= 200 && status < 500) counts.ok += 1;
        else counts.fail += 1;
      }
    }

    const workers = Array.from({ length: concurrency }, runWorker);
    Promise.all(workers).then(() => {
      const elapsedS = (Date.now() - start) / 1000;
      latencies.sort((a, b) => a - b);
      const pct = (p) => (latencies.length ? latencies[Math.floor((p / 100) * (latencies.length - 1))] : 0);
      resolve({
        name,
        requests: latencies.length,
        rps: +(latencies.length / elapsedS).toFixed(1),
        statuses: counts.statuses,
        p50: +pct(50).toFixed(0),
        p95: +pct(95).toFixed(0),
        p99: +pct(99).toFixed(0),
      });
    });
  });
}

function report({ name, requests, rps, statuses, p50, p95, p99 }) {
  const statusLine = Object.entries(statuses)
    .map(([code, n]) => `${code}:${n}`)
    .join("  ");
  console.log(
    `\n[${name}]\n` +
      `  requests : ${requests}  (${rps} req/s)\n` +
      `  statuses : ${statusLine}\n` +
      `  latency  : p50 ${p50}ms   p95 ${p95}ms   p99 ${p99}ms`,
  );
}

async function main() {
  console.log(`Load-testing ${BASE}`);
  console.log("Warm-up...");
  for (const path of ["/", "/send", "/receive"]) {
    await fetch(`${BASE}${path}`).catch(() => {});
  }

  report(
    await phase(
      "Phase 1 — static pages (GET /, 50 connections)",
      20_000,
      50,
      async () => {
        const res = await fetch(`${BASE}/`);
        await res.arrayBuffer();
        return res.status;
      },
    ),
  );

  report(
    await phase(
      "Phase 2 — PIN verify churn (20 connections, wrong PINs)",
      15_000,
      20,
      async () => {
        const pin = String(Math.floor(1000 + Math.random() * 9000));
        const res = await fetch(`${BASE}/api/transfer/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin }),
        });
        await res.arrayBuffer();
        return res.status;
      },
    ),
  );

  report(
    await phase(
      "Phase 3 — create transfer (5 connections, DB writes)",
      10_000,
      5,
      async () => {
        const res = await fetch(`${BASE}/api/transfer/create`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `load-test ${Date.now()} — the quick brown fox jumps over the lazy dog`,
            hasFiles: false,
          }),
        });
        await res.arrayBuffer();
        return res.status;
      },
    ),
  );

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
