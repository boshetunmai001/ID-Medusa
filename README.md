# ID-Medusa

# Encvoy ID authentication for Medusa v2

Local integration prototype currently targets Medusa **2.22.2**, Node.js **22.23.3**, and the vendor-distributed Encvoy ID **3.6.19** images pinned by digest. Full live HTTP acceptance passed on Medusa 2.22.2 on 2026-11-02 using a cloned, isolated PostgreSQL test database. Browser-specific smoke checks on this dependency update remain pending. Nothing is published or deployed.

The Encvoy images are a separately distributed binary release. They are **not** a build of the pinned GitHub source commit `5579bf5c05464da48585be28a3863c915b9b704f`. That source commit has two compile defects; a local, uncommitted repair now builds backend and widget, but has not been runtime-tested. See [the image stand and current evidence](docs/encvoy-image.md) and the [acceptance record](docs/verification.md).

## Layout and versions

| Path | Purpose |
| --- | --- |
| `packages/auth-encvoy` | Reusable Medusa Auth Module Provider |
| `examples/medusa` | Backend, customer demo, Admin widget, account policy |
| `tests` | Protocol, security, and state-store checks |
| `infra` | Loopback PostgreSQL/Redis and pinned Encvoy image configuration |
| `AGENTS.md`, `llms.txt` | Quick project guidance for AI coding agents |
| `docs/article-oidc-login-medusa-v2.md` | Draft article for review before external publication |
| `docs/medusa-directory-listing.md` | Draft Medusa directory listing, pending npm release and approval |
| `research/encvoy-id` | Separate upstream source checkout; ignored by this project |
| `.local` | Private environment files, image layouts, runtime, and local state; ignored |

Pins: Node.js **22.23.3**, Medusa **2.22.2**, `openid-client` **6.8.8**, and the inspected Encvoy source commit above. The official Encvoy 3.6.19 front, backend, OIDC, and auth images and the PostgreSQL/Redis images are pinned to immutable digests in Compose. The image digests are not linked to the GitHub source commit.

## Set up the local stand

Prerequisites: Docker Compose, npm, `curl`, `shasum`, and `tar`. Work from this repository root. These commands create only local resources. If Node 22.23.3 is not already selected, install the private runtime and install the locked workspace dependencies:

```sh
npm install --prefix .local/runtime --save-exact node@22.23.3 --no-audit --no-fund
export PATH="$PWD/.local/runtime/node_modules/node/bin:$PATH"
node --version
npm ci --legacy-peer-deps --no-audit --no-fund
```

Create and start Medusa's loopback PostgreSQL and Redis:

```sh
node scripts/init-local.mjs
docker compose --env-file .local/infra.env -f infra/compose.yaml up -d --wait
```

Prepare and start the isolated Encvoy image stand, then provision its two confidential clients and synthetic identities:

```sh
node scripts/encvoy-image-env.mjs
```

On this Apple Silicon host, Docker could not fetch the pinned registry layers directly. Follow the verified `crane` download and checksum steps in [the Encvoy image setup guide](docs/encvoy-image.md), then run:

```sh
node scripts/encvoy-image-import.mjs
node scripts/encvoy-image-fixtures.mjs
node scripts/encvoy-image.mjs validate
node scripts/encvoy-image.mjs up-core
node scripts/encvoy-image.mjs status
node scripts/bootstrap-image-clients.mjs
```

Configure Medusa from the private client file created by that successful provisioning, apply its database migrations, build the Admin, and start the API:

```sh
node scripts/configure-medusa.mjs --clients .local/encvoy-image-clients.env
npm run build
node scripts/medusa.mjs db:migrate
node scripts/medusa.mjs build
node scripts/medusa.mjs develop --port 9000
```

Open these loopback addresses in a supported desktop browser. Use `localhost` consistently; `127.0.0.1` is a different browser origin.

- Customer demo: <http://localhost:9000/demo>
- Protected customer profile: <http://localhost:9000/demo/profile>
- Staff login: <http://localhost:9000/app/login>

The first run's root password is generated in `.local/encvoy-image.env` before Encvoy seeds its database. The generator preserves existing files. Changing a seed value after database initialization does not rotate the existing account. The bootstrap helper rotates the seeded Editor through its supported self-password API and creates the clients and fixtures; it writes no credentials to stdout.

Keep private values in the ignored `.local` files and generated `examples/medusa/.env`. In particular, `.local/encvoy-image-fixtures.env` contains test login names and passwords, `.local/encvoy-image-clients.env` contains client secrets and verified subjects, and `.local/infra.env` contains local infrastructure credentials. Do not paste these values into chat, shell history, logs, or tracked files. See [client registration](docs/registration.md) for exact settings.

Stop Medusa with Ctrl-C. Stop its infrastructure without deleting data with:

```sh
docker compose --env-file .local/infra.env -f infra/compose.yaml stop
```

Stop the Encvoy image containers while retaining their separate named volumes with:

```sh
node scripts/encvoy-image.mjs down
```

## Authorize a Medusa employee

Only a trusted server operator may bind an employee. Verify the Encvoy issuer and subject through trusted administration; email or domain matching is insufficient. The local acceptance run uses a synthetic employee that was explicitly pre-bound to a native Medusa user.

For a new synthetic employee, set `EMPLOYEE_EMAIL=employee@example.invalid` in the ignored `examples/medusa/.env`, then run:

```sh
node scripts/medusa.mjs exec ./src/scripts/create-employee.ts
```

The command prints the nonsecret Medusa user ID. Set `EMPLOYEE_MEDUSA_USER_ID` to that ID and `EMPLOYEE_ENCVOY_SUBJECT` to the subject verified in Encvoy in the same private file, then run:

```sh
node scripts/medusa.mjs exec ./src/scripts/allow-employee.ts
```

The binding command refuses to overwrite a different identity binding. No successful Encvoy login automatically creates a Medusa employee. The custom widget uses Medusa JWT mode; it does not call Medusa's Enterprise SSO provisioning route.

## Account and session behavior

Identity keys include verified issuer, subject, configured OIDC client, and Medusa actor type. Customer and employee providers are separate. Encvoy tokens are validated on the server and are never used as Medusa API credentials or persisted in AuthIdentity metadata.

First permitted customer login creates an AuthIdentity and then a customer through the native Medusa workflow. Repeat login returns that account. Any existing customer with the same normalized email, including a guest, produces `account_conflict`; the MVP does not merge or link accounts automatically. Contact the store administrator for ownership verification. There is no self-service linking interface.

Customer logout destroys the native Medusa session. Encvoy customer and employee JWT refresh is disabled; a customer JWT can establish a native session once. A copied JWT can still call protected routes until its 30-minute expiry, and logout does not end the Encvoy SSO session, so a later login may reuse it. See [the security model](docs/security.md).

## Verify

The real-image HTTP acceptance command is:

```sh
RUN_ENCVOY_ACCEPTANCE=1 .local/runtime/node_modules/node/bin/node scripts/check-live-login.mjs
```

The latest real HTTP acceptance run passed on 2026-11-02 against Encvoy 3.6.19 and Medusa 2.22.2 using an isolated clone of the synthetic PostgreSQL test database. It covered first and repeated customer login, concurrent completion, account conflicts, customer/Admin separation, pre-authorized and unbound employees, logout, refresh denial, one-time session establishment, state, cancellation, replay, browser-proof, and callback override checks. Safari customer and employee flows and Chrome customer sign-in/profile/logout/repeat-login were recorded before the Medusa 2.22.2 dependency update; fresh browser checks on the current dependency tree remain open. See the [full verification record](docs/verification.md).

Historical Chrome, Firefox, and Opera checks passed customer login, protected profile, logout, and repeat login on 2026-10-29. These checks exposed and fixed the demo's handling of an empty successful logout response. Browser evidence predates the current Medusa 2.22.2 dependency update; the current browser status is recorded in [verification](docs/verification.md).

Historical archive check (2026-10-30): `medusa-plugin-encvoy-id@0.1.0` installed in a fresh temporary project with Node.js 22.23.3 and Medusa 2.21.2 and completed synthetic customer login/profile/repeat-login. That run reused workspace dependencies through symlinks. It predates the current Medusa 2.22.2 package update; repeat the archive install with independently resolved dependencies before release. The latest recorded standard `npm test` run passed 29 tests against a temporary PostgreSQL cluster; current verification attempts are recorded in [docs/verification.md](docs/verification.md). The npm name has not been published or reserved. No push, paid service, or production deployment is part of the project.

## Troubleshooting

- **The login start request is rejected:** open the demo and Encvoy using the documented `localhost` origins. Do not mix `localhost` and `127.0.0.1`; the provider checks the exact browser origin.
- **The callback reports an expired login:** start again from the same browser tab. The five-minute state is one-time and bound to the HttpOnly browser-proof cookie; do not copy a callback URL into another browser or replay it.
- **The provider reports Encvoy unavailable:** check that all six local Encvoy services are healthy with `node scripts/encvoy-image.mjs status`, then check that Medusa's `.env` was generated from `.local/encvoy-image-clients.env` and uses issuer `http://localhost:9090`.
- **Customer completion reports an account conflict:** the email already belongs to a customer or guest. The example intentionally refuses automatic account linking; an administrator must verify ownership.
- **Staff login is denied:** only an existing Medusa user with an explicit binding to the verified Encvoy issuer and subject may enter Admin. Email address or domain does not grant access.
- **A browser-specific failure occurs:** record the browser name and version, operating system, exact step, and safe error code. Keep authorization codes, cookies, tokens, and credentials out of screenshots, logs, and reports. See the browser matrix and outstanding checks in [verification](docs/verification.md).

## Limits

This prototype has no store catalog, payments, shipping, SCIM, organizational sync, role mapping, global logout, or immediate cross-system revocation. It requires PostgreSQL for atomic state consumption and account locks. The example permits only the two Encvoy providers and blocks alternate customer registration paths. Adding another registration flow requires equivalent collision enforcement.

HTTP is allowed only through an explicit localhost development option. Production requires HTTPS, Secure cookies, exact allowed origins, protected secrets, and a separate operational review; do not reuse this local configuration for production.

## License

The project and provider package use the MIT License. See [LICENSE](LICENSE).
