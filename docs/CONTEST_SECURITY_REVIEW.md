# Contest and authorization review — September 26, 2026

## Confirmed defect and correction

A real limited-account check exposed a misleading error classification. The IRIS Web Gateway can return an empty HTTP 403 before dispatching the native extension. The portal previously converted that response to a 502 JSON/protocol error. Access stayed denied; this was not a privilege escalation. The gateway now preserves 401/403 for empty, HTML and primitive denial bodies, without returning their contents. Valid JSON diagnostics still use the existing masking path.

The native extension in the bundled `%SYS` installation also requires database read access (`%DB_IRISSYS:R`), in addition to `%Admin_Operate:USE`. Deployment documentation now records both. The installer does not grant either privilege to users.

## Verification

- `npm run check`: build and all tests pass, including eight denial-body/status combinations in a new regression.
- `npm run test:authorization`: creates a temporary role and account, confirms telemetry access with the two required resources, refuses an attempted security-privilege grant, checks the unchanged role, removes database read access and checks HTTP 403, then removes roles and verifies access denial through the existing gateway session and direct native extension. Cleanup removes the account/role and logs out. Run only on a disposable instance with the same environment variables as `test:install`.
- The rebuilt local portal passes `test:install`; npm audit reports no known vulnerable dependencies at review time.
- Tracked files and reachable Git history were checked for operational paths and common credential signatures. No matches were found; published quick-start passwords remain explicitly documented. This pattern scan cannot recognize every possible secret.

This review additionally inspected session/CSRF/origin checks, request allowlisting, redirect handling, response/history bounds, masking, native extension dispatch and stored-record access boundaries. No new authorization bypass was confirmed in that scope. It is not a container OS/IRIS vulnerability certification or an external identity-provider test.

## Submission readiness

The local English README, installation, written walkthrough, license and six functional areas are present. The repository and Open Exchange application are public; see [CONTEST.md](CONTEST.md) for publication details.

## Installation and log-reading follow-up

The Docker installer previously used `halt 1`, which is invalid ObjectScript, and could continue to a misleading success message after compilation failure. Install and demo-configuration operations now check native status and terminate their own installation session with exit code 1. A same-command error trap also handles unexpected runtime failures in direct mode. Both failure paths were verified with bounded disposable-session probes; the clean image build succeeded.

Log tailing now reads a bounded window before discarding a partial leading line. The former skip using an unbounded readline could read beyond the intended window for a very long log line. Offline tests cover a long line without delimiters, a partial line followed by a valid record, masking and source rejection. This was not tested by flooding a live native log.
