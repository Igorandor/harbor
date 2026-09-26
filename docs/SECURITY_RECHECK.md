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

## Third requested review: error handling and operation consistency

A further user-requested review reproduced and fixed two reliability defects on September 26. Neither reproduction establishes a new authentication bypass or compromise of a live IRIS instance.

### Nonempty error lists could be treated as success

The shared gateway joined native error messages and then tested the resulting string for truthiness. An HTTP 200 response with errors: [""] or errors: [{ message: "" }] therefore appeared successful. A null error entry could instead cause a JavaScript exception. This matters for writes because an error indication must not be presented as successful completion.

Every entry in a nonempty errors/Errors list now produces a nonempty diagnostic, using a generic message when the native entry provides none. Null and primitive entries are handled without dereferencing them. Empty lists remain successful, informative messages remain readable, and writes are never automatically replayed. Two regression cases per project cover these variants. The false-success fixture failed before the fix and passes afterward.

### Relay reconciliation bypassed the target operation lock

Relay serialized normal steps and restoration by canonical target, but reconciliation of an uncertain write used only the per-run lock. It could therefore observe and record target state concurrently with an operation from another run, including one owned by another account.

Reconciliation now holds the existing target lock across its state read and journal update. Two deterministic regression cases pause a fixture read and prove mutual exclusion in both directions, using different owners and equivalent application names (/sample and /SAMPLE//). A conflicting request receives 409 before reaching IRIS or changing the uncertain run. After the lock is released, work continues and reconciliation does not repeat the native write.

This remains a single-process coordination guarantee for Relay operations. It does not lock out changes made directly in IRIS or by another portal/process, and reconciliation still records observed state without claiming which actor caused it.

### Final verification for this review

This project passes 73/73 tests, TypeScript and production builds. Across all three projects, 251 tests pass. Rebuilt local portals passed installed-gateway, native smoke and extended workflow suites; Atlas access analysis and Relay runbooks also passed. Dependency audits reported zero known vulnerabilities. Test, build, audit and integration evidence is retained in the parent workspace under research/review3-*. Earlier scope limitations continue to apply.
