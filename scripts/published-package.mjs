import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** A successful publish can precede public registry propagation. Never publish twice. */
export async function verifyPublishedPackage(url, expected, {
  request = fetch, wait = delay, clock = Date.now,
  maxWaitMs = 300_000, retryDelayMs = 10_000, maxAttempts = 31,
} = {}) {
  const deadline = clock() + maxWaitMs;
  let last = "not available";
  for (let attempt = 1; attempt <= maxAttempts && clock() < deadline; attempt++) {
    let response;
    try {
      response = await request(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - clock()))),
        headers: { "cache-control": "no-cache" },
      });
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
      last = "network lookup failed";
    }
    if (response?.ok) {
      const published = await response.json();
      // A visible but different artifact is an integrity failure, never propagation.
      assert.equal(published.dist?.integrity, expected.integrity, "Published artifact integrity differs from the reviewed tarball.");
      assert.equal(published.mcpName, expected.mcpName, "Published MCP identity differs from the reviewed package.");
      return published;
    }
    if (response) {
      const status = response.status;
      await response.body?.cancel();
      last = `HTTP ${status}`;
      if (status !== 404 && status !== 429 && status < 500) {
        throw new Error(`Published version lookup returned ${status}.`);
      }
    }
    if (attempt < maxAttempts && clock() < deadline) {
      await wait(Math.min(retryDelayMs, deadline - clock()));
    }
  }
  throw new Error(`Published version did not become verifiable within the lookup budget (${last}). Check registry processing; do not republish the same version.`);
}
