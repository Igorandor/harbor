# Verification record

Verified September 26, 2026 against a real, disposable InterSystems IRIS Community **2026.2 build 221U** instance, using the image digest pinned in `iris/Dockerfile`.

## Reproducible checks

| Check                                                        | Result                                                                                                                                                               |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                              | TypeScript and production bundles pass; 42 security and API-contract tests pass.                                                                                     |
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
