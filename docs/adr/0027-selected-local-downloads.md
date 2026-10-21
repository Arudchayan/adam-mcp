# ADR 0027 — Selected local downloads through the CLI

Date: 2026-10-21. Status: implemented for the 0.3.0 candidate; release gates pending.

## Context

Students can discover files and request approved text extraction, but cannot save
a selected original file through this CLI. Extraction buffers at most 8 MiB and
returns text; saving a file is a different workflow with a local filesystem side
effect. No MCP write tool is allowed by the current product contract.

## Decision

- Add `adam-mcp download FILE_ID --output-dir DIRECTORY --confirm` as a local CLI
  command, not an MCP tool or resource. Accept a numeric selected ID or a canonical
  ADAM file URL/handle. Do not accept generic URLs or object-type overrides. A
  canonical handle must have type `file`; numeric IDs are resolved through the
  existing file metadata path. Refuse omitted confirmation before opening a session.
- Use the dedicated browser session and existing file resolution, logout checks,
  queue serialization and redirect policy. The command never opens a sign-in
  window automatically; recovery remains explicit login. Native transfers check
  the HTTPS ADAM origin before obtaining cookies for each redirect hop.
- Stream directly into a uniquely created mode-0600 temporary file in an explicit,
  existing destination directory. Require a real destination outside Git checkouts
  (including worktrees). Reject HTML/login-shaped and empty responses. Download
  limits are 256 MiB and 120 seconds, independently of unchanged extraction limits.
  Include backpressure, cancellation, streamed size checks and SHA-256 computation.
- Treat response filenames as untrusted. Strip path components, control/bidi
  characters and Windows-invalid characters; handle reserved names, trailing
  dots/spaces, and UTF-8 filename length. Use file metadata as the fallback name.
- Close and sync the temporary file before exposing it. Atomically create the
  destination with an exclusive hard link; an existing file, directory or symlink
  is never replaced. Add a numeric suffix for collisions, up to 1,000 candidates.
  Remove the temporary name in cleanup. Filesystems without hard links fail
  safely; no non-atomic fallback is introduced.
- CLI stdout returns only the completion metadata: local path, selected ref ID,
  canonical ADAM URL, actual byte count and digest. CLI progress/errors use stderr.
  MCP stdout remains JSON-RPC only and never receives file bytes or a download tool.

## Consequences and limits

This command writes a student-selected local file; it does not write to ADAM.
The `--confirm` argument authorizes saving that selected object locally and is
distinct from model-sharing/body-read approval. It does not approve extraction.
Downloaded content is never executed, automatically opened, indexed or extracted.
No batches, recursive downloads, resume, overwrite switch or background sync ship.

The filesystem must support hard links. Successful linking is the completion
point: cancellation racing after that point does not roll back a saved file.
Normal cancellation/failure removes temporary files; process termination, machine
failure or cleanup permission loss can leave an `.adam-download-*.part` file.
The destination is resolved once; concurrent hostile local directory replacement
is outside this protection boundary. HTML-shaped originals are intentionally
refused because the command cannot reliably distinguish them from sign-in pages.

Independent review of the transfer/filesystem boundary, exact-commit CI and a
student-selected live download remain release gates, not claims established by
synthetic tests. No other ADAM object type or provider is unlocked.

## Verification

Synthetic checks cover file resolution, explicit logout, confirmation refusal,
origin/redirect pinning, larger-than-extraction files, byte caps, timeout,
truncated bodies, cancellation, split HTML signatures, filename sanitization,
collision preservation, digest correctness and cleanup. Distribution verification
checks help and refusal paths without launching Chrome or touching live ADAM.
