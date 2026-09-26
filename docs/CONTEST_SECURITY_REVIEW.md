# Contest and authorization review — September 26, 2026

## Confirmed defect and correction

A real limited-account check exposed a misleading error classification. The IRIS Web Gateway can return an empty HTTP 403 before dispatching the native extension. The portal previously converted that response to a 502 JSON/protocol error. Access stayed denied; this was not a privilege escalation. The gateway now preserves 401/403 for empty, HTML and primitive denial bodies, without returning their contents. Valid JSON diagnostics still use the existing masking path.

The native extension in the bundled `%SYS` installation also requires database read access (`%DB_IRISSYS:R`), in addition to `%Admin_Operate:USE`. Deployment documentation now records both. The installer does not grant either privilege to users.

## Verification

- `npm run check`: build and all tests pass, including eight denial-body/status combinations in a new regression.
- `npm run test:authorization`: creates a temporary role and account, confirms telemetry access with the two required resources, refuses an attempted security-privilege grant, checks the unchanged role, removes database read access and checks HTTP 403, then removes roles and verifies access denial through the existing gateway session and direct native extension. Cleanup removes the account/role and logs out. Run only on a disposable instance with the same environment variables as `test:install`.
- The rebuilt local portal passes `test:install`; npm audit reports no known vulnerable dependencies at review time.
- Tracked files and reachable Git history were checked for operational paths and common credential signatures. No matches were found; known local demo passwords remain explicitly documented. This pattern scan cannot recognize every possible secret.

This review additionally inspected session/CSRF/origin checks, request allowlisting, redirect handling, response/history bounds, masking, native extension dispatch and the sibling projects' snapshot and runbook boundaries. No new authorization bypass was confirmed in that scope. It is not a container OS/IRIS vulnerability certification or an external identity-provider test.

## Submission readiness

The local English README, installation, written walkthrough, license and six functional areas are present. Public repository publication, Open Exchange listing and contest acceptance are still pending. Review [CONTEST.md](CONTEST.md) before submission. The shared foundation must be disclosed; separate acceptance of the sibling entries remains an organizer decision.
