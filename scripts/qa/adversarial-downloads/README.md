# Isolated adversarial download/extraction QA

Base: `ef9776e`. Branch: `qa/adversarial-downloads`. Environment: Windows, Node
`v24.19.0`. No production changes, dependencies, live ADAM, network fetches, real
course files, credentials, issue filings, or pushes. All `fetch` implementations
are synthetic. Temporary trees are uniquely created below the approved
`%TEMP%/opencode/adam-qa-downloads-*` parent; cleanup is restricted to that exact tree.
The helper expects the approved `opencode` temporary parent to exist.

## Commands and observed outputs

Run from this worktree root:

```sh
npm ci --ignore-scripts
node --import tsx --test packages/provider-browser/src/local-download.test.ts packages/provider-browser/src/bounded-fetch.test.ts packages/core/src/local-extract.test.ts
node --import tsx --test scripts/qa/adversarial-downloads/held.test.ts
node --import tsx --test scripts/qa/adversarial-downloads/boundary-repros.ts
node --import tsx scripts/qa/adversarial-downloads/filename-probe.ts
node --import tsx scripts/qa/adversarial-downloads/toctou-probe.ts
```

Observed respectively: install 22 packages, 0 audit findings; **43/43 passing**;
**16/16 passing**; **0/5 passing (intentional bug assertions, exit 1)**; six filename
observations, exit 0; two TOCTOU observations, exit 0. An initial baseline invocation
before installation failed solely because this fresh worktree lacked `tsx`.

`boundary-repros.ts` deliberately does **not** match `*.test.ts`; do not add it to
ordinary passing test discovery. It proves actual behavior first, prints a compact
observation, then asserts the desired refusal/deadline contract. Timing probes use
deferred callbacks, release them before assertions, and retain no hung work.

## Confirmed issue candidates

### D1 — unsolicited HTTP 206 saved as complete original (medium integrity)

Minimal response: status `206`, body `abc`, `Content-Length: 3`,
`Content-Range: bytes 0-2/100`, octet-stream MIME. No Range header is requested.

Expected: refuse unsolicited partial content without publishing a final file.
Actual: `saveLocalDownload` publishes `synthetic.bin`, returns successful completion
with `sizeBytes: 3` and the hash of that partial body. Its internally correct hash
does not establish completeness. The synthetic original is explicitly 100 bytes.

Source confirmation: `packages/provider-browser/src/bounded-fetch.ts:47` accepts
all `response.ok` statuses. Lines 48–54 omit Content-Range; lines 80–84 only compare
the body against the *partial response's* Content-Length. Publication is in
`packages/provider-browser/src/local-download.ts:108–109`.

Prerequisite/limit: an upstream/proxy must return unsolicited partial content;
not demonstrated against ADAM. This is local integrity/false-success, not arbitrary
file write or code execution. Suitable for a normal evidence-based bug report;
no private data or demonstrated confidentiality impact.

Repro observation:
`{"reproduction":"unsolicited 206","actual":"successful completion","sizeBytes":3,"completeOriginalBytes":100}`

### D2 — HTML sniff bypasses (low integrity / policy mismatch)

Two independent encodings of synthetic HTML under octet-stream MIME, streamed
**one byte at a time**:

- UTF-16LE BOM followed by `<!doctype html><html><body>Sign in</body></html>`:
  successful 98-byte save.
- 1,024 ASCII spaces before that HTML document: successful 1,072-byte save.

Expected: the documented refusal of HTML-shaped originals, including login pages,
with no saved file. Actual: successful binary completion and byte-identical HTML
files. The UTF-8 BOM equivalent is correctly refused in the passing tests.

Source confirmation: `packages/core/src/local-extract.ts:22–32` decodes only UTF-8
and checks only the initial 1,024 bytes. `local-download.ts:80–83` stops sniffing
once that prefix is full. `docs/downloads.md:75–76` advertises refusal of HTML-shaped
files. The fixed-prefix limit is intentional bounding, so the whitespace case may
be triaged as documentation/heuristic hardening rather than a security defect.

Prerequisite/limit: HTML must have missing/misleading MIME; a genuine HTML MIME is
rejected independently. UTF-16 support and a bounded prefix are the precise gaps;
not an execution vulnerability (downloads are never opened). Ordinary low-severity
bug report or combined hardening issue; no coordinated disclosure indicated.

### D3 — deadlines/cancellation depend on callback cooperation (low availability)

- With `timeoutMs: 10`, hold `host.headers()` on a deferred promise. At 60 ms the
  operation is still unsettled. Release it and it then reports timeout.
- Hold `onChunk()` on a deferred promise, abort the caller signal, yield one event
  loop turn. The operation remains unsettled until that callback is released.

Expected strict deadline/prompt cancellation: settle without waiting for these
callbacks. Actual in both: `settledBeforeRelease: false`.

Source confirmation: `bounded-fetch.ts:29` only aborts the controller; line 38
awaits headers without a deadline race, and line 70 awaits the sink. The caller
signal is not passed to `host.headers`. Production header callbacks await
`page.context().cookies(requestUrl)` in `playwright-session.ts:495–496`.
Production download sink awaits filesystem writes in `local-download.ts:88`.

**Triage caveat:** these are confirmed synthetic *cooperation limitations*, not
confirmed hostile-server exploits. Ordinary native fetch streams do honor abort,
and existing tests confirm stalled native-like stream timeout. A blocked Chrome
cookie RPC or blocked filesystem write is needed in production. Waiting for an
in-progress filesystem write before cleanup may be safer than returning early.
Do not file as a high-severity remote DoS or credential leak. Main should decide
whether stronger callback deadline guarantees are actually a product requirement.

## Attacks that held

The 16 added passing tests demonstrate:

- Identical binary content, actual saved-byte SHA-256 and length across 1, 2, 7,
  1,023 and 4,096-byte chunking; no file bytes in completion results (baseline).
- Split UTF-8 BOM HTML detection; case-insensitive HTML/XHTML MIME refusal.
- Zero/exact/over byte boundaries; excess chunks never reach the sink; source
  cancellation; mismatched declared lengths never leave final/temporary files.
- Off-origin host suffix, protocol-relative, HTTP downgrade, alternate port,
  userinfo-host confusion, and data redirects do not trigger a second credential
  lookup/request. Same-origin redirect loops stop after six requests and cancel
  every response body. No credential leak observed.
- Sink exceptions cancel the source and no additional sink write runs.
- Filename traversal, ADS separators, standard Windows devices, bidi/control
  characters, Unicode length and extension limits remain bounded/sanitized.
- Junction aliases into a Git worktree are resolved and refused; existing
  junction/directory collision targets are preserved and a distinct name selected.
- Removing the randomized temporary name before hard-link publication produces
  an error and no final file. This is synthetic ENOENT failure injection, **not**
  a claim that unsupported-hardlink filesystems or disk-full failures were tested.
- Missing, malformed, duplicated approval/options never construct the CLI provider.
- Production PDF admission refuses a ninth waiter and >32 MiB waiting input;
  cancellation removes queued work before worker spawn. Generic queue tests prove
  byte accounting recovery, count bounds, serialized failure recovery, and wait
  timeout removal. Existing baseline tests actually parse compressed PDF pages,
  enforce 20-page/40,000-character caps, and cancel active/queued workers.

No full-suite concurrency, unbounded fuzzing, parser resource exhaustion, or
filesystem permission/ACL mutation was used. Maximum new synthetic input allocation
is an 8 MiB shared PDF buffer; byte-cap tests use a 16-byte configurable stream cap.
The existing targeted baseline exercises its original 256 MiB overflow case.

## Exploratory non-findings / realistic local races

`filename-probe.ts` publishes synthetic bytes under `CONIN$`, `CONOUT$`, `CON .txt`,
`LPT1 .pdf`, `AUX .bin`, and `COM1 .bin`. All six are literal directory entries on
this Windows host; no console devices are opened/read. These spellings are not
rewritten by the sanitizer, but **no device escape or corruption was demonstrated**.
Do not elevate name-pattern suspicion into a vulnerability without reader evidence.

`toctou-probe.ts` creates a synthetic `.git` marker during the fetch callback,
after the destination check. The download succeeds, although revalidating that
directory immediately afterwards refuses it. This requires a local writer able
to initialize/modify the selected destination. It is a local time-of-check policy
race, not a remote path traversal; ordinary user activity can also cause it.

Attempted destination-directory rename/junction substitution while its temporary
file handle was open failed on this Windows host with `EPERM`; the transfer failed,
the original temp file was removed, and no replacement entries were written.
The script separately handles the POSIX-style rename case, but that branch is
**not validated here**. No claim of symlink/TOCTOU filesystem escape is supported.
