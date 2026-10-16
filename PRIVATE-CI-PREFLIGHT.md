# Private CI preflight: v0.1.0-rc.1

Checked 2026-10-16, before approval for remote changes or pushing.

## Verified GitHub state

- Both the GitHub connector and local Git credential manager authenticate as
  `jigar48`. Credentials were used in memory and were not written into the project.
- Repository: <https://github.com/jigar48/api-contract-diff>.
- Owner: `jigar48`, account type `User`; this is a personal repository.
- Authenticated permissions include admin and push.
- Visibility is **public**, not private. No visibility change has been made.
- Repository is empty, default branch is `main`, and no remote refs were returned.
- Actions and issues are enabled. Private vulnerability reporting is disabled.
- No local `origin`, commit, tag, release, or push has been created by this work.

## Staged review and local checks

Reviewed the intended initial source, tests/fixtures, lockfile, package metadata,
license, README, security/audit/release documents, scripts, and CI workflow.
Build output, dependencies, local settings, credentials, and the tarball are
excluded from the staged upload. The credential/path scan and whitespace check
pass. Scanner matches omit values, and scanning is heuristic rather than an
exhaustive proof that credentials cannot exist.

No comparison code changed in this preflight. Changes are restricted to real
repository metadata, its release assertions, disclosure documentation, and status
records. Refreshed Windows Node 24.19.0 checks:

- Build and full test suite: **40 passed, 0 failed, 0 skipped**.
- Clean production package installation: **passed**.
- Installed bin smoke checks: **5 passed**; exits 0, 1, and 2 as expected.
- Package allowlist: **12 files**, no unexpected installed project files.
- The six Node 22/24 × Ubuntu/Windows/macOS Actions jobs remain **not run**.

Earlier local Windows Node 22.23.3 checks passed the same 40 tests and five
packaged smoke cases; see `RELEASE-CANDIDATE.md`. Metadata/disclosure changes do
not establish remote CI success.

The regenerated local tarball is `api-contract-diff-0.1.0-rc.1.tgz`, 11,215 bytes,
with SHA-256:

```text
0cd3f0f94c752bd3615546e3a685a038b82aa59e37fcfc26acb13c5969b4d372
```

## Disclosure readiness

`SECURITY.md` now gives collaborators a private issue process **only after the
repository is verified private**. Reports in such an issue are visible to all
repository collaborators. It explicitly prohibits posting details in public
issues and retains the no-invented-email policy.

For a later public repository, the documented private-reporting form requires
the owner to enable GitHub private vulnerability reporting first. That feature
is for public repositories; the policy does not claim it is active now. There
is currently no configured external private reporting channel for people without
repository access.

## No-spend and approval gates

The billing Actions/usage-summary API checks returned HTTP 404. Included minutes,
remaining allowance, and a usage-blocking budget therefore could not be verified.
Private Actions can incur charges beyond included allowances. Do not push the
workflow or trigger CI until a zero-spend guard is confirmed, such as an applicable
$0 Actions spending budget with usage blocking enabled. No budget, billing, or
repository settings were changed.

The concrete proposal awaiting explicit human approval is:

1. Change the existing `jigar48/api-contract-diff` repository from public to private
   and verify the result. Do not create another repository.
2. Confirm the no-spend guard before any workflow-triggering push.
3. Add the local origin, commit the reviewed staged files on `main`, and push
   without force once the gates are satisfied.
4. Observe the exact pushed commit's six CI jobs and report actual outcomes,
   failures, or blocked/skipped jobs. Configuration alone is not a passed matrix.

No GitHub release, npm publication, deployment, purchase, or paid usage is
authorized. The user explicitly confirmed private CI validation only.
