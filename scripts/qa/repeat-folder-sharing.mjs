import { spawnSync } from "node:child_process";

// Runs only synthetic mocks; never opens the personal browser/profile.
const attempts = Number(process.argv[2] ?? 30);
if (!Number.isInteger(attempts) || attempts < 1 || attempts > 100) {
  throw new Error("Use an integer repetition count from 1 to 100.");
}
let failed = 0;
let firstFailure;
for (let attempt = 1; attempt <= attempts; attempt++) {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "--test", "--test-name-pattern=shared course probe",
    "packages/provider-browser/src/folder-listing.test.ts",
  ], { encoding: "utf8", timeout: 15_000, windowsHide: true });
  if (result.status !== 0) {
    failed++;
    firstFailure ??= { attempt, status: result.status, output: result.stdout + result.stderr };
  }
}
console.log(JSON.stringify({ attempts, passed: attempts - failed, failed, firstFailure }, null, 2));
process.exitCode = failed > 0 ? 1 : 0;
