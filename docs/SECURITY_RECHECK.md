# Security recheck — September 26, 2026

The user requested another focused review after SECURITY_REVIEW.md. Two additional defects were reproduced with bounded, local fixtures and corrected in all three projects.

## Duplicate console in fallback response data

When a native response omitted result or returned result: null, the gateway returned the entire envelope as data. The separate console field was masked, but data.console still contained the original credential echo. A regression failed before the fix with a plaintext fixture password in that duplicate.

The fallback envelope now carries the same masked console as the dedicated field. Tests cover absent/null result, ordinary API and extension-log responses, and a single-character credential to detect accidental replacement of mask markers. Ordinary API identifiers remain exact; extension logs retain their existing diagnostic masking policy.

This is a conditional disclosure: the native console must contain a known credential. The fixture does not show that IRIS normally logs passwords, or that a different account could access this response.

## Invalid native login identity

The login gate previously checked only whether Number(apiVersion) was below 2. Missing or nonnumeric versions could bypass that comparison, and missing/non-string usernames were accepted. A controlled empty info response created a session before the patch.

All portals now require a nonnegative safe integer API version (numeric strings remain supported) and a nonblank string canonical username of at most 128 characters before issuing a session. Version 1 continues to receive the existing unsupported-version response. The native canonical name is preserved exactly, rather than being substituted with the submitted login name.

This also protects Relay ownership: missing names could otherwise be converted to the same "undefined" stored-run owner if subsequent malformed info responses also supplied operating privileges. No such malformed response or cross-account exposure was observed on the actual IRIS instances.

## Verification and limits

- 71/71 tests pass, with three additional regression cases covering multiple input variants.
- TypeScript and production bundles pass. Installed-gateway, native smoke and extended workflows pass after rebuilding the local portal.
- Atlas live access analysis and Relay live runbooks pass.
- npm audit reports zero known vulnerabilities in each of the three dependency trees.
- Local integration tests use the published IPv4 loopback ports, with the configured localhost Origin. An initial localhost connection selected IPv6 and was refused; the IPv4 runs completed successfully.
- Initial failing fixtures, final test/audit output and integration logs are retained under research/security-recheck-* in the parent workspace.

The review also revisited CSRF/origin checks, session rotation and limits, upstream allowlisting, identity preservation, and Relay report authorization. This bounded review is not a complete penetration test, container OS scan or IRIS product certification. The previously rejected trickling-stream probe was not retried. No external service was published or targeted.
