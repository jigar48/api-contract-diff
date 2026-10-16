# Security policy

## Supported versions

During the first release-candidate cycle, security fixes target the latest
`0.1.0-rc` candidate and the default branch. Older candidates are not maintained
separately. This is an early project; no response-time or support SLA is promised.

## Reporting a vulnerability

Please do not include exploit details, credentials, or sensitive specifications in
a public issue or pull request.

### During private CI validation

When [jigar48/api-contract-diff](https://github.com/jigar48/api-contract-diff) is
private, invited collaborators can report a vulnerability in an issue in that
private repository. Verify the repository is marked **Private** before submitting
details; the issue is visible to repository collaborators, not just the owner.
Do not attach credentials, customer specifications, or other unnecessary secrets.
Coordinate a fix and disclosure with the repository owner, `jigar48`, in that
private thread. Do not use this route while the repository is public.

People without access should retain vulnerability details privately until a
private reporting channel is available. Do not request access by posting exploit
details elsewhere. No email address or additional private contact channel is
designated at this stage.

### After a public release

GitHub's private vulnerability reporting feature is for public repositories.
Before making this project public, the owner must enable it and verify that
**Security → Report a vulnerability** is available. Then use
[the private reporting form](https://github.com/jigar48/api-contract-diff/security/advisories/new)
to submit details to maintainers rather than opening a public issue. See
[GitHub's private-reporting instructions](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/privately-reporting-a-security-vulnerability).

If that option is unavailable on a public repository, open a public issue asking the maintainers to enable
private vulnerability reporting or provide a private disclosure channel. Include
only a request for contact, not vulnerability details. Until a private channel is
available, retain the details privately. There is no designated security email
address at this stage. A policy file alone does not enable GitHub reporting.

A useful private report includes:

- Affected version, operating system, and Node.js version.
- Expected and actual behavior, impact, and reproducible steps.
- A minimal, synthetic specification or reference layout demonstrating the issue.
- Whether filesystem traversal, network access, or credentials are involved.

Maintainers should acknowledge the report, reproduce it, agree on disclosure
timing with the reporter, and coordinate a fix and advisory before public
disclosure. Please allow time for that coordination; no fixed timeline is promised.

## Security boundaries

The CLI rejects remote references and disables network resolvers. It checks local
reference containment using canonical paths. It does not provide a filesystem or
process sandbox: mounted network filesystems, concurrent filesystem changes, and
unbounded input sizes remain risks. Compare stable, trusted local JSON files.

Exit 0 means no supported changes were detected. It is not proof of API
compatibility or input safety. See [README.md](README.md) for known limitations.

Before the first public candidate is announced, maintainers should enable private
vulnerability reporting in GitHub and confirm that the reporting option is visible.
Private CI validation does not require making the code public or publishing a
security advisory. Repository visibility and reporting settings must be verified
on GitHub; this policy does not claim they are already configured.
