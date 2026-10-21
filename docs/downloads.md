# Selected local downloads — 0.3.0 candidate

This feature is in the source candidate, not published 0.2.0. It saves an original
file on your computer. It never sends file bytes to an MCP client or model.

1. Build source with `npm run build`, then sign in with `npm run login`.
2. Use `adam_list_files` to choose a file and obtain its ID/canonical ADAM link.
3. Create a destination directory outside all Git checkouts.
4. Run `node packages/mcp/dist/adam-mcp.mjs download FILE_ID --output-dir DIRECTORY --confirm`.

Quote destination paths containing spaces. Replace `FILE_ID` and `DIRECTORY` with
your selection. Canonical `https://adam.unibas.ch/go/file/ID` URLs and
`adam://file/ID` handles also work. After publication/install, `adam-mcp download`
will expose the same command. The command validates arguments and confirmation
before creating a browser session. `--confirm` authorizes only that local save;
it does not approve sending text to a model.

CLI stdout is a single JSON completion object containing `path`, `url`, `refId`,
`sizeBytes` and `sha256`. Progress and errors go to stderr. This command runs
separately from the MCP stdio server; no new MCP tool is registered.

## Limits and filenames

Downloads use the dedicated authenticated Chrome session, stream at most 256 MiB,
and have a 120-second transfer deadline. Queue/session verification time is
separate. They never execute or open downloaded files. Text extraction remains
separate, approved and limited to 8 MiB. There is no batch, recursive, overwrite
or resume mode. Empty and HTML-shaped files are refused, including legitimate
HTML originals, to avoid saving a sign-in page as a successful download.

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
