# Security policy

This page covers which versions of Ashfolk are supported, how to report a
vulnerability, and what is in scope.

## Supported versions

| Version | Supported |
| --- | --- |
| The latest release and `main` | Yes |
| Older releases | No, update to the latest release |

## Reporting a vulnerability

Report a vulnerability through [GitHub private vulnerability
reporting](https://github.com/imsvidskiy/ashfolk/security/advisories/new). Don't
open a public issue, pull request, or discussion for a security problem.

Include what helps reproduce and assess the issue:

- The version or commit, and the browser and GPU.
- Steps to reproduce, or a proof of concept.
- The impact you expect.

You receive an acknowledgment within three business days and a triage decision
within seven business days. A confirmed vulnerability is fixed in a new release
and disclosed in a GitHub security advisory that credits you, unless you ask
otherwise. Keep the report private until the advisory is published.

## Scope

In scope: everything in this repository, including the game, the worker, and the
site at [ashfolk.com](https://ashfolk.com).

Out of scope: vulnerabilities in browsers, GPU drivers, or three.js, unless
Ashfolk's use of them causes the problem.
