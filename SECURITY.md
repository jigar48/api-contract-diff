# Security policy

## Supported versions

During the first release-candidate cycle, security fixes target the latest
`0.1.0-rc` candidate and the default branch. Older candidates are not maintained
separately. This is an early project; no response-time or support SLA is promised.

## Reporting a vulnerability

Please do not include exploit details, credentials, or sensitive specifications in
a public issue or pull request.

This repository is public. If **Security → Report a vulnerability** is available, use
[the private reporting form](https://github.com/jigar48/api-contract-diff/security/advisories/new)
to submit details to maintainers rather than opening a public issue. See
[GitHub's private-reporting instructions](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/privately-reporting-a-security-vulnerability).

If that option is unavailable on a public repository, open a public issue asking the maintainers to enable
private vulnerability reporting or provide a private disclosure channel. Include
only a request for contact, not vulnerability details. Until a private channel is
available, retain the details privately. There is no designated security email
address for security reports is designated at this stage. The general business
contact in the README is not a promised confidential security-reporting service.
A policy file alone does not enable GitHub reporting, and this policy does not
claim the form is currently enabled.

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

Maintainers should enable private vulnerability reporting and verify the reporting
option before making a release announcement. No security advisory is published
as part of CI or documentation updates.
