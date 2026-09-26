# Contest coverage and submission preparation

Source: [contest announcement](https://community.intersystems.com/post/intersystems-programming-contest-build-your-own-management-portal), accessed September 26, 2026.

| Required area                 | Harbor implementation                                                         | Relevant APIs                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Web apps and REST exploration | Web applications, schema-driven REST explorer                                 | `/v2/web-app*`, read operations from the official specification                                               |
| Permission management         | Users, inherited roles, resource grants and resources                         | `/v2/security/user*`, `/role*`, `/resource*`                                                                  |
| Security and secrets          | Wallet, X.509, TLS, OAuth definitions, clients and secret updates             | `/v2/wallet/*`, `/v2/security/x509-*`, `/ssl-*`, `/oauth2/*`                                                  |
| Task management               | Definition editor, scheduling, controls, authoritative state and history      | `/v2/task*`                                                                                                   |
| OS management                 | Process controls, CPU/memory/disk, devices, database inspection               | `/v2/process*`, `/v2/device*`, `/v2/database*`, protected native telemetry extension                          |
| Logs                          | Messages, alerts, audit, task history, journal files and API console/activity | native log files through the extension, `/v2/security/audit/records`, `/v2/task/history`, `/v2/journal/files` |

The application includes English installation instructions and a written demonstration walkthrough. Original source code is MIT licensed and ready for a public GitHub/GitLab repository. This local preparation does not constitute publication or submission to Open Exchange.

## Technology bonuses

The [published technology bonus list](https://community.intersystems.com/post/technology-bonuses-intersystems-programming-contest-build-your-own-management-portal) was reviewed. Harbor uses Docker and Embedded Python for a concrete purpose: native host telemetry and bounded log reads. It does not add vector search or an AI dependency merely to accumulate points.

No claim is made for online hosting, published IPM packages, community ideas, articles, YouTube videos, first-time participation or reported vendor bugs. These require separate completed actions or eligibility checks.

## Before publishing

1. Choose the public repository and push this directory as its root.
2. Keep `.env`, test credentials for non-demo systems and generated runtime data out of the repository.
3. Add the real author's Developer Community profile to the Open Exchange submission. If submitted as a team, add all team members' profile links to the README.
4. Use the description below and the README walkthrough for the application listing.
5. Review the [general terms](https://openexchange.intersystems.com/markdown?url=/assets/doc/contest-terms.md), publish the application on Open Exchange, then apply to the contest using the [submission guide](https://docs.openexchange.intersystems.com/contest/apply/). The announcement states a submission deadline of **September 27, 2026, 23:59 EST**; verify the current deadline in the organizer's interface.

### Suggested Open Exchange description

Harbor is a focused administration workspace for InterSystems IRIS. It brings web applications, permissions, wallet secrets, X.509/TLS/OAuth configuration, scheduled tasks, host resources and operational logs into a consistent React interface. A same-origin Node gateway preserves the operator's IRIS privileges; reviewable changes, typed confirmations and conflict checks support everyday administration. The included Docker stack and protected Embedded Python extension provide a reproducible local installation with real telemetry and log data.

## Current review status

See [the latest authorization and readiness review](CONTEST_SECURITY_REVIEW.md). Public repository publication, the Open Exchange listing, participant eligibility and organizer acceptance remain unconfirmed. The sibling projects currently reuse the Harbor administration foundation; this must be disclosed and is not a guarantee of separate acceptance. A requirement to remove that reused implementation is under review with the project owner.
