# Project governance

Luma Darkroom uses lightweight, maintainer-led governance intended for a small
open-source desktop project. Governance may evolve through the same public
change process as other project policy.

## Roles

### Contributors

Anyone participating through issues, reviews, documentation, testing, design,
or code is a contributor. Contributors have no obligation to provide ongoing
support.

### Maintainers

Maintainers can triage issues, review and merge changes, moderate community
spaces, and steward project scope. Maintainer status is reflected by repository
permissions; this document does not invent or publish a separate roster.

### Release maintainers

Maintainers explicitly trusted with release access may update versions, build
artifacts, verify notices, sign artifacts when a legitimate signing identity is
available, and publish releases.

### Security triagers

Maintainers assigned to private security reports coordinate assessment,
remediation, and disclosure. Reports involving a maintainer should be handled
by an unimplicated maintainer whenever reasonably possible.

One person may hold multiple roles.

## Decisions

Routine changes use review and maintainer judgment. Substantial changes should
begin with an issue or design proposal describing the problem, alternatives,
data migration, security and privacy effects, performance bounds, and support
cost.

The project seeks rough consensus, informed by evidence and working code. When
consensus is not reached, maintainers decide based on:

- safety of original photographs and catalog data;
- local-first privacy and a narrow attack surface;
- interaction speed and bounded resource use;
- accessibility and maintainability;
- compatibility with project scope and available reviewer capacity.

There is no voting entitlement based solely on contribution count. A maintainer
with a direct conflict of interest should disclose it and recuse when practical.

## Becoming or leaving a maintainer

Existing maintainers may invite a contributor who has demonstrated sustained
sound judgment, respectful collaboration, reliability, security awareness, and
review participation. Access should follow least privilege and may begin with a
limited role.

A maintainer may step down at any time. Access may be suspended or removed for
inactivity, compromised credentials, repeated policy violations, or conduct
inconsistent with project trust. Sensitive rationale may remain private.

## Releases and security

Release authority follows [Releasing](docs/RELEASING.md). Security work follows
[Security](SECURITY.md) and [Security model](docs/SECURITY_MODEL.md). No single
policy document guarantees a release schedule, security outcome, or support
level.

## Policy changes

Changes to governance, conduct, security, trademarks, or licensing require a
focused pull request and maintainer approval. Such changes should not be hidden
inside unrelated implementation work.
