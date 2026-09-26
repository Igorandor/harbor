# Architecture and extension points

## Request path

1. The browser sends login credentials to the same-origin gateway.
2. The gateway calls `/api/admin/info`, checks API version 2 and stores the user's authorization header in an expiring in-memory session.
3. Subsequent operations contain a method, an exact catalog path, a query dictionary and optionally a body. Operators cannot supply a target URL.
4. The gateway validates the operation against the request contract and an explicit write allowlist, encodes query values with `URLSearchParams`, calls IRIS and checks both HTTP status and IRIS status errors.
5. Asynchronous reads expose only a job identifier. The client polls `/v2/async-result` with a bounded wait and reports failures, cancellation, pause or unfinished work.

## User interface

`Collection` provides search, pagination, detail inspection and edit entry points. `Editor` uses the contract for field types and descriptions, with specialized resource-grant controls. Additional settings are explicitly added from the schema. Nested configuration remains available as validated JSON where the IRIS API supports multiple complex structures.

Updates normally send only changed fields. Tasks are an exception: IRIS requires complete records, so the editor preserves the loaded configuration and supplies complete defaults for new tasks. New tasks default to **On Demand**, avoiding unintended schedules. The review displays changes and masks credential fields.

Before an update, the editor reloads the record and compares changed fields with the original values. This detects common conflicts but does not eliminate the race between re-read and write. IRIS v2 does not expose an ETag precondition in the pinned contract. Destructive changes use a typed identifier confirmation.

`useData` ignores stale responses after navigation and refreshes only while the document is visible. Sampling timestamps are shown. Theme is the only persisted browser preference. Lists and request history are bounded; the system does not collect unbounded telemetry or copy IRIS data into another database.

## Known wire-contract adaptations

- Audit retrieval is `POST /v2/security/audit/records`, followed by async-result polling; it is not a GET.
- OAuth client bodies use `ServerDefinition` on tested IRIS 2026.2, while the published schema names it `OAuth2ServerDefinition`. The gateway translates this field at the boundary and normalizes responses back to the schema name.
- The task list's `Suspended` flag was observed to remain false after suspension. Harbor reads the authoritative `/v2/task/info` field in task details and does not show the unreliable list flag as a status indicator.
- Task creation requires all scheduling fields even when the published schema omits JSON Schema `required` declarations. `task-defaults.ts` supplies complete defaults.

The pinned source specification is kept unchanged. Run `npx tsx scripts/build-contract.ts` to regenerate the smaller browser request contract. Contract tests detect invalid endpoint and editor-field mappings.

## Adding a managed resource

1. Add a catalog entry with the actual list identity, detail query name and relevant fields.
2. Add write endpoints to `server/upstream.ts` only if needed; never create a wildcard proxy.
3. Validate the behavior on a disposable IRIS instance with create/update/read/cleanup tests.
4. Add the workspace route and document the required IRIS resource.

Keep resource-specific workflows in dedicated components once they exceed simple collection editing. Do not put domain policy into generic table components.
