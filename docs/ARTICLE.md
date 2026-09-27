# Investigating an IRIS task with Harbor

When a scheduled task runs slowly, its execution history is a useful starting point. System messages and resource observations add context. Saving them together makes it possible to compare the incident with a later run.

Harbor stores that work in an investigation: diagnostic captures, notes, a checklist and links to administrative changes. This walkthrough creates an investigation and compares two captures without changing IRIS configuration.

The [source repository](https://github.com/Igorandor/harbor) includes installation instructions, an operational guide and verification records. Development used AI assistance; implementation provenance and third-party attribution are documented in the repository.

## Run Harbor

The supplied stack requires Docker with Compose v2 and Linux containers, at least 4 GB of available RAM and approximately 5 GB of free disk space.

```sh
git clone https://github.com/Igorandor/harbor.git
cd harbor
docker compose up -d --build
docker compose ps
```

Allow several minutes for the first build. Open `http://localhost:3100` and sign in as `SuperUser` with `HarborLocal-2026!`. These are public quick-start credentials for the bundled instance. Both published ports bind to loopback; keep this stack on your own machine. A shared deployment needs your own accounts, HTTPS and the settings in the [deployment guide](https://github.com/Igorandor/harbor/blob/main/docs/DEPLOYMENT.md).

The bundled image pins IRIS Community 2026.2. Separate named volumes preserve IRIS data and Harbor's workflow records. `docker compose down` stops the stack without deleting those volumes; adding a volume-removal option would have a different effect.

## Investigate without changing the instance

The following walkthrough uses reads and saved Harbor records. It does not require running, suspending or editing a native task.

1. Open **Task center** and inspect an existing task. Look at its definition, execution state and available history. An empty history is a limitation of the available evidence, not proof that the task has never run.
2. Open **Investigations → New investigation**. Use a question such as “What evidence is available about this task's recent execution?” Add the task identifier to a note.
3. Capture the relevant sources: tasks, task history, host capacity and recent messages. Give the capture a meaningful title. Inspect each source's outcome; an unavailable or oversized section must remain visible as a gap.
4. After an observation interval, capture the same sources again. No change is required merely to create a comparison. Select the two captures in **Compare captures**.
5. Inspect retained differences and their types. Missing, null and empty values are distinct. A numeric delta is arithmetic, not a rate or an explanation of causation. Bounded history windows can change because their window moved.
6. Start an evidence review. Mark each retained difference as expected, requiring investigation or explained, with reasoning. Conclude only when the retained differences are addressed and the evidence limitations have been acknowledged.
7. Add the conclusion to the case and export its report. Inspect operational text and captured data before sharing the file.

For repeated questions, **Investigation profiles** saves the source selection and checklist. Starting from a profile copies a particular revision into the new investigation. A later profile edit cannot silently rewrite an earlier case's checklist.

## Connect evidence to a real change

When a native change is justified, Harbor's editors provide a separate review of the target and requested fields. The gateway saves a receipt before dispatch and refuses duplicate dispatch of that preparation. **Change history** retains the result and can link it to the investigation.

Receipt states matter. **Verified** means the observable result matched the expected readback; it does not establish that arbitrary task code or an application works correctly. **Acknowledged** represents an accepted operation whose write-only value or effect cannot be established by equality. **Uncertain** means the outcome was not established. Reading and reconciling that receipt is safer than assuming failure and sending the write again.

These are different operations: capturing evidence or updating a case writes Harbor's workflow storage; applying an administrative change calls IRIS. Harbor uses the signed-in account's native privileges for both source access and native administration.

## Implementation and limits

The React and TypeScript client talks to a same-origin Node.js gateway using an HttpOnly session cookie and CSRF protection. The gateway keeps credentials in an expiring in-memory session and calls a fixed IRIS upstream. Native administration uses SysAdmin API v2. A protected ObjectScript REST extension calls Embedded Python methods for telemetry and bounded log reading; it requires `%Admin_Operate:USE`.

Saved investigations and receipts are partitioned by account and stable instance identity. They are not shared team cases or a replacement for native security audit. Storage supports one gateway writer. Native administrators can still race a final configuration check: the API contract does not provide an atomic conditional write.

Captures and comparisons have explicit size and count bounds. Missing sources remain unknown, and a review conclusion remains an operator's assessment. The [operational guide](https://github.com/Igorandor/harbor/blob/main/docs/OPERATIONS.md) describes these limits and recovery procedures.

The September 27 checkpoint passed production builds and 312 Node tests. Verification includes synthetic security and failure scenarios, earlier native checks against IRIS Community, and desktop/mobile browser checks with their scope recorded separately. IRIS for Health and a complete external OAuth-provider integration remain unverified. See the [verification record](https://github.com/Igorandor/harbor/blob/main/docs/VERIFICATION.md) for the tested scenarios.
