# ID-Medusa

# Encvoy ID authentication for Medusa v2

Local integration prototype currently targets Medusa **2.22.2**, Node.js **22.23.5**, and vendor-distributed Encvoy ID **3.6.19** images pinned by digest. The three-page assignment PDF available with the handoff specifies Encvoy images based on 1.2; the reviewer's note refers to a different edition naming 3.6.19, whose file was not available for comparison. Our runtime checks use vendor 3.6.19 images and do not claim to verify 1.2 images or build those images from the separate 1.2.0 source snapshot. See the [version reconciliation](docs/FINAL_CHECKLIST_RU.md). Encvoy's local database runs PostgreSQL **16.16**. Final local npm archive D (`dfbffc85…`, 14,891 bytes) passed independent clean-consumer install, dependency audit, typecheck, production build, and the full scripted live HTTP suite, including immediate employee JWT revocation, on 2026-11-16. Chrome 157.0.8103.51 and Safari 18.6 on archive D passed customer login/profile/logout/repeat-login and employee login/Admin Orders/logout in a clean consumer. See the [verification record](docs/verification.md). Nothing is published or deployed.

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

Pins: Node.js **22.23.5**, Medusa **2.22.2**, `openid-client` **6.8.8**, and the inspected Encvoy source commit above. The official Encvoy 3.6.19 front, backend, OIDC, and auth images and the PostgreSQL/Redis images are pinned to immutable digests in Compose. The image digests are not linked to the GitHub source commit.

## Set up the local stand

On Windows x64, use PowerShell and Docker Desktop with Linux containers enabled. The setup commands below include PowerShell equivalents. Install PostgreSQL so its server tools (`initdb`, `postgres`, `pg_ctl`, `createdb`, and `pg_isready`) are available on `PATH` before running `npm test`. WSL 2 remains an alternative environment.

Prerequisites: Git, Docker Desktop / Compose, npm, tar, and the PostgreSQL server tools for tests. Work from this repository root. These commands create only local resources. If Node 22.23.5 is not already selected, install the private runtime and locked workspace dependencies.

In PowerShell:

```powershell
npm install --prefix .local/runtime --save-exact node@22.23.5 --no-audit --no-fund
$env:PATH = "$PWD\.local\runtime\node_modules\node\bin;$env:PATH"
node --version
npm ci --legacy-peer-deps --no-audit --no-fund
```

In macOS Terminal:

```sh
npm install --prefix .local/runtime --save-exact node@22.23.5 --no-audit --no-fund
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
npm run typecheck
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

For immediate offboarding, first block the employee in Encvoy, then set the verified `EMPLOYEE_MEDUSA_USER_ID` in `examples/medusa/.env` and run:

```sh
node scripts/medusa.mjs exec ./src/scripts/revoke-employee.ts
```

This revokes all currently active Encvoy employee grants for that Medusa user. Each protected Admin API request checks the shared PostgreSQL registry without a positive cache, so copied Encvoy employee JWTs are denied on their next request. Blocking the Encvoy account alone does not revoke an existing Medusa JWT/grant. This command does not end Encvoy SSO or delete the Medusa identity binding; remove/disable that binding through trusted administration if future login must also be prevented. The registry is checked fail-closed; a database outage can make Encvoy Admin API requests unavailable. Customer tokens and other authentication providers are unaffected.

## Account and session behavior

Identity keys include verified issuer, subject, configured OIDC client, and Medusa actor type. Customer and employee providers are separate. Encvoy tokens are validated on the server and are never used as Medusa API credentials or persisted in AuthIdentity metadata.

First permitted customer login creates an AuthIdentity and then a customer through the native Medusa workflow. Repeat login returns that account. Any existing customer with the same normalized email, including a guest, produces `account_conflict`; the MVP does not merge or link accounts automatically. Contact the store administrator for ownership verification. There is no self-service linking interface.

In this example the Medusa session cookie and JWT expire after 30 minutes; JWT refresh is disabled for both Encvoy providers. Customer logout destroys the native Medusa session and clears its cookie, but a copied customer bearer JWT can still access routes that accept it until its `exp` (at most 30 minutes after issue). Admin logout only clears that browser's local JWT storage; if copied, an employee JWT can still access protected Admin APIs until expiry unless its server-side grant is revoked. Blocking an employee in Encvoy prevents future authentication once enforced, but does not revoke an existing Medusa JWT/grant. For immediate employee offboarding, block the Encvoy account and run the revocation command above: the next protected Admin API request using a revoked JWT is denied. A later Encvoy login may reuse the SSO session if Encvoy still allows it and the Medusa identity binding remains. Neither local logout ends the Encvoy SSO session; a repeat login may not ask for a password. SSO lifetime is controlled by Encvoy. See [the security model](docs/security.md).

## Verify

The real-image HTTP acceptance command is:

```sh
RUN_ENCVOY_ACCEPTANCE=1 .local/runtime/node_modules/node/bin/node scripts/check-live-login.mjs
```

The final local archive D `medusa-plugin-encvoy-id@0.1.0` (14,891 bytes; SHA-1 `dfbffc858341a000f676acecdcfaf61ce373ae35`) was installed from its tarball in an independent clean Medusa 2.22.2 consumer with no workspace links. `npm ci`, full and production dependency audits, `npm ls`, typecheck, production Backend/Admin build, and full live HTTP acceptance passed on 2026-11-16 against Encvoy 3.6.19 and an isolated synthetic database. HTTP scenarios included customer login/profile/repeat/logout, refusal to create a session before the customer link exists, callback and browser-proof protections, unbound employee denial, existing-account conflict, and immediate employee-grant revocation. Chrome 157.0.8103.51 and Safari 18.6 on D passed customer login/profile/logout/repeat-login and pre-authorized employee login/Admin Orders/logout. Safari route protection redirected Orders to login after logout. Archive D has not been published; published-version installation remains a later check. See the [full verification record](docs/verification.md).

The 2026-10-29 Chrome, Firefox, and Opera checks are historical and helped fix handling of an empty successful logout response. The required Chrome and Safari customer and employee flows were subsequently completed on final archive D in a clean Medusa 2.22.2 consumer on 2026-11-16. The exact browser versions, scenarios, and evidence boundaries are in [verification](docs/verification.md).

The clean consumer dependency audit without overrides reported 83 findings (14 high, 65 moderate, 4 low). Six documented Medusa overrides reduced this to six Low nodes on one SendGrid/deepmerge path; a seventh override to `deepmerge@4.1.2` now places it below the GHSA affected range, and independent full and production audits return zero findings. This pin is below `@sendgrid/helpers`' declared range and was checked with a clean install, `npm ls`, typecheck, production build, and SendGrid merge smoke check. See the [applicability analysis](docs/security.md). npm resolves overrides only from the consumer's root `package.json`, so the [consumer integration guide](docs/consumer-integration.md) includes the complete set and application wiring. The final workspace suite passed 33/33 on Node.js 22.23.5; see [verification](docs/verification.md). The npm package remains unpublished; installation of the eventual published version is still pending.

## Troubleshooting

- **The login start request is rejected:** open the demo and Encvoy using the documented `localhost` origins. Do not mix `localhost` and `127.0.0.1`; the provider checks the exact browser origin.
- **The callback reports an expired login:** start again from the same browser tab. The five-minute state is one-time and bound to the HttpOnly browser-proof cookie; do not copy a callback URL into another browser or replay it.
- **The provider reports Encvoy unavailable:** check that all six local Encvoy services are healthy with `node scripts/encvoy-image.mjs status`, then check that Medusa's `.env` was generated from `.local/encvoy-image-clients.env` and uses issuer `http://localhost:9090`.
- **Customer completion reports an account conflict:** the email already belongs to a customer or guest. The example intentionally refuses automatic account linking; an administrator must verify ownership.
- **Staff login is denied:** only an existing Medusa user with an explicit binding to the verified Encvoy issuer and subject may enter Admin. Email address or domain does not grant access.
- **A browser-specific failure occurs:** record the browser name and version, operating system, exact step, and safe error code. Keep authorization codes, cookies, tokens, and credentials out of screenshots, logs, and reports. See the browser matrix and outstanding checks in [verification](docs/verification.md).

## Limits

This prototype has no store catalog, payments, shipping, SCIM, organizational sync, role mapping, or global logout. Immediate employee JWT revocation is implemented through a PostgreSQL grant registry checked on protected Admin API requests. It requires PostgreSQL for atomic state consumption, account locks, and revocation checks. The example permits only the two Encvoy providers and blocks alternate customer registration paths. Adding another registration flow requires equivalent collision enforcement.

HTTP is allowed only through an explicit localhost development option. Production requires HTTPS, Secure cookies, exact allowed origins, protected secrets, and a separate operational review; do not reuse this local configuration for production.

## License

The project and provider package use the MIT License. See [LICENSE](LICENSE).
