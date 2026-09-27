# Online demonstration: optional, not published

No hosted instance is provided with this release. The application can be run independently using its README. Online hosting is optional and was not provisioned during preparation; no online-demo bonus is claimed.

## Try Harbor now

The independently runnable application is available through the [README quick start](../README.md). After starting its bundled Compose stack, open `http://localhost:3100` on that same computer. This is a local evaluation, not an online demonstration URL for Open Exchange.

The bundled account is publicly documented for local evaluation. Keep the quick-start ports bound to loopback. A tunnel or public port mapping would expose that account's native administration rights; it is not a substitute for preparing a separate demonstration environment.

## If online hosting is arranged later

1. Provision a separate, disposable IRIS instance with synthetic records only. Use a unique identity such as `harbor-demo`; do not reuse the current instance, its data, volumes or credentials.
2. Follow [deployment and security](DEPLOYMENT.md), install this project's authenticated IRIS extension, and create private evaluator accounts with the native permissions needed for the chosen walkthrough. Preserve normal IRIS authorization. Do not publish a shared SuperUser password.
3. Run this repository's `compose.gateway.yaml` gateway against that instance. Set an HTTPS `IRIS_URL`, stable `IRIS_INSTANCE_ID`, exact HTTPS `PUBLIC_ORIGIN`, `COOKIE_SECURE=true`, and a dedicated persistent `HARBOR_DATA_DIR`. Keep the gateway and native administration ports private. Use one writer for its data directory.
4. Put a TLS reverse proxy in front of the gateway and restrict access to the intended evaluators. For example, Caddy can manage a certificate when the domain resolves to the host and the required ports are reachable. Keep its certificate storage persistent. This repository does not provision hosting or a certificate. See [Caddy's HTTPS requirements](https://caddyserver.com/docs/automatic-https).
5. Test sign-in, the application's complete walkthrough, permission denial, sign-out and retained records from an external browser. Confirm the displayed instance is the disposable one and that native administration ports cannot be reached publicly.
6. Only then add the working HTTPS URL to the Open Exchange Demo URL field, arrange evaluator access privately, and ask the organizer to verify bonus eligibility. Keep the host available for judging; turn it off when evaluation ends.

A video or a locally running Compose stack does not itself create an online demo. Awarding a bonus remains the organizer's decision. See the [contest technology bonuses](https://community.intersystems.com/post/technology-bonuses-intersystems-programming-contest-build-your-own-management-portal).

