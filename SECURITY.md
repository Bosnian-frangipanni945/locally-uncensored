# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do NOT open a public issue.** Instead:

1. Email the details to the maintainer (open a private security advisory via GitHub)
2. Or use [GitHub's private vulnerability reporting](https://github.com/PurpleDoubleD/locally-uncensored/security/advisories/new)

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix**: Depends on severity, but we aim for patches within 2 weeks for critical issues

## Scope

Since Locally Uncensored runs **entirely locally** on your machine, the attack surface is limited. However, we still take the following seriously:

- **XSS in the chat UI** — malicious model outputs that could execute scripts
- **Path traversal** — file access outside intended directories
- **ComfyUI API abuse** — unintended command execution through the ComfyUI bridge
- **Dependency vulnerabilities** — outdated npm packages with known CVEs

## Out of Scope

- Vulnerabilities in Ollama or ComfyUI themselves (report to their maintainers)
- Issues that require physical access to the machine
- Social engineering attacks
