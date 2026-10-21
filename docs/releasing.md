# Releasing ADAM MCP

The publishable package is `packages/mcp` (`adam-mcp`). The repository root is a private workspace coordinator and must remain private. npm distributes the CLI and its runtime dependencies; the MCP Registry publishes discovery metadata pointing to that npm version. A Registry entry is not a hosted service or a security endorsement.

## Release evidence

Every item in [SECURITY.md](../SECURITY.md#publish-checklist) must be satisfied before a tag or publication. Record the exact commit, version, date, reviewer, command results, CI links, and client versions in a dated release record. Previous test runs do not certify a new commit.

1. Refresh a clean checkout using `git pull --ff-only`. Resolve local changes deliberately. Install the committed dependency tree with `npm ci` on a supported Node.js LTS release. This candidate requires Node.js 22 or later; CI covers Node 22 and 24 on Windows, macOS, and Linux.
2. Check npm ownership and version availability with `npm view adam-mcp name version maintainers repository --json --registry=https://registry.npmjs.org` and authenticated account access. A missing package does not prove that its name can be registered. If the name is unavailable, choose a maintainer-owned scope and update both the package and Registry identifiers before publication.
3. Select the version deliberately. Keep the root package, CLI package, lockfile, server-reported version, package README, changelog, and both version fields in `server.json` consistent. Do not overwrite an existing npm version. This candidate retains `0.2.0`; publication availability has not been established.
4. Require the full CI matrix on the release commit and run `npm run release:check`. This runs the synthetic/scrubbed test suite, strict typechecking, build, stdio smoke checks, locked production dependency audit, and a fresh tarball installation with a separate consumer dependency audit. Audits need registry access; a network failure is an incomplete check, not a clean result. Inspect development dependencies separately with `npm audit` and review any findings.
5. Review package contents and licensing. Run `npm pack -w adam-mcp --dry-run --json` after building. Only distribution modules, the package manifest, README, LICENSE, NOTICE and generated SOURCE.md belong in the tarball. SOURCE.md identifies the exact source commit, immutable public archive and rebuild directions; verify the archive includes the source, lockfile and build scripts. Release evidence binds that archive to the release commit. Inspect bundled dependency notices and retain corresponding source for GPL distribution. No profiles, credentials, captures, fixtures, recordings, test files, or workspace-only dependency references may become production dependencies.
6. Record a walkthrough in an installed MCP client: version/OS, setup, Chrome sign-in, course listing, one student-selected approved read, refusal/cancellation, restart, expired-session recovery, and logout. Use [the compatibility checklist](client-compatibility.md). Fixture and wire tests cannot establish real-client behavior. Live body reads still require approval for that selected object.
7. Review public recordings and scrubbed captures for personal information and redistribution rights. Automated fixture scrubbing does not certify video frames or audio. Confirm the unofficial-project and model-sharing disclosures remain prominent.
8. Obtain the protocol/QA/security review required by [CONTRIBUTING.md](../CONTRIBUTING.md). Resolve failing checks and retain the reviewed release evidence before requesting final publication approval.

## Pack and publish

Run these commands only from the reviewed release checkout, after all gates pass. They are maintainer actions, not setup instructions for students.

```bash
npm run release:check
npm pack -w adam-mcp
```

For a local review bundle, run `npm run release:prepare`. It runs the release checks and writes the tarball, `SHA256SUMS`, and `release-evidence.json` to the ignored `.release/` directory. Evidence includes the source commit, dirty-tree status, runtime versions, package integrity, file list, and Registry metadata. A dirty-tree artifact is for local inspection only and cannot certify a release commit.

The manual **Release candidate** workflow (`.github/workflows/release-candidate.yml`) runs the complete checks on Node 22/24 across Windows, macOS, and Linux, then uploads a review bundle from the same source commit. It has read-only repository permissions and no publication credentials. Download the artifact and archive the run URL before the 30-day retention period expires. The workflow does not replace the installed-client, media, licensing, ownership, or independent-review gates.

Retain the resulting tarball's filename, SHA-256, npm integrity value, exact source commit, and packed file list with the release evidence. Publish the reviewed tarball rather than rebuilding different bytes after review. For the current candidate the filename is `adam-mcp-0.2.0.tgz`; change it when the approved version changes.

Prefer npm trusted publishing from a GitHub-hosted release workflow in this public repository. Configure the exact repository, workflow filename, and protected release environment in npm's trusted publisher settings. Use `contents: read` and grant `id-token: write` only to the publication job. Require environment approval, validate the approved commit, run release checks, and keep install/test jobs free of publish credentials. npm currently requires CLI 11.5.1+ and Node 22.14.0+ for trusted publishing; Node 24 LTS is suitable. Do not add a long-lived publish token to this repository.

In the configured trusted publishing job, publish the reviewed artifact:

```bash
npm publish ./adam-mcp-0.2.0.tgz --access public --registry=https://registry.npmjs.org
```

Trusted publishing from a public GitHub repository generates provenance automatically. Verify it on the published version. The repository ships a manual `publish-npm.yml` workflow; npm account trust and the repository enable switch must be configured separately. If initial package creation requires an interactive npm publish, use the maintainer's normal authenticated, 2FA-protected session after approval and record that provenance was not established by that path. Never put account credentials in shell arguments, source files, issues, or chat.

### Configure GitHub Actions publication

1. Create the `npm-release` GitHub environment with required maintainer review and deployment restricted to `main`. Do this before enabling the workflow. Environment naming alone does not enforce review.
2. After the first reviewed npm package exists, configure its trusted publisher: GitHub owner `Arudchayan`, repository `adam-mcp`, workflow filename `publish-npm.yml`, environment `npm-release`. Allow direct publication for this workflow. Newly created trust configurations must complete their first successful publish within the period specified by npm (currently two days); configure trust when the next release is ready.
3. Set repository variable `NPM_PUBLISH_ENABLED=true` only after trust, environment protection and all release gates are ready. Leave it unset while preparing. No npm token secret is needed.
4. Run **Publish npm** manually on `main`, enter the exact approved version and attest that the `SECURITY.md` checklist is complete. The workflow runs the six-platform release candidate checks, archives the tarball and evidence, waits for `npm-release` environment review, verifies source/version/checksum, publishes that tarball, and checks the published integrity and `mcpName`. A feature-branch run cannot publish.
5. Archive the run URL and provenance, then carry out the Registry and installed-version checks below. The workflow does not assert that manual gates are complete; the maintainer and environment reviewer must confirm the recorded evidence.

## Publish MCP Registry metadata

Only after npm publication succeeds, verify `package.json.mcpName` equals `server.json.name` and the Registry package identifier/version exactly match npm. The proposed GitHub namespace is `io.github.Arudchayan/adam-mcp`; the publisher must be authorized for that namespace.

Install the official `mcp-publisher` using the current official instructions and review its release/checksum. From the repository root:

```bash
mcp-publisher login github
mcp-publisher publish
```

The publisher validates the submitted metadata and npm ownership. Local identifier/version checks are not full remote schema or ownership validation. The Registry is currently in preview; recheck its schema and publishing instructions at release time. No credentials, cookie variables, OAuth setup, or remote MCP URL belong in this server's Registry entry.

## Verify the published result

1. Read npm metadata for the exact version and confirm ownership, repository, `mcpName`, integrity, and provenance. Match the downloaded artifact to the reviewed tarball.
2. Install that version into a new directory outside this checkout using only production dependencies. Verify help, setup preview, passive diagnostics, and stdio initialization before trying a real client. Run the approved client walkthrough with the installed version.
3. Look up the exact name/version in the official MCP Registry and verify its npm reference. Update pending-release wording only after these checks succeed. Publish a GitHub release/tag for the verified commit only after the security checklist is green.
4. Monitor reports. If a release is defective, deprecate that npm version with a clear explanation, publish a corrected version, and update Registry metadata. Do not assume a published version can be replaced or immediately unpublished.

## Official references

Reviewed 20 October 2026. Recheck these sources before an actual release:

- [MCP Registry publishing quickstart](https://modelcontextprotocol.io/registry/quickstart)
- [MCP Registry package types and npm ownership](https://modelcontextprotocol.io/registry/package-types)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [npm trusted publishing and provenance](https://docs.npmjs.com/trusted-publishers/)
- [Node.js release support status](https://nodejs.org/en/about/previous-releases)
