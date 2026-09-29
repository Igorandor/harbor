# Install Harbor with IPM

The package installs the production web interface, a bundled Node gateway with its dependencies, and native classes for telemetry, current logs and the bounded rotated-log reader. Node.js 22.12 or newer remains a prerequisite. No npm installation or build tools are needed on the target host.

## Before installing

Use IRIS 2026.2 or newer with Embedded Python, IPM and the SysAdmin v2 API available. An administrator must be able to install classes and register `/api/harbor`. Enable `/api/admin` with password authentication according to your installation policy. The package creates no accounts, passwords, roles, grants or sample tasks.

Choose an existing writable data directory outside both the IPM module cache and `lib/harbor`. Run the gateway as an unprivileged OS account with access to that directory. Keep a stable `IRIS_INSTANCE_ID`: existing records are scoped by this identifier and the signed-in IRIS account.

## Install

In an IRIS terminal, use the namespace intended to own the extension; `%SYS` is recommended for an existing installation:

```objectscript
zn "%SYS"
zpm "install harbor"
```

Version 1.1.0 is published in the community registry. Installation with `zpm "install harbor"` was verified on September 29, 2026. The release archive and source installation below also support offline deployment. Contest bonus awards remain the organizer's decision.

For an offline installation, download `harbor-1.1.0.tgz` from the [1.1.0 release](https://github.com/Igorandor/harbor/releases/tag/v1.1.0), transfer it to the IRIS host and use:

```objectscript
zn "%SYS"
zpm "load /path/to/harbor-1.1.0.tgz"
```

Clients without archive loading can extract it and load the directory containing `module.xml`. A source checkout with the committed payload can be loaded with `zpm "load /path/to/harbor"`.

IPM prints the deployed paths. The standard Linux path is `/usr/irissys/lib/harbor/1.1.0/`. The extension route uses password authentication and `%Admin_Operate` protection. Installation refuses an existing route assigned to another dispatch class or namespace. Use the original namespace for upgrades; do not install this instance-wide route twice.

## Start the gateway

Create a separate environment file, for example `/etc/harbor/harbor.env`. This example keeps the browser and upstream traffic on loopback on the IRIS host:

```dotenv
IRIS_URL=http://127.0.0.1:52773
IRIS_INSTANCE_ID=harbor-production
HARBOR_DATA_DIR=/var/lib/harbor/records
PUBLIC_ORIGIN=http://localhost:3100
COOKIE_SECURE=false
HOST=127.0.0.1
PORT=3100
HARBOR_MODE=evaluation
```

Create the data directory before starting. The launcher resolves symlinks and rejects relative paths or locations inside the installed package tree. Do not store credentials in this file; operators sign in with their own IRIS credentials.

For remote access, use an HTTPS reverse proxy and an exact HTTPS `PUBLIC_ORIGIN` with `COOKIE_SECURE=true`. Keep the gateway listener private. For remote deployment, also set `HARBOR_MODE=deployment`; use an HTTPS upstream, or explicitly set `ALLOW_PRIVATE_IRIS_HTTP=true` only for a trusted private IRIS network. See [deployment requirements](DEPLOYMENT.md).

Run as the unprivileged account:

```sh
node --env-file=/etc/harbor/harbor.env /usr/irissys/lib/harbor/1.1.0/start.mjs
```

Open the configured origin, sign in and verify the instance identity. Then create an investigation and save a note. Restart the gateway, sign in with the same account and reopen the saved investigation. Follow the [Harbor walkthrough](FIRST_INVESTIGATION.md) for the full workflow. `/api/health` reports gateway availability; it does not verify native access.

Use Ctrl+C to stop the foreground command. For ongoing operation, put the same command under your service manager with the external environment file and data directory. IPM does not create a system service or change firewall rules. Run one gateway process per data directory.

## Upgrade and removal

1. Stop the gateway and back up its external data directory. Do not reset IRIS or delete existing volumes.
2. Install the new package version in the original namespace. Update the service command to its versioned gateway directory.
3. Preserve the data path, `IRIS_INSTANCE_ID` and operator account. Restart, sign in again and reopen a retained record. In-memory sessions and prepared requests do not survive a restart.

To remove the package, stop the gateway and run `zpm "uninstall harbor"` in its installation namespace. IPM removes registered classes, the extension route and packaged files. The separate data directory and environment file remain yours to retain or back up. Do not uninstall an extension still used by another gateway; plan the ownership migration first.

## Rebuild and test a package

Run `npm ci`, `npm run build:ipm`, `npm test` and `npm run test:ipm`. Commit the generated `ipm/harbor-gateway` payload with source changes. It includes dependency licenses and a SHA-256 inventory; CI checks that rebuilding leaves the payload unchanged. Do not commit credentials or saved operational records.

On a disposable IRIS instance, load the source, then export:

```objectscript
zpm "package harbor -path /tmp/harbor-package/"
```

Test the exported archive before publishing. Check native login and extension reads, retained records across restart/reinstallation, and refusal of a conflicting extension route. Installation is separate from starting and supervising the Node gateway.

## Verification of 1.1.0

On an isolated IRIS Community 2026.2 build 221U instance with IPM 0.10.8, source installation in `%SYS` and archive installation in `USER` succeeded. Native login, extension reads and a retained investigation with a diagnostic capture worked through the installed gateway. Uninstall removed its route and gateway files while preserving the external record byte-for-byte; reinstall reopened that record. A route owned by another dispatch class was refused without replacing it. Package resource names are specific to this application so other packages can coexist in the namespace.

The source suite passed 341 tests. Two packaging tests cover the payload inventory, resource names, copied-runtime startup, origin/session refusals, required configuration and unsafe data paths.

Public registry installation was subsequently tested in `%SYS` after uninstalling the isolated archive installation. The downloaded payload matched every release inventory hash; native login, extension reads and reopening the saved record passed, with the external record unchanged. The packaged frontend was also checked at desktop and 390px widths.
