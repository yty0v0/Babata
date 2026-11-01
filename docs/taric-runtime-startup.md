# Taric Docker runtime startup

When `tch.taric.enabled` is enabled, BreachWeave checks Taric prerequisites during daemon startup and starts its loopback read-board sidecar automatically unless `tch.taric.readBoard.enabled` is explicitly set to `false`.

The application does **not** install or start Docker Desktop/Engine, implicitly pull an image, create/replace a named volume, or fall back to local JSON for Taric-managed scopes. Docker Engine must be running before the application starts. The default authority image and named volume are `taric-p0:local` and `breachweave-taric-p0`; custom installations may configure `tch.taric.image`, `tch.taric.imageDigest`, and `tch.taric.volume`.

Startup checks Docker Engine, the configured image and digest policy, the persistent volume, and the Taric `audit.doctor` result. Taric health is reported as unavailable when a check fails, and read-board operations are blocked while the runtime is unhealthy. The sidecar listener is retained so diagnostics remain available; the daemon retries the bounded runtime check every 30 seconds and publishes recovery without replacing the listener or falling back to local JSON. The rest of the application remains available for diagnostics. Check `GET /api/taric/status` for the bounded `runtime` diagnostic.

## First-time setup

Build or install the expected image using the deployment's approved/pinned artifact. Then create the persistent volume once, or restore it from a trusted backup:

```powershell
docker volume create breachweave-taric-p0
```

The application intentionally does not create a missing authority volume because an incorrectly named empty volume could hide existing authority data. Do not remove or recreate the volume to address a startup error. Verify the configured volume name and recover/restore the original volume first. After Docker, image, and volume are available, restart BreachWeave; the checks run automatically. If Docker or Taric becomes available after BreachWeave has started, the runtime retry loop can recover the sidecar without a process restart.

## Docker unavailable

Start Docker Desktop/Engine using the host's normal service-management procedure, then restart BreachWeave. The application never requests elevated privileges to manage the Docker service.

## SQLite doctor volume access

The pinned Taric CLI opens SQLite and initializes its WAL/schema state before dispatching `audit.doctor`. Its existing authority volume must therefore be mounted read/write (`volume:/data`), just like normal Taric operations. A read-only mount (`volume:/data:ro`) fails during CLI startup and is reported as `configuration_invalid: invalid authority configuration`, even when the database and configuration are valid. Do not recreate the volume or reset the database to resolve this error. Read-board model permissions remain enforced by the Taric principal and operation allowlist.
