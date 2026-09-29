# Security recheck — September 26, 2026

This September 26 checkpoint records two gateway defects reproduced with bounded local fixtures. For later changes and verification, see [VERIFICATION.md](VERIFICATION.md).

## Duplicate console in fallback response data

When a native response omitted result or returned result: null, the gateway returned the entire envelope as data. The separate console field was masked, but data.console still contained the original credential echo. A regression failed before the fix with a plaintext fixture password in that duplicate.

The fallback envelope now carries the same masked console as the dedicated field. Tests cover absent/null result, ordinary API and extension-log responses, and a single-character credential to detect accidental replacement of mask markers. Ordinary API identifiers remain exact; extension logs retain their existing diagnostic masking policy.

This is a conditional disclosure: the native console must contain a known credential. The fixture does not show that IRIS normally logs passwords, or that a different account could access this response.

## Invalid native login identity

The login gate previously checked only whether Number(apiVersion) was below 2. Missing or nonnumeric versions could bypass that comparison, and missing/non-string usernames were accepted. A controlled empty info response created a session before the patch.

The gateway now requires a nonnegative safe integer API version (numeric strings remain supported) and a nonblank string canonical username of at most 128 characters before issuing a session. Version 1 continues to receive the existing unsupported-version response. The native canonical name is preserved exactly, rather than being substituted with the submitted login name.

## Verification and limits

- 71/71 tests pass, with three additional regression cases covering multiple input variants.
- TypeScript and production bundles pass. Installed-gateway, native smoke and extended workflows pass after rebuilding the local portal.

- npm audit reports zero known vulnerabilities in this dependency tree at review time.
- Local integration tests use the published IPv4 loopback ports, with the configured localhost Origin. An initial localhost connection selected IPv6 and was refused; the IPv4 runs completed successfully.

The review also revisited CSRF/origin checks, session rotation and limits, upstream allowlisting, identity preservation,. This bounded review is not a complete penetration test, container OS scan or IRIS product certification. No external service was published or targeted.

## Error handling and operation consistency

A further September 26 review covered error handling and operation consistency. Neither reproduction establishes a new authentication bypass or compromise of a live IRIS instance.

### Nonempty error lists could be treated as success

The gateway joined native error messages and then tested the resulting string for truthiness. An HTTP 200 response with errors: [""] or errors: [{ message: "" }] therefore appeared successful. A null error entry could instead cause a JavaScript exception. This matters for writes because an error indication must not be presented as successful completion.

Every entry in a nonempty errors/Errors list now produces a nonempty diagnostic, using a generic message when the native entry provides none. Null and primitive entries are handled without dereferencing them. Empty lists remain successful, informative messages remain readable, and writes are never automatically replayed. Two regression cases cover these variants. The false-success fixture failed before the fix and passes afterward.

### Final verification for this review

This project passes 73/73 tests, TypeScript and production builds. The rebuilt portal passed installed-gateway, native smoke and extended workflow suites. Dependency audits reported zero known vulnerabilities. Earlier scope limitations continue to apply.
