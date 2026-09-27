# Deployment and security

## Trust boundaries

The portal is an administrative client. It forwards the signed-in operator's identity to a **fixed, administrator-configured IRIS server**. It cannot elevate that operator beyond IRIS permissions. Do not make a shared privileged account available to ordinary users.

- Passwords are kept in process memory for the session, never put into browser storage or logs by the gateway.
- Sessions use 256-bit random opaque identifiers in HttpOnly, SameSite=Strict cookies; 30-minute idle and 8-hour absolute expiry.
- Browser writes require a CSRF token and the configured `PUBLIC_ORIGIN`.
- Requests are limited to paths and parameters in the pinned API contract. Only an explicit list of administrative writes is allowed.
- Secret retrieval endpoints are blocked. Credential-bearing response fields are masked recursively. The wallet only exposes names and types.
- Request bodies are limited to 256 KB; list reads default to 250 rows and cap `maxRows` at 1,000. Upstream requests time out after 20 seconds; writes are never automatically retried.
- In-memory login throttling limits all sign-in attempts (successful and failed) to ten per minute per address. A restart clears sessions and throttling state.
- Portal activity is a bounded, session-local convenience history, not an immutable or durable security audit. Use the native IRIS audit subsystem for authoritative retention.
- Operational log text can contain application data. Pattern masking is best effort; do not assume arbitrary log messages are anonymized.

## Existing installations

Use HTTPS between the browser and gateway and between the gateway and a remote IRIS instance. Set `COOKIE_SECURE=true` and an exact HTTPS `PUBLIC_ORIGIN`. TLS certificate verification remains enabled; there is no insecure-TLS switch.

Bind the server on a private interface or place it behind a trusted reverse proxy. Do not expose the public quick-start credentials or bundled IRIS container. The gateway does not configure proxy trust; if HTTPS terminates at a proxy, pass `COOKIE_SECURE=true` explicitly and configure the exact public origin. Forwarding headers do not choose the upstream or override origin validation.

The `compose.gateway.yaml` configuration runs only Harbor against an existing instance. Set `HARBOR_MODE=deployment`, a stable `IRIS_INSTANCE_ID`, HTTPS `PUBLIC_ORIGIN`, and `COOKIE_SECURE=true`. Use HTTPS for `IRIS_URL`. If transport remains on a deliberately isolated private network, `ALLOW_PRIVATE_IRIS_HTTP=true` permits HTTP upstream explicitly; it does not create network isolation. Invalid origin, URL, cookie and port combinations stop startup.

```sh
IRIS_URL=https://iris.example.org \
IRIS_INSTANCE_ID=operations-primary \
PUBLIC_ORIGIN=https://harbor.example.org \
docker compose -f compose.gateway.yaml up -d --build
```

Configure the reverse proxy for `harbor.example.org` to forward to the loopback-bound gateway port. Supply a valid certificate and preserve the original Host/Origin behavior. Certificate issuance and reverse-proxy installation depend on the deployment and are not performed by this Compose file.

Credentials remain in memory because HTTP Basic authentication is used against IRIS. Restarting the gateway signs everyone out. This release supports a single gateway writer: sessions, dispatch locks and pending credential preparations are in process memory, while operational records use an atomic file store. Do not run multiple writers on the same data volume. A clustered deployment would require distributed session and dispatch coordination in addition to shared persistence.

## Extension

`Harbor.Rest` requires `%Admin_Operate:USE`, `%DB_IRISSYS:R` for its bundled `%SYS` namespace, and password authentication. These permissions are assigned by an administrator, not by the installer. It does not grant application roles. Embedded Python reads `/proc` on Linux and disk usage for the IRIS manager directory. In a container, host CPU and memory numbers may describe the container host, not cgroup quotas; the UI labels this scope.

Legacy diagnostic log reads use a fixed allowlist (`messages.log`, `alerts.log`), a maximum 1 MB tail and a maximum 500 lines. The Log files browser uses bounded 256 KiB windows, signed owner/instance/file-bound cursors and up to 500 lines. No caller-supplied filesystem paths, shell commands or arbitrary SQL are accepted. Missing log files return an explicit source notice. Non-Linux environments retain native API functionality and disk telemetry; Linux-specific metrics are described as unavailable.

## Operations

Back up the IRIS data volume with an IRIS-supported backup procedure. Replacing the portal container does not change IRIS records. Replacing the IRIS image may require a supported IRIS upgrade path; pin and test upgrades. `docker compose down` keeps named volumes. Removing a volume destroys its stored data.

Back up `HARBOR_DATA_DIR` separately while the gateway is stopped. It contains investigations, profiles, evidence decisions and change receipts partitioned by native account and stable instance ID. Stored operational data is not encrypted by Harbor; use appropriate filesystem/volume protection. Each record is capped at 4 MB and each collection at 500 records per partition. Reads reject symbolic links and oversized records and listing projects summaries one record at a time. Fresh native privileges are checked before returning stored evidence. See [operational bounds and recovery](OPERATIONS.md).

`GET /api/health` reports gateway process availability, not successful IRIS authentication. The UI's refresh timestamps and individual API errors describe upstream availability. Use an authenticated external health probe if you need end-to-end monitoring.

## Diagnostic and history bounds

Known authentication echoes are masked in normal and asynchronous diagnostics. Masking is a single literal pass; canonical identifiers remain unchanged. Credential-bearing submissions allow at most 128 values and 32,768 combined characters. Requests exceeding those limits are rejected before forwarding. Session history keeps a console preview of at most 100 lines plus a truncation notice and 16 KiB of serialized UTF-8 console data per entry; the directly requested native response retains its separate response limit. See [the focused security review](SECURITY_REVIEW.md).
