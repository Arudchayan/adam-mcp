# Save a selected original file locally

Available in published `adam-mcp@0.3.0`; `0.2.0` does not have this command.
It saves an original file on your computer, including non-text files and files
larger than the text-extraction limit. It never sends file bytes to an MCP client
or model and does not modify anything on ADAM.

## Installed CLI

You need Node.js 22+ and Google Chrome. Install or upgrade explicitly:

```sh
npm install -g adam-mcp@0.3.0
adam-mcp --help
```

Check that help lists `download FILE_ID`. If it does not, your shell is still
resolving an older executable; check `Get-Command adam-mcp` (PowerShell) or
`command -v adam-mcp` (POSIX shell) and update that installation.

1. Sign in with `adam-mcp login`, then check `adam-mcp status`.
2. Use `adam_list_files` to choose a file and obtain its ID/canonical ADAM link.
3. Create a destination directory outside all Git checkouts.
4. Run `adam-mcp download FILE_ID --output-dir "DIRECTORY" --confirm` in your
   terminal, separately from your MCP client.

Quote destination paths containing spaces. Replace `FILE_ID` and `DIRECTORY` with
your selection. Canonical `https://adam.unibas.ch/go/file/ID` URLs and
`adam://file/ID` handles also work. Select one file per invocation, not a course,
folder, exercise, web link or arbitrary URL. The destination is an existing
directory, not a full output filename; the filename comes from ADAM and is
sanitized as described below. The command validates arguments and confirmation
before creating a browser session. `--confirm` authorizes only that local save;
it does not approve sending text to a model.

CLI stdout is a single JSON completion object containing `path`, `url`, `refId`,
`sizeBytes` and `sha256`. Progress and errors go to stderr. This command runs
separately from the MCP stdio server; no new MCP tool is registered.

## Verify the saved original

Keep the completion metadata if you need to reconcile the saved file later. The
returned `sizeBytes` and SHA-256 describe the actual saved bytes, not extracted
text or a digest supplied by ADAM. This verifies local integrity, not authorship.

For example, in PowerShell, replace `FILE_ID` with your selected file's ID:

```powershell
$destination = Join-Path $HOME "Downloads/ADAM"
New-Item -ItemType Directory -Force -Path $destination | Out-Null
$saved = adam-mcp download FILE_ID --output-dir "$destination" --confirm | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Download failed; check stderr." }
if ((Get-Item -LiteralPath $saved.path).Length -ne $saved.sizeBytes) { throw "Size mismatch" }
if ((Get-FileHash -LiteralPath $saved.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $saved.sha256) { throw "SHA-256 mismatch" }
```

On macOS/Linux, compare the returned size with `wc -c < "SAVED_PATH"` and the
digest with `shasum -a 256 "SAVED_PATH"` (macOS) or
`sha256sum "SAVED_PATH"` (Linux). Use the returned path: collisions can change
the filename. A nonzero exit or absent completion object is not a successful save.

## From a source checkout

After installing the checkout's dependencies with `npm ci`, run `npm run build`,
`npm run login` and `npm run status`. Substitute
`node packages/mcp/dist/adam-mcp.mjs download` for `adam-mcp download` in the steps
above. The destination must still be outside the checkout (including worktrees).

## Limits and filenames

Downloads use the dedicated authenticated Chrome session, stream at most 256 MiB,
and have a 120-second transfer deadline. Queue/session verification time is
separate. They never execute or open downloaded files. Text extraction remains
separate, approved and limited to 8 MiB. There is no batch, recursive, overwrite
or resume mode. Empty files and responses explicitly labelled HTML are refused.
A heuristic also rejects HTML signatures in the first 4096 bytes (UTF-8 or
BOM-marked UTF-16), including some legitimate originals. It is not a complete
HTML detector: longer padding, other encodings or unrecognized markup can pass.
Check suspicious files before opening them; downloads are never opened automatically.
Unsolicited partial responses are refused; size and hash alone do not prove that
the server supplied the complete original.

Response filenames are sanitized for Windows/macOS/Linux. Directory components,
unsafe/control characters and reserved names are handled. A missing response
filename falls back to file metadata. Duplicate names receive ` (1)`, ` (2)`, …;
existing files/directories/symlinks are preserved. The CLI writes a private random
`.adam-download-*.part` file beside the destination, syncs/closes it, then creates
the final name with an exclusive hard link. The filesystem must support hard
links; unsupported destinations fail rather than falling back to unsafe overwrites.

## Recovery

- Missing approval: select the file/destination, then add `--confirm`.
- Missing destination: create an existing local directory outside Git.
- Logged out/sign-in response: run `adam-mcp login`, verify status and retry.
- Queue full/timeout: allow the active request to finish, then retry once.
- File too large or transfer too slow: use the canonical ADAM URL in Chrome.
- Disk full/permission/hard-link error: choose a writable supported filesystem
  with enough space, then retry. Existing files are never replaced.
- Ctrl+C: ordinary cancellation removes the temporary file. Successful creation
  of the final filename is the completion point; cancellation after that does
  not remove a saved file.

Process termination, machine failure or changed filesystem permissions can leave
a `.part` file. Once no download is running, inspect and remove that exact partial
file manually. Never commit downloaded materials, temporary downloads, cookies or
profiles. Files are course content and remain subject to their original rights.
