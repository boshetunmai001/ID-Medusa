# Encvoy ID authentication for Medusa v2

Local integration prototype using Medusa **2.21.2**, Node.js **22.23.3**, and the vendor-distributed Encvoy ID **3.6.19** images pinned by digest. Real Encvoy authentication has passed the local HTTP acceptance run. Safari customer login, profile, logout, SSO reuse, and pre-authorized employee Admin login have also passed. Nothing is published or deployed.

The Encvoy images are a separately distributed binary release. They are **not** a build of the pinned GitHub source commit `5579bf5c05464da48585be28a3863c915b9b704f`, whose backend and widget source builds remain blocked by upstream compile errors. See [the image stand and current evidence](docs/encvoy-image.md) and the [acceptance record](docs/verification.md).

## Layout and versions

| Path | Purpose |
| --- | --- |
| `packages/auth-encvoy` | Reusable Medusa Auth Module Provider |
| `examples/medusa` | Backend, customer demo, Admin widget, account policy |
| `tests` | Protocol, security, and state-store checks |
| `infra` | Loopback PostgreSQL/Redis and pinned Encvoy image configuration |
| `research/encvoy-id` | Separate upstream source checkout; ignored by this project |
| `.local` | Private environment files, image layouts, runtime, and local state; ignored |

Pins: Node.js **22.23.3**, Medusa **2.21.2**, `openid-client` **6.8.8**, and the inspected Encvoy source commit above. The official Encvoy 3.6.19 front, backend, OIDC, and auth images and the PostgreSQL/Redis images are pinned to immutable digests in Compose. The image digests are not linked to the GitHub source commit.

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

Open these loopback addresses in Safari:

- Customer demo: <http://localhost:9000/demo>
- Protected customer profile: <http://localhost:9000/demo/profile>
- Staff login: <http://localhost:9000/app/login>

Use `localhost` consistently; `127.0.0.1` is a different browser origin. The first run's root password is generated in `.local/encvoy-image.env` before Encvoy seeds its database. The generator preserves existing files. Changing a seed value after database initialization does not rotate the existing account. The bootstrap helper rotates the seeded Editor through its supported self-password API and creates the clients and fixtures; it writes no credentials to stdout.

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

Customer logout destroys the native Medusa session. Staff logout clears the Admin SDK's stored Medusa token. A previously copied JWT can remain usable until expiry; the acceptance run confirmed that a retained JWT still refreshes after local session logout because refresh does not consult Encvoy. Neither logout ends the Encvoy SSO session, so a later login may reuse it. See [the security model](docs/security.md).

## Verify

The real-image HTTP acceptance command is:

```sh
RUN_ENCVOY_ACCEPTANCE=1 .local/runtime/node_modules/node/bin/node scripts/check-live-login.mjs
```

The latest real HTTP run passed first and repeated customer login, concurrent customer completion, account-conflict refusal, customer/admin separation, explicit employee access, unbound-user denial, logout invalidation, and state, cancellation, replay, browser-proof, and callback override checks. Retained native JWT refresh also passed and is documented as a revocation limitation. Safari customer login/logout and employee Admin login passed. See the [full verification record](docs/verification.md).

The latest regressions passed: 23 protocol/unit tests, two Admin browser-request tests, and two real PostgreSQL tests. Typechecks, provider and full Medusa/Admin builds, and the package dry-run also passed. Bootstrap recovered a missing Editor rotation marker and employee subject while preserving existing credentials; the fixture helper preserved passwords and private file permissions. The package remains workspace-local: no npm publication, push, paid service, or production deployment is part of the project.

## Limits

This prototype has no store catalog, payments, shipping, SCIM, organizational sync, role mapping, global logout, or immediate cross-system revocation. It requires PostgreSQL for atomic state consumption and account locks. The example permits only the two Encvoy providers and blocks alternate customer registration paths. Adding another registration flow requires equivalent collision enforcement.

HTTP is allowed only through an explicit localhost development option. Production requires HTTPS, Secure cookies, exact allowed origins, protected secrets, and a separate operational review; do not reuse this local configuration for production.
