# Contest coverage and submission preparation

## Developer Community article

The [Developer Community article](https://community.intersystems.com/post/investigating-iris-task-harbor) was published through the Community form on September 28, 2026. Its URL is attached to the Open Exchange application, and the description edits were sent for approval. [ARTICLE.md](ARTICLE.md) contains the source text. Final moderation and bonus decisions remain with the organizer.

Source: [contest announcement](https://community.intersystems.com/post/intersystems-programming-contest-build-your-own-management-portal), accessed September 26, 2026.

| Required area                 | Harbor implementation                                                         | Relevant APIs                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Web apps and REST exploration | Web applications, schema-driven REST explorer                                 | `/v2/web-app*`, read operations from the official specification                                               |
| Permission management         | Users, inherited roles, resource grants and resources                         | `/v2/security/user*`, `/role*`, `/resource*`                                                                  |
| Security and secrets          | Wallet, X.509, TLS, OAuth definitions, clients and secret updates             | `/v2/wallet/*`, `/v2/security/x509-*`, `/ssl-*`, `/oauth2/*`                                                  |
| Task management               | Definition editor, scheduling, controls, authoritative state and history      | `/v2/task*`                                                                                                   |
| OS management                 | Process controls, CPU/memory/disk, devices, database inspection               | `/v2/process*`, `/v2/device*`, `/v2/database*`, protected native telemetry extension                          |
| Logs                          | Messages, alerts, audit, task history, journal files and API console/activity | native log files through the extension, `/v2/security/audit/records`, `/v2/task/history`, `/v2/journal/files` |

The application includes English installation instructions and a written demonstration walkthrough. Original source code is MIT licensed and published at [Igorandor/harbor](https://github.com/Igorandor/harbor). The Open Exchange application was sent for approval with Submit to Contest selected on September 28, 2026 (Europe/Warsaw). The application is [published on Open Exchange](https://openexchange.intersystems.com/package/Harbor) and listed among the registered applications in contest 48. Later description updates may still await moderation.

## Technology bonuses

The [published technology bonus list](https://community.intersystems.com/post/technology-bonuses-intersystems-programming-contest-build-your-own-management-portal) was reviewed. Harbor uses Docker and Embedded Python for a concrete purpose: native host telemetry and bounded log reads.

The video is available through the link in [VIDEO.md](VIDEO.md). No bonus award is assumed. Online hosting, IPM publication, community ideas, first-time participation and reported vendor bugs are not claimed.

## Submission follow-up

1. Registration is visible on [contest 48](https://openexchange.intersystems.com/contest/48); check any subsequent moderator feedback.
2. Check subsequent Community moderator feedback; the article URL is already attached to the application.
3. Keep credentials and generated runtime data out of future commits.
4. Confirm awarded bonuses with the organizer; upload or submission alone does not establish an award.

### Suggested Open Exchange description

Harbor is an administration portal for InterSystems IRIS. Inspect tasks, logs, processes and application settings, then save diagnostic captures and notes in an investigation. Compare captures and link them to recorded administrative changes. Editors show the requested changes before applying them with the operator's IRIS permissions. The repository includes a Docker installation and an ObjectScript/Embedded Python extension for host telemetry and log reads.

## Current review status

See [the latest authorization and readiness review](CONTEST_SECURITY_REVIEW.md). The repository and Open Exchange application are public, and the application appears on the official contest list. Participant eligibility and organizer acceptance remain the organizer’s decision.

## Original idea and current walkthrough

The [original project idea](../IDEA.md) and the additional product-specific walkthrough in [README](../README.md) describe the application. The official [contest page](https://openexchange.intersystems.com/contest/48), read September 26, lists the submission deadline as September 27, 2026, 23:59 EST. It also identifies complexity, clarity of instructions, developer experience, applicability and usability as judging criteria. No acceptance or bonus award is implied.

## Video and online-demo preparation

The [video walkthrough](https://www.youtube.com/watch?v=TtJbHYvCNck) is published as unlisted with English captions and CC0 music; see [VIDEO.md](VIDEO.md). The owner chose to skip cloud hosting; see [ONLINE_DEMO.md](ONLINE_DEMO.md). Do not count a local video file or local server as an awarded bonus.
