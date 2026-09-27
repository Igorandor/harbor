# Verification record

## Expansion checkpoint — September 27, 2026

Current source check: `npm run check` passes TypeScript, browser/server builds and **179 tests**. The added coverage includes durable change dispatch/readback/reconciliation, process generation and canonical-target guards, workspace isolation/revision conflicts, bounded file reads, log windows/cursors, reusable investigation profiles, runtime analysis, application inspection, task history and typed evidence reviews. `npm audit --omit=dev` reports zero production dependency vulnerabilities at this checkpoint.

Four redaction regressions cover the exact boolean account-policy keys `ChangePassword`, `PasswordNeverExpires` and `HOTPKeyDisplay`. Their `true`/`false` values now remain readable as operator configuration. Other spellings, nonboolean values (including strings, null, objects and arrays), actual credential fields and entire secret-bearing ancestor branches remain masked. Submitted credential collection and literal diagnostic-echo masking remain intact. Two tests reproduced over-redaction before the change; all four pass after the narrow exception.

A subsequent editor review reproduced a stale-draft bug with a controlled component harness: a delayed preparation captured value A, while editing the still-enabled field to B caused the review to display B for the ticket that would send A. The editor now disables its fields during preparation and renders the target, method and before/after values from the prepared server record. Three harness tests exercise that race, failed preparation with retained input, and ambiguous execution with retained reviewed evidence and disabled replay. These checks execute the actual component with mocked state/transport; they do not use a browser or perform native writes. Browser validation of this latest editor adjustment remains a separate release check.

Four further component regressions exercise investigation selection and draft preservation with delayed responses. Pending reads and writes now block another selection or close, including clicks queued before the disabled controls render; unmounted requests cannot replace later state. Editable action fields are disabled during a pending operation, and successful responses clear only the submitted text rather than a newer queued draft. A successful note response followed by a failed list refresh retains the committed record and revision, clears the saved draft and reports the refresh failure separately, preventing an unnecessary retry of the note. Failed note writes retain their draft. All four tests failed against the previous implementation and pass after the correction. These checks use the actual page and detail components with controlled transport; browser validation is recorded separately.

Six subsequent component checks cover an open investigation after access changes. A reproduced 403 refresh previously left the cached timeline and export action available. The denied case and its summary now leave the view; an authorized list that filters out the case also closes it. A refused read of a different case preserves the current case's draft. A 500 response or explicitly unreadable listing entry preserves the unsaved draft, distinguishing a storage error from a confirmed authorization denial. Exports already downloaded cannot be recalled; these checks prevent continued export from the visible workbench after Harbor learns of the denial. Validation used controlled component responses without changing native privileges.

Final source-authorization review corrected OAuth resource-server receipt access: those records now use the native security probe, while only `/oauth2/client/` records use the OAuth client probe. Four HTTP regressions verify detail, reconciliation and listing after revocation for OAuth resource servers, OAuth clients, wallet and device records. Other native families stay authorized in these fixtures so an incorrectly broad authorization mapping cannot pass by accident. Full checks passed again after this correction; installed-gateway checks below identify their earlier execution point.

A later HTTP review reproduced an indirect read of a revoked change record: its direct endpoint returned 403, but linking its ID to a case copied its title and target into the timeline. Linking and subsequent case access now use the same current source authorization as direct change access. Thirteen additional route tests cover all supported source families, existing links after revocation, unchanged case state after a refused link, missing/unreadable source records, source authentication failure, and owner/instance isolation. Detail JSON used for exports is denied along with ordinary case retrieval; there is no separate export endpoint. Previously downloaded data cannot be recalled. The regression suite reproduced eleven failures before the correction, while the two isolation checks already passed. Full source checks pass after the correction without changing native privileges or replaying native operations.

Evidence-review tests verify missing/null/type distinctions, numeric deltas, bounded comparisons and previews, known inventory identity matching, preservation of unknown array order, PID reuse, export escaping/formula protection, saved decisions and prior reasoning, conclusion/reopen lifecycle, rejection of stale revisions and foreign captures, account/instance isolation, and current source-privilege checks on the HTTP routes. A conclusion requires explicit acknowledgement of source and comparison limits. These are deterministic fixtures, not a security certification.

Native gateway checks during this expansion verified case creation/capture/revision/relogin/archive, older log pages and invalid-path rejection, task observations, and disposable resource creation/edit/deletion with readback plus duplicate/stale/raw-write guards. On September 27 at 10:01 UTC, a real evidence-review workflow captured host capacity twice, compared seven typed differences, refused premature conclusion with HTTP 409, persisted all decisions, rejected a stale reopen, retained decisions/history across logout/login, and completed reopen/reconclude/resolve/archive. The archived investigation is `2f61787e-7844-4ac1-aecc-65ba7f34345e`; no IRIS administrative mutation was needed for that comparison.

Actual-browser review confirmed the seven expected decisions, zero unreviewed differences, conclusion and decision history. Desktop and 390-pixel mobile layouts were inspected; the mobile evidence view had matching 375-pixel client and scroll widths. Application and task inspector views were also checked. Screenshots: [evidence review desktop](images/evidence-review-desktop.png), [evidence review mobile](images/evidence-review-mobile.png), [task center desktop](images/task-center-desktop.png), [task center mobile](images/task-center-mobile.png), [application inspector mobile](images/application-inspector-mobile.png).

The following existing native suites passed again on September 27 around 10:09 UTC against the supplied IRIS Community instance and rebuilt gateway. These were checks of an existing installation, not a new-volume installation; no configuration reset or volume replacement was performed.

| Command                      | Rechecked scope                                                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:install`       | Production static page/CSP, login/session/CSRF, native identity, applications, tasks, telemetry, logs and logout through the gateway.                                                                                                                                 |
| `npm run test:authorization` | Disposable restricted user/role; telemetry allowed; privilege escalation refused at change preparation; native database access denial preserved as 403; revoked privileges effective in the same session and direct extension. User/role removed and sessions closed. |
| `npm run test:live`          | Native lists/details and disposable resource, role, application, wallet collection, device and TLS create/edit/read/delete; all six cleanup operations passed; telemetry/log/history/journal/audit reads passed.                                                      |
| `npm run test:workflows`     | Disposable user disablement, wallet metadata-only listing, task partial update preserving unrelated fields, task suspend/resume/run, OAuth server/client/secret configuration and completed asynchronous audit job. Cleanup finished without errors.                  |

The authorization script was updated to use the current prepare/execute gateway workflow. Its former raw `/api/iris` write path is intentionally unavailable; the test change preserves the denied-escalation check at the currently supported boundary. TypeScript and `git diff --check` pass after this test-only adjustment. Native direct-client CRUD suites supplement, rather than substitute for, the separate gateway dispatch/reconciliation checks.

The Windows test account could not create a symbolic-link fixture (`EPERM`); the oversized-file rejection check passed and the implementation rejects symlinks before bounded descriptor reads. Linux-specific verification and final packaging are recorded separately when complete. Build output currently reports a large client bundle; this is a delivery-size warning, not a failing build.

The entries below describe earlier, pre-expansion checkpoints. Their old totals and screenshots must not be read as final validation of newly added features.

Verified September 26, 2026 against a real, disposable InterSystems IRIS Community **2026.2 build 221U** instance, using the image digest pinned in `iris/Dockerfile`.

## Reproducible checks

| Check                                                        | Result                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                              | TypeScript and production bundles pass; 76 security and API-contract tests pass.                                                                                     |
| `npm audit`                                                  | No reported vulnerabilities in the installed dependency tree at verification time.                                                                                   |
| Fresh `docker compose up -d --build` with a new named volume | Both services become healthy; login and real gateway requests pass.                                                                                                  |
| `npm run test:install`                                       | Production static files, CSP, session, CSRF, info, applications, tasks, telemetry, logs and logout pass.                                                             |
| `npm run test:live`                                          | Native lists/details, resource/role/web-app/wallet-collection/device/TLS CRUD and observability pass.                                                                |
| `npm run test:workflows`                                     | User creation and disablement; wallet secret metadata isolation; task create/suspend/resume/run; OAuth server/client/credentials; asynchronous audit retrieval pass. |
| `npm run test:x509`                                          | Disposable self-signed certificate import, metadata update, read and cleanup pass.                                                                                   |
| `npm run test:process`                                       | Explicit demo worker suspension, resumption and termination pass; disappearance verified in the process list.                                                        |

The same main live suites passed against both a directly started container and the fresh Compose installation. Records are created with unique test names and cleaned up in `finally` blocks. No existing business data is required.

The worker test refuses to control a process unless its routine identifies `Harbor.DemoTask`. To start it in the bundled stack:

```sh
docker compose exec -T iris iris session IRIS < iris/start-test-worker.script
# Copy HARBOR_TEST_PID from the output; then, within two minutes:
IRIS_TEST_PID=1234 npm run test:process
```

Set `IRIS_TEST_USER`, `IRIS_TEST_PASSWORD` and `IRIS_URL` first. For X.509 testing, create a disposable PEM certificate using OpenSSL inside the IRIS container and set `IRIS_TEST_CERT` to its path **inside IRIS**; see `scripts/live-x509.ts` for the exact environment contract.

For the installed gateway test set `PORTAL_URL` to the reachable portal URL and `PORTAL_ORIGIN` to the exact `PUBLIC_ORIGIN`. This distinction is useful on machines where `localhost` resolves to IPv6 but Docker ports are published on IPv4.

## Browser review

The interface copy and layout were refined in a subsequent review: direct screen titles, compact sign-in forms, fewer repeated labels and smaller operation cards. The updated production interfaces were checked at desktop and mobile widths, including keyboard navigation and theme switching.

The actual browser was used against the real server, including the production Compose installation. Checks covered sign-in, navigation, loading and loaded states, task details, native process/database data, host telemetry, system logs, asynchronous security audit, and an application editor's separate change-review step. Keyboard activation and Escape dismissal were checked. A 390 × 844 viewport was used to review the responsive layout and dark theme. This was an interactive review, not a claim of automated WCAG certification.

## Limits of the evidence

- The 2026.3 preview was inspected for compatibility, but the full regression baseline is 2026.2. IRIS for Health was not separately tested.
- OAuth configuration and credential updates were verified. A complete authorization-code flow against an external identity provider requires that provider's registration and is not included in the offline tests.
- X.509 testing uses a disposable certificate, not a production trust chain or hardware security module.
- CPU and memory reflect the Linux host visible to IRIS, not cgroup limits. Other operating systems provide reduced telemetry.
- The browser list is intentionally bounded to 250 records. Filtered exports contain the loaded view, not a full-instance backup.
- Dashboard samples can become stale when the IRIS system monitor stops. Harbor labels this state and suppresses sampled process/performance figures until it updates again.
- Edit conflict detection is a read-before-write check; the native API does not provide an atomic ETag condition here.
- Logs may contain application data despite best-effort masking. Review exports before sharing them.
- Session state and the last 100 portal activity records live only in process memory. They are not a durable security audit; use native IRIS audit for that purpose.

## Structured-data follow-up, September 26

The final source passes TypeScript, production bundling and 62 tests. The rebuilt Compose stack passed installed-gateway, native CRUD/observability and extended workflow suites.

Browser checks covered the structured REST response, nested disclosures and the distinct product workspace. Shared components were exercised through Harbor's native MatchRoles array: adding an object and nested TargetRoles array, editing a value, closing/reopening without loss, reviewing the result and removing an entry. The draft was cancelled without applying permissions. Relay checks covered real stored host, health, message and scheduling-state evidence, unit switching, classification, empty filters and keyboard activation. Atlas checks covered an empty baseline comparison and an added disposable resource shown as field differences; the resource was removed afterward.

The responsive checks used a 390 × 844 viewport. They found an absolutely positioned screen-reader table label escaping its horizontal scroll area; the scroll container now provides its positioning context. Wide tables keep their own horizontal scroll. The inspected browser error/warning logs were empty. These checks are interactive evidence, not an accessibility certification.

Native resource creation rejected missing and empty PublicPermission values in this review, and the form retained the error and draft for correction. A populated disposable resource succeeded. This is not evidence that every native schema constraint is validated before submission. Presentation choices and limits are described in [DATA_VIEWS.md](DATA_VIEWS.md).

## Subsequent security follow-up

Six additional regressions cover asynchronous diagnostic masking, identity preservation, retained history bounds, escaped/multibyte output, single-pass literal replacement and rejection of excessive credential fields before a write. All 68 tests and production builds pass. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for reproductions, scope and limitations.

The security follow-up was deployed to the local Compose portal. Installed-gateway, native smoke and extended workflows passed after rebuilding; Atlas live access analysis and Relay runbooks also passed. No container OS vulnerability scan or IRIS product certification is implied.

## Second security recheck

The subsequent recheck fixed duplicate unmasked fallback consoles and rejected malformed native login identities/API versions before session creation. All 71 tests, TypeScript checks and production builds pass. The rebuilt local portals passed installation, native smoke and extended workflow suites, plus Atlas access analysis and Relay runbooks. Dependency audits report zero known vulnerabilities. See [SECURITY_RECHECK.md](SECURITY_RECHECK.md) for reproduction conditions and limitations.

## Third requested review

The next review corrected false success for nonempty native error lists without messages and added target locking to Relay reconciliation. All 73 tests, TypeScript and production builds pass. Rebuilt local portals again passed installation, native smoke and extended workflows, plus Atlas access analysis and Relay runbooks. Dependency audits reported zero known vulnerabilities. Deterministic failing-before/passing-after fixtures and the scope of the locking guarantee are documented in [SECURITY_RECHECK.md](SECURITY_RECHECK.md).

## Expanded review

The final build passes 75 tests. The expanded review added malformed-capture and graph cases, upstream protocol checks, native task-edit preservation checks, and browser checks of request sequencing and sign-out failures. All primary native suites, Atlas access analysis, Relay runbooks, X.509 and demo process-control suites passed; final installed-gateway checks passed after the last rebuild. See [DEEP_REVIEW.md](DEEP_REVIEW.md) for fixes, evidence and the stopping criterion.

## Contest and authorization review, September 26

The current build passes 76 tests. The rebuilt gateway passed the new `npm run test:authorization` suite and `test:install` against the bundled IRIS Community instance. The new suite verifies restricted access, refusal of security-privilege escalation, database-read denial and revocation in an existing session. See [review details](CONTEST_SECURITY_REVIEW.md). Earlier specialized live-suite results above remain historical evidence; they were not all repeated in this round.

## September 26 installation follow-up

The final Harbor source passes 76 tests, the production build, npm audit (zero reports), current native authorization and installed-gateway checks. A clean native image build passed after fixing failed-status and runtime-error termination in installation/configuration scripts. Offline log-window tests cover a very long leading line without unbounded reads. These changes preserve Harbor's existing administration UI. Atlas and Relay now have independent application foundations; see their provenance documents.

## Final independent release verification

Current September 27 result: 80 tests and the production build pass. Installed gateway, authorization, native smoke and extended workflow suites passed against the current local instance. Diagnostic bundle captured all eight selected real sources in the browser; source failures, masking, limits, request validation and pending responses have automated regressions. Desktop and 390 × 844 views were inspected. The download event in the browser automation timed out, so that attempt does not certify writing the exported file to disk. Report payload construction is covered separately. Earlier counts below/above describe historical checkpoints.
# Protected investigation browser verification — 27 September 2026

The production UI served by isolated loopback fixture3411 preserved the selected investigation and an unsent note after detail GET500. Detail GET403 removed its protected note, selected view and export on desktop; a separate mobile case confirmed the same removal at390 CSS pixels with no page overflow. The fixture recorded zero native requests and zero applied writes. Evidence is retained in the parent workspace's `research/harbor-protected-read-browser.json` and `harbor-protected-read-*.png`. The existing gateway was rebuilt afterward; IRIS data and volumes were preserved.
# Native account-policy display — 27 September 2026

An authorized read of the existing SuperUser account through the rebuilt gateway displayed the three documented boolean account-policy flags as No. Desktop1280×900 and mobile390×844 (375 CSS pixels client/scroll) browser checks passed. No account policy was changed. Evidence is retained in the parent workspace's `research/harbor-policy-flags-desktop.png` and `harbor-policy-flags-mobile.png`.
