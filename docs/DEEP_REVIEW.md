# Correctness and security review — September 26, 2026

This historical checkpoint records fixes and checks for Harbor. For the current implementation and later checks, see [VERIFICATION.md](VERIFICATION.md).

## Corrections

| Area                     | Defect and resulting behavior                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| task editor       | Editing sent the full loaded task despite reviewing only changed fields. A concurrent change to an untouched setting could be overwritten. Edits now send the changed fields; task creation still sends the complete defaults required by IRIS. Existing same-field conflict checks remain.                                                                                                                                                                   |
| REST explorer     | Switching endpoint or parameters during an in-flight request could associate the old response with a new query. Relevant controls are disabled while waiting, and changing parameters clears the previous result.                                                                                                                                                                                                                                             |
| log following     | Automatic refresh could start another read before the previous read completed. One read at a time prevents older poll results overwriting newer results within the same source.                                                                                                                                                                                                                                                                               |
| sign-out          | Failed logout promises had no user-visible error. The app now shows an explicit failure and retry control, and clears that message after a subsequent login. It does not claim that an unconfirmed logout succeeded.                                                                                                                                                                                                                                          |
| upstream protocol | Primitive/null documents produced internal errors or invalid success data. HTTP 202 without a usable job ID could appear complete. Both now produce controlled 502 errors; accepted operations with missing IDs explicitly warn that native state must be checked before retrying.                                                                                                                                                                            |

## Evidence at this checkpoint

- 75 tests, TypeScript and production bundles passed.
- A built task-editor fixture sent only the reviewed Name field and preserved a concurrent Description update.
- Delayed fixture responses confirmed disabled REST endpoint selection; log following retained one pending read; failed logout exposed an error and retry control.
- Native installed-gateway, smoke and extended workflow suites passed. A disposable task accepted a partial edit while preserving another field; temporary test records were removed.
- Certificate import/update/read/cleanup and explicitly created worker suspension/resumption/termination passed. Temporary certificate files and workers were cleaned up.
- Dependency audit reported zero known vulnerabilities at this checkpoint.

## Scope and limitations

The checks covered sessions, origins/CSRF, fixed upstream targets, credential masking, request/response budgets and presentation of native data. They do not certify IRIS or the container OS, every browser, IRIS for Health or a full external OAuth provider flow. Read-before-write checks cannot prevent a concurrent external native change. Arbitrary secrets in logs cannot be inferred perfectly. No external target or destructive load test was used. Passing these checks is not proof that all possible defects are absent.
