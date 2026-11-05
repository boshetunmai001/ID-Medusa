# Local Encvoy image stand

This stand runs the vendor-distributed Encvoy ID images as a separate local test system. The images currently resolve to release tag `3.6.19`; every application image is pinned below to its verified immutable digest and forced to `linux/amd64`.

This is an exploratory compatibility stand, not a binary build of the GitHub source pinned at `5579bf5c05464da48585be28a3863c915b9b704f`. The published image manifests do not carry an OCI source or revision label that ties them to that commit. The installer/configuration documentation used to identify the official image distribution is from GitLab commit `f84b0501f7d49379b4afea67d2ba5703575b934d`.

The application images are:

| Service | Upstream immutable reference | Selected `linux/amd64` manifest | Image config digest |
| --- | --- | --- | --- |
| Frontend | `registry.digtlab.ru/trusted/id@sha256:0a7561599cca99402f4291844a14a3ab79201677c734f142cd04b2fef55d0120` | `sha256:0a7561599cca99402f4291844a14a3ab79201677c734f142cd04b2fef55d0120` | `sha256:fc28c5900e3a013bca34d2363ee06e785a0a49db8caba85998705dffb1a83b7f` |
| Backend | `registry.digtlab.ru/trusted/id@sha256:ebb2bc0732550692f6126bf4a46871c2f054fe72d54a885d4f9e5eaa56b06069` | `sha256:ebb2bc0732550692f6126bf4a46871c2f054fe72d54a885d4f9e5eaa56b06069` | `sha256:54314f79ece087309f1b2da18cb93e5e315a432240d298c9bd659da39cf6de9c` |
| OIDC | `registry.digtlab.ru/trusted/id@sha256:ce8fcf7751ac5d4f6fca780921454062b9b13ca3ecdb91134183eb0fecdf9138` | `sha256:ce8fcf7751ac5d4f6fca780921454062b9b13ca3ecdb91134183eb0fecdf9138` | `sha256:c7a411354c9f3876bd74fe254523b692422388c7c8b6c0196747b6522b134277` |
| Auth | `registry.digtlab.ru/trusted/id@sha256:11b365e5235b5feb6f5167eb7872283d6e4a4fb660294bd9ea3add84ba2e47a9` | `sha256:11b365e5235b5feb6f5167eb7872283d6e4a4fb660294bd9ea3add84ba2e47a9` | `sha256:4fb8c462b0dc81ebfccaba0a8edeec691f0eddfe659239a29a3840baaee6a700` |
| PostgreSQL 14.4 | `postgres:14.4@sha256:9ceb24f8c5f15c053d973a3610866f473690875dc13eb3282b45302189321040` | `sha256:cf3b0cf1dde2a82542e4b9de7f3ad058fdc819dea6499007035b838542b0bd5e` | `sha256:e09e90144645e02137d087f0dc059f4d2e3c6356ef8f9e40eeb15d1c901dbc73` |
| Redis 7 Alpine | `redis:7-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499` | `sha256:ca0acbb137c1dc3339c8b147a58fd6f42775d4599327b50e7b116c23de501af2` | `sha256:f84b0c4678011602b9b98c227a4dcd5468bf8b088b02fdd4165cb7758bad8058` |

All six images are pinned to `linux/amd64` for consistent runtime selection on this Apple Silicon host.

## Current runtime status

The six pinned `linux/amd64` images were fetched with the host-side `crane` client, imported into Docker, and verified against their OCI manifests, configs, compressed layers, and imported rootfs diff IDs. The local Compose override uses the resulting Docker image IDs with `pull_policy: never`; the tracked Compose file still names the immutable upstream references.

All six services reported healthy after enabling the shared network namespace. Discovery at `http://localhost:9090/.well-known/openid-configuration` returns issuer `http://localhost:9090`; its advertised authorization, token, userinfo, and JWKS URLs use that same origin. Metadata advertises RS256 ID tokens, S256 PKCE, and `client_secret_basic`; JWKS returns one RS256 signing key. The real Encvoy OIDC login, signed-token exchange, and Medusa HTTP acceptance flow have also passed; the exact scenarios are listed in [verification](verification.md).

The verified acceptance environment uses a fresh Encvoy database named `encvoy_image_secure_seed` and the separate Redis volume `redis-secure-seed`, selected with `ENCVOY_REDIS_VOLUME`. The earlier `encvoy_image` database remains in its original database volume; its private environment files were preserved under `.local/before-secure-seed`. The random root password was configured before the fresh database's initial seed, then verified against the seeded Prisma bcrypt hash without printing it. The Editor account password was rotated through its supported self-password API and re-authenticated. Bootstrap verified all three synthetic user subjects through real signed built-in OIDC logins, and registered both confidential Medusa clients.

The vendor front image's stock Nginx config serves static assets only. The local config in `infra/encvoy-image-nginx.conf` follows the official installer routes from GitLab commit `f84b0501f7d49379b4afea67d2ba5703575b934d` and supplies the loopback reverse proxy: `/.well-known` and `/oidc` reach the OIDC service, `/api/oidc` rewrites to the OIDC mount, `/interaction/*` rewrites to backend `/api/interaction/*`, `/auth` reaches auth, and `/api`, `/public`, `/widget`, and `/docs` reach backend. The backend, OIDC, auth, and Nginx containers share the frontend's network namespace. This lets vendor services reach the canonical `DOMAIN` URL at `localhost:9090`, while Nginx forwards internally to ports 3005, 3003, and 3007. Only `127.0.0.1:9090` is published on the host. The proxy fixes forwarded host, scheme, and port to the canonical local origin. The front container copies a generated config containing the public built-in client ID into its static webroot at startup; no client secret is sent to the frontend.

The published image manifests do not carry an OCI source or revision label linking them to GitHub source commit `5579bf5c05464da48585be28a3863c915b9b704f`. This is verified compatibility with the vendor-distributed image release identified as `3.6.19`, not a binary build of that source checkout. The pinned source checkout still fails its backend and widget builds; passing image tests do not imply that the GitHub source can build or that other releases behave the same.

## Start

From the repository root, create private local values:

```sh
node scripts/encvoy-image-env.mjs
```

On this Apple Silicon host, the Docker Engine could not fetch the exact registry layers directly. The repeatable host-side import script uses the official Google `crane` 0.22.1 Darwin arm64 release. Download its official release archive and extract the binary under `.local`:

```sh
mkdir -p .local/bin
curl -fL --max-time 60 -o .local/crane-0.22.1.tar.gz https://github.com/google/go-containerregistry/releases/download/v0.22.1/go-containerregistry_Darwin_arm64.tar.gz
shasum -a 256 .local/crane-0.22.1.tar.gz
tar -xOzf .local/crane-0.22.1.tar.gz crane > .local/bin/crane
chmod 755 .local/bin/crane
```

The expected SHA-256 for the official release archive is `2231fc8df8806d20d680ff1225db44e095a55dd6ac1ae8eced4faf4b278b78fb`, as listed in the release's [`checksums.txt`](https://github.com/google/go-containerregistry/releases/download/v0.22.1/checksums.txt). `scripts/encvoy-image-import.mjs` checks that archive checksum, verifies that the installed executable matches the archive member and reports version 0.22.1, then downloads missing OCI layouts through host-side `crane`. It verifies each manifest, config, compressed layer, platform, and imported rootfs diff ID before writing `.local/encvoy-image-local.override.yaml` and a private verification record. It does not modify the pinned image references in Compose.

On Windows x64, run these steps in PowerShell and use the official Windows x86_64 release archive. The import script selects the published checksum for `win32-x64`, verifies `crane.exe`, and rejects unsupported host architectures:

```powershell
New-Item -ItemType Directory -Force .local/bin | Out-Null
Invoke-WebRequest -Uri 'https://github.com/google/go-containerregistry/releases/download/v0.22.1/go-containerregistry_Windows_x86_64.tar.gz' -OutFile '.local/crane-0.22.1.tar.gz'
$expected = '0e073ea8192c3b8442ec8aaf44d53c1050a09084669fae3a6ceb0f2026cf8b21'
$actual = (Get-FileHash '.local/crane-0.22.1.tar.gz' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'crane archive checksum mismatch' }
tar.exe -xzf .local/crane-0.22.1.tar.gz -C .local/bin crane.exe
```

The expected SHA-256 is `0e073ea8192c3b8442ec8aaf44d53c1050a09084669fae3a6ceb0f2026cf8b21`, from the official release [`checksums.txt`](https://github.com/google/go-containerregistry/releases/download/v0.22.1/checksums.txt). Docker Desktop must be running with Linux containers enabled. The pinned Encvoy images target `linux/amd64`; Docker Desktop supplies the Linux container engine.

After importing the images, extract the initial Editor fixture from the verified pinned backend layer, then validate and start the isolated core:

```sh
node scripts/encvoy-image-import.mjs
node scripts/encvoy-image-fixtures.mjs
node scripts/encvoy-image.mjs validate
node scripts/encvoy-image.mjs up-core
node scripts/encvoy-image.mjs status
```

The fixture helper checks the exact backend manifest, layer digest, and source-file SHA-256 before writing the vendor Editor seed login/password and a random replacement into `.local/encvoy-image-fixtures.env`. It never prints those values. For a fresh private environment, the generator sets `ADMIN_LOGIN=local-root` and a random `ADMIN_PASSWORD` before the first database seed; the fixture's `ENCVOY_IMAGE_ADMIN_PASSWORD` contains that same value. These are seed inputs: changing them after initialization does not rotate the existing root account. The generator preserves existing service and fixture environment files, so a different root password requires a separately initialized database. The verified acceptance run used this separate fresh seed and preserved its prior database and environment. The first core start also starts the frontend first because the application containers share its network namespace; it applies the vendor image's Prisma migrations and publishes the web stand on loopback. Wait until all six services report healthy, then run the supported bootstrap helper:

```sh
node scripts/bootstrap-image-clients.mjs
```

The bootstrap helper verifies the seeded root password using the backend's Prisma bcrypt record, then uses the built-in public client for a signed authorization-code login. It rotates the seeded Editor password through the Editor's own supported password API, re-authenticates, and registers two confidential authorization-code clients. It creates three synthetic `.invalid` users, opts them into the email and name claims needed by Medusa through their profile API, then verifies their signed subjects and verified email. Client secrets, fixture subjects, and login/email values are written atomically to `.local/encvoy-image-clients.env` with mode `0600`; credentials and tokens are suppressed. Recovery intent is kept in `.local/encvoy-image-bootstrap.json`. This helper is specific to this isolated local stand; do not run it against another Encvoy environment.

The public local issuer and frontend origin is `http://localhost:9090`. The Medusa demo callbacks remain `http://localhost:9000/demo/callback` and `http://localhost:9000/app/login`. Backend, OIDC, and auth listen on internal ports 3005, 3003, and 3007 inside the shared frontend network namespace; those ports are not published on the host. PostgreSQL and Redis have no host port. The Compose project and volumes are named `medusa-encvoy-image` and remain separate from the source checkout's services and the Medusa database.

Every Encvoy container uses Docker's `none` logging driver. Raw service stdout/stderr, including any authorization codes or tokens, are intentionally unavailable through Docker logs. The frontend also loads `infra/encvoy-image-logging.conf`, which disables Nginx access logs and sends critical error logs to `/dev/null`, so callback query strings are not written to container files. The runner reports only container lifecycle/health state and whether a Compose action succeeded. No service output is written to host files.

The local environment uses an `.invalid` administrator email. The frontend receives `ID_HOST`, `DOMAIN`, and the public built-in `CLIENT_ID`; it does not receive `CLIENT_SECRET`, database credentials, or administrator/test passwords. The generated static config is staged under `.local` and copied into the frontend webroot by `infra/encvoy-image-front-config.sh`. The documented optional SMTP setting `EMAIL_PROVIDER` and analytics setting `GOOGLE_METRICA_ID` are left unset, so no SMTP provider or Google Analytics integration is configured. The backend's documented Winston settings default to disabled external export on a fresh database. Synthetic users use `.invalid` identities and are not connected to external identity providers.

The ignored private files are part of the local setup: `.local/encvoy-image.env` contains the Encvoy service settings and initial root seed credential; `.local/encvoy-image-fixtures.env` contains the Editor and synthetic fixture credentials; `.local/encvoy-image-clients.env` contains confidential client credentials and verified synthetic subjects; `.local/encvoy-image-bootstrap.json` records resumable provisioning intent; and `.local/encvoy-image-front.env` contains only the public front-end settings. `scripts/configure-medusa.mjs --clients ...` generates `examples/medusa/.env`, which also contains secrets and is ignored. Keep all these files local and mode-restricted. On the verified host, the previous private seed environment files are in `.local/before-secure-seed`; the earlier Encvoy database remains in its existing database volume.

## Local operations

```sh
node scripts/encvoy-image.mjs status
node scripts/encvoy-image.mjs down
```

The frontend binds only to `127.0.0.1:9090`; `up-core` starts it together with the backend, OIDC, auth, PostgreSQL, and Redis because the application services share its network namespace. `up-web` is an equivalent convenience command. Backend, OIDC, and auth ports are not published on the host; Postgres and Redis have no host port. `down` stops containers but retains the isolated named volumes. Every container uses Docker's `none` logging driver. Nginx access logging is disabled at both HTTP and server level, and critical error logs go to `/dev/null`, so callback query strings are not written to container files. Do not use `docker logs`; service stdout/stderr is intentionally unavailable. The runner reports only safe lifecycle and health status.

## Client and user provisioning

Use the vendor API exposed by this running release for test clients and identities. Do not assume the source checkout's API payloads match this release. The completed bootstrap registers two separate confidential clients with `client_secret_basic`, authorization-code-only grants, RS256 signing, exact callbacks, and public subjects. It creates three synthetic `.invalid` identities with separate login and email values, configures the verified email/name claims needed by Medusa, and verifies each signed subject. Client IDs, secrets, and user subjects stay in `.local/encvoy-image-clients.env`; fixture passwords remain in `.local/encvoy-image-fixtures.env`. Do not put generated values in docs, shell history, or logs.

If testing a different image release, repeat discovery, JWKS, registration, claim, and browser-sign-in checks against that release and record the actual response status and safe response shape. Do not patch the pinned GitHub source checkout to make it appear compatible with these images.
