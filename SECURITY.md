# Security policy

Security reports are welcome. Please do not disclose a suspected vulnerability
in a public issue, pull request, discussion, screenshot, or crash log.

## Supported versions

| Version | Security fixes |
| --- | --- |
| 2.x | Supported on a best-effort basis |
| Earlier versions | Not supported |

Only the latest available 2.x release should be assumed to receive a fix. This
table is a maintenance statement, not a warranty, service-level agreement, or
guarantee that every report will be fixed.

## Private reporting

Use the repository hosting platform's private security-reporting or private
maintainer-contact feature. Include:

- affected version and whether it is a source or packaged build;
- operating system and architecture;
- a minimal reproduction using synthetic or public test data;
- the security impact and required attacker capabilities;
- relevant stack traces with usernames, paths, and image metadata removed;
- any suggested mitigation;
- whether and where the issue has already been disclosed.

If no private mechanism is visible, open a minimal public issue asking
maintainers to establish a private security channel. Do not include exploit
details, affected paths, personal data, or proof-of-concept material there.
This repository intentionally publishes no invented email address or external
intake URL.

Maintainers will assess reports as capacity permits and may request more
information, coordinate a fix and release, or explain why a report is out of
scope. There is no guaranteed response time, bounty, embargo, confidentiality
level, or legal safe-harbor promise.

## In scope

Examples include:

- renderer-to-main privilege escalation or preload bridge abuse;
- bypasses of IPC validation, navigation restrictions, permission denial, or
  the Content Security Policy;
- unintended arbitrary file read or write;
- catalog data injection that results in code execution or prototype pollution;
- malicious image or catalog input that causes a practical security boundary
  bypass;
- insecure installer or update behavior represented as official project
  behavior;
- leakage of photo paths, metadata, edits, crash data, or image content.

Purely local crashes, unsupported codecs, high resource use, and image-quality
disagreements are normally reliability bugs unless they cross a security
boundary or permit a realistic denial of service by an untrusted actor.

## Research expectations

- Use files and systems you own or are authorized to test.
- Do not access, retain, alter, or disclose another person's data.
- Do not degrade hosted project services or distribute weaponized exploits.
- Give maintainers a reasonable opportunity to investigate before disclosure.
- Remove real photographs, catalogs, credentials, and personally identifying
  paths from reports.

Nothing in this policy grants permission to test third-party systems, waives
applicable law or third-party terms, or provides a legal guarantee. Researchers
are responsible for understanding their obligations.

See [Security model](docs/SECURITY_MODEL.md) for the documented trust boundaries
and known limitations.
