import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import autocannon from "autocannon";

interface ScenarioResult {
  targetRps: number;
  achievedRps: number;
  p50: number;
  p95: number;
  p99: number;
  blockedRate: number;
}

function runScenario(url: string, targetRps: number, durationSeconds = 15): Promise<ScenarioResult> {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url,
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        tenantId: "acme",
        key: "load-user",
        resource: "POST:/payments",
        cost: 1
      }),
      connections: 200,
      duration: durationSeconds,
      overallRate: targetRps,
      pipelining: 1
    });

    instance.on("done", (result) => {
      const totalResponses =
        (result["1xx"] ?? 0) +
        (result["2xx"] ?? 0) +
        (result["3xx"] ?? 0) +
        (result["4xx"] ?? 0) +
        (result["5xx"] ?? 0);

      const blocked = result["4xx"] ?? 0;
      const blockedRate = totalResponses > 0 ? (blocked / totalResponses) * 100 : 0;

      resolve({
        targetRps,
        achievedRps: Number(result.requests.average.toFixed(2)),
        p50: Number(result.latency.p50.toFixed(2)),
        p95: Number(result.latency.p95.toFixed(2)),
        p99: Number(result.latency.p99.toFixed(2)),
        blockedRate: Number(blockedRate.toFixed(2))
      });
    });

    instance.on("error", (error) => {
      reject(error);
    });
  });
}

async function main(): Promise<void> {
  const endpoint = process.env.LOAD_URL ?? "http://localhost:3001/v1/ratelimit/check";
  const scenarios = [1000, 5000, 10000];
  const results: ScenarioResult[] = [];

  for (const rps of scenarios) {
    const result = await runScenario(endpoint, rps);
    results.push(result);
    console.log(
      `[load] target=${result.targetRps} rps | achieved=${result.achievedRps} rps | p95=${result.p95}ms | blocked=${result.blockedRate}%`
    );
  }

  await mkdir("reports", { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join("reports", `load-report-${timestamp}.json`);

  await writeFile(
    reportPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        endpoint,
        scenarios: results
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`\nReport written to ${reportPath}`);
  console.log("\nSummary");
  console.log("targetRps\tachievedRps\tp50\tp95\tp99\tblockedRate");
  for (const item of results) {
    console.log(
      `${item.targetRps}\t${item.achievedRps}\t${item.p50}\t${item.p95}\t${item.p99}\t${item.blockedRate}%`
    );
  }
}

main().catch((error) => {
  console.error("Load test failed", error);
  process.exit(1);
});
