# Focused security review — September 26, 2026

This follow-up was requested after the structured-data UI work. It is a bounded source review and local regression exercise, not a certification or an assertion that all vulnerabilities have been excluded.

## Corrected findings

### Authentication echoes in asynchronous diagnostics

The normal top-level console was masked, but native async jobs carry Console and FailureReason inside their result. Those fields passed to the browser without replacing known authentication secrets. A controlled native-response fixture reproduced the cleartext echo before the patch. Exposure requires IRIS/job diagnostics to contain the credential; the test did not show that IRIS normally prints passwords or that another account could read the job.

Both async-result and async-results now mask those diagnostic fields, including supported encoded forms. Job IDs, canonical account names and ordinary Result values remain exact. Existing cross-account report tests still pass. Unknown secrets in arbitrary log text cannot be inferred by this mechanism.

### Retained console output could multiply session memory use

The history retained up to 100 entries but stored each native console response in full. The 8 MB per-response network limit did not bound retained history to a small preview. A controlled response of roughly 50 KB demonstrated that one history entry retained the complete output. No exhaustion or load test was performed against live instances.

History now keeps at most 100 console lines plus a truncation notice, within 16 KiB of serialized UTF-8 console data per entry. Retained strings are copied so a short JavaScript substring cannot keep the large source buffer alive. The original requested response is preserved. Tests cover emoji, JSON escaping, many empty lines, small unchanged output and the actual session activity endpoint.

### Repeated secret replacement amplified replacement markers

Sequential replacement reprocessed text inserted by earlier replacements. The four-character fixture dear with four single-character secrets expanded to 175 characters instead of four markers (40 characters). This allowed attacker-selected credential values to amplify diagnostic-processing work. Severity and impact depend on the size and contents of native diagnostics; no live denial of service was attempted.

Masking now performs a single literal replacement pass over each original string. Regex metacharacters are escaped, longer overlapping values take precedence, and one matcher is reused within the data tree. Credential submissions are limited to 128 values and 32,768 total characters before any upstream write. Error masking processes the diagnostic envelope, not the entire successful result. These limits are additional to the existing request byte/depth/node limits.

## Checked boundaries and evidence

- Fixed upstream target, contract allowlist, query encoding and redirect refusal.
- Session rotation/expiry, CSRF/origin checks and sign-in/concurrency limits.
- Text-only React rendering, fixed native log paths, extension privilege checks and loopback Compose publishing.
- npm audit reported zero known vulnerabilities in the installed dependency tree at review time. This does not scan the complete container OS or IRIS product.

The six new regression cases pass together with the existing suite: 68/68. TypeScript and production bundles pass.

No external targets, destructive load, unauthorized account access or publication were involved. Local integration suites use disposable native records and preserve their usual cleanup behavior.

After the final rebuild, installed-gateway, native CRUD/observability and extended workflow suites passed on the real local IRIS instance, including asynchronous audit retrieval.
