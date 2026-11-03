# Verification checklist and evidence

Keep protocol-fixture results separate from Encvoy acceptance. This page records the available local evidence; it does not certify another Encvoy release or a production deployment.

## Automated and local integration checks

Use Node 22.23.3 and PostgreSQL server tools (`initdb`, `postgres`, `pg_ctl`, `createdb`, and `pg_isready`) from the repository root:

```sh
npm run build
npm run typecheck
npm test
node scripts/medusa.mjs build
npm pack --workspace medusa-plugin-encvoy-id --dry-run
```

`npm test` runs the protocol, Admin-request, state-store, and PostgreSQL tests together. It initializes a temporary local PostgreSQL cluster under `/tmp`, listens only on a private Unix socket, runs the suite against synthetic test values, stops the server, and removes the data directory afterward. It does not use the Medusa development database or Docker. The runner handles normal completion, test failure, and interruption; if it cannot stop PostgreSQL safely, it leaves the temporary data directory for inspection instead of deleting a live cluster. The command fails rather than silently skipping the PostgreSQL checks if the PostgreSQL server tools are unavailable.

The protocol tests use a local OIDC fixture with signed tokens and controlled errors. They cover signature, issuer, audience, expiration, nonce, browser proof and state, replay, cancellation, discovery errors, employee allowlisting, and identity namespace separation. They do not exercise Encvoy.

For a separately managed PostgreSQL test target, the state tests can also be run explicitly:

```sh
RUN_POSTGRES_INTEGRATION=1 .local/runtime/node_modules/node/bin/node --env-file=.local/infra.env --import tsx --test tests/postgres-state.integration.test.ts
```

This direct mode writes a state table and synthetic rows, then removes its own rows. Never point it at a client or production database. It exercises context binding, expiry, one-time consumption under concurrent requests, and advisory-lock serialization using real PostgreSQL connections. The opt-in native Medusa harness also needs the local API running on port 9000 and writes then cleans synthetic Medusa records:

```sh
RUN_MEDUSA_INTEGRATION=1 .local/runtime/node_modules/node/bin/node scripts/medusa.mjs exec src/scripts/check-integration.ts
```

That harness uses Medusa's own JWT signing utility; it does not authenticate through Encvoy. On 2026-10-28, the standard `npm test` run passed all 27 tests, including both real PostgreSQL state tests, against a temporary PostgreSQL 14.19 cluster created under `/tmp` and removed after the run. No Medusa development database or Docker daemon was used. Earlier runs also passed provider/example typechecks, provider build, the full backend/Admin build, and the package dry-run.

On 2026-10-30, the updated `medusa-plugin-encvoy-id@0.1.0` tarball was installed in a fresh temporary project. The archive includes `LICENSE`; importing its default provider, `EncvoyAuthProvider`, `EncvoyStateStore`, and `entityId` exports succeeded under Node.js 22.23.3. A clean Medusa 2.21.2 server using the installed tarball then completed a real customer login through the pinned Encvoy 3.6.19 stand, created one customer and session in a temporary PostgreSQL 14.19 database, and returned that same customer from the protected profile. A second login reused the same customer. The state table was absent after initial server startup; the provider now initializes it idempotently before starting or consuming login state. This clean project reused the existing locked workspace dependencies through symlinks, so fresh online dependency resolution remains unverified. Installing the framework from scratch was previously blocked by npm's unresolved transitive `@aws-sdk/core@^3.978.7` version.

The live bootstrap recovery check removed the saved Editor rotation marker and employee subject, then successfully recovered them without changing existing client IDs, client secrets or fixture passwords. It verified the existing employee's signed identity before the recovery run. Re-running the fixture helper preserved passwords and mode 0600; captured output contained no fixture secrets.

The final scan compared 17 actual private values against 464 shareable files, including 358 compiled frontend assets, and found zero matches. The separate client-creation lost-response recovery branch was reviewed but has not received a runtime fault-injection test.

## Real Encvoy HTTP acceptance

The recorded run used the vendor-distributed Encvoy ID 3.6.19 images pinned by digest, Medusa 2.21.2, Node 22.23.3, the isolated local PostgreSQL/Redis services, and only synthetic `.invalid` identities. With both local systems running and Medusa configured from `.local/encvoy-image-clients.env`, run:

```sh
RUN_ENCVOY_ACCEPTANCE=1 .local/runtime/node_modules/node/bin/node scripts/check-live-login.mjs
```

The full script passed on 2026-10-28. It performs real Encvoy browser-protocol requests, exchanges signed ID tokens, and exercises the live Medusa HTTP API. It reuses the pre-existing synthetic `.invalid` fixtures in the isolated local databases. Evidence from the completed run:

On 2026-11-01, the first live rerun passed customer login and eight concurrent completions, cancellation/state consumption, cross-browser proof isolation, changed-state rejection, callback override rejection, replay denial, customer logout, and repeat customer login. It stopped at the pre-authorized employee callback with `not_authorized` (HTTP 401). Read-only inspection established that the Medusa API on port 9000 is connected to the temporary PostgreSQL cluster `/tmp/encvoy-medusa-pg-GYnuxH`, database `medusa_clean_final` on port 55439, not the `medusa` database in `examples/medusa/.env`. That isolated database had zero Medusa users and zero Encvoy user-provider bindings, so denial was the intended fail-closed behavior. After explicit approval, one synthetic employee and its previously verified Encvoy subject binding were provisioned in that temporary DB. One approved rerun then passed the complete script: customer login and eight concurrent completions, cancellation, cross-browser proof isolation, changed-state rejection, callback/return URL override rejection, replay denial, logout, repeat login, pre-authorized employee login and native Admin API, denial of an unbound Encvoy employee, and refusal to take over an existing guest. The conflict guest was unchanged; no unbound Medusa employee was created. Read-only post-run counts showed 2 customers (both `.invalid`), 1 employee (also `.invalid`), 1 active `encvoy-user` binding, and 0 unexpired OIDC state rows. These synthetic records remain in `medusa_clean_final`, which is a disposable local test DB. Encvoy remained the persistent local 3.6.19 stand at `localhost:9090`; its OIDC interactions/session records were generated by the synthetic login flows.

| Scenario | Result |
| --- | --- |
| First customer login and account completion | Pass; eight concurrent completion requests resolved to the same customer, and native Admin listed exactly one customer for the fixture email |
| Repeat customer login | Pass; returned the same customer |
| Provider cancellation and state consumption | Pass; cancellation created no session and replay was rejected |
| Changed state and another browser's proof cookie | Pass; rejected without taking ownership of the initiating browser's state |
| Callback and return URL overrides | Pass; unapproved URLs were rejected and callback state could not be reused |
| Callback replay and customer access to Admin API | Pass; replay failed and customer credentials were denied |
| Customer logout | Pass; profile access and the previous session cookie were rejected |
| Retained Medusa JWT after logout (historical 2.21.2 run) | Refresh succeeded; this behavior has since been disabled for both Encvoy providers |
| Pre-authorized employee login | Pass; the employee token accessed the native Admin API as the explicitly bound user |
| Unbound Encvoy user | Pass; employee login was denied and no Medusa user was created |
| Existing guest with the same email | Pass; account completion returned HTTP 422 with `duplicate_error` / `account_conflict`, and the guest record remained unchanged |

These checks do not establish immediate Encvoy logout or revocation. The script is HTTP-based and does not claim Safari coverage.

### Updated dependency and session policy run (2026-11-02)

The workspace was clean-installed with Medusa 2.22.2. The full `scripts/check-live-login.mjs` acceptance then passed against Encvoy 3.6.19 and a cloned database in the isolated PostgreSQL cluster `/tmp/encvoy-medusa-pg-GYnuxH` on port 55439. The clone was restored from a verified `pg_dump` archive of the synthetic `medusa_clean_final` database; all customer and employee emails use `.invalid` fixtures. It was the live server's only database target during the run.

The first run exposed a session-establishment bug: Medusa may issue an identical JWT when refreshing it, so consuming the token at refresh made the subsequent session request fail. The browser demo now establishes the native session directly from the callback JWT, customer and employee refresh are refused with `reauthentication_required`, and the customer JWT is atomically consumed only when establishing the session. The rerun passed customer and repeat login, eight concurrent customer completions, logout, old-cookie rejection, customer and employee refresh denial, pre-authorized staff API access, unbound employee denial, cancellation, changed-state and browser-proof checks, callback override/replay rejection, and guest conflict protection.

On the cleanly installed dependency tree, `npm audit` and `npm audit --omit=dev` each report **6 low, 0 moderate, 0 high, 0 critical**. Six Medusa/SendGrid/deepmerge findings remain; no patched `deepmerge` 4.x release is available. Security overrides raised `@graphql-tools/utils`, `ajv`, `bullmq`, `glob`, `lodash`, and `minimatch` to versions outside Medusa 2.22.2's declared dependency ranges. Provider/example typecheck, provider build, all 29 tests, Medusa build, and the full live HTTP acceptance passed with those resolutions. `npm ls` reports those intentional out-of-range overrides as invalid against upstream package declarations; this remains a compatibility risk until upstream releases compatible ranges.

These HTTP checks do not establish Safari/Chrome interaction coverage on the updated dependency tree, immediate Encvoy logout, or JWT revocation for direct API calls before the token's 30-minute expiry.

### Verification environment rerun (2026-11-02)

The provider and example typechecks and provider production build passed with Node.js 22.23.3. The standard `npm test` runner could not start its temporary PostgreSQL cluster in the current restricted execution environment: PostgreSQL 14.19 `initdb` selected SysV shared memory and failed with `shmget: Operation not permitted`, before the test process or application connected to a database. Direct access to the already-running local PostgreSQL and Docker sockets was also denied by the environment. No client or Medusa database was contacted or modified.


The direct no-database test command `node --import tsx --test tests/*.test.ts` ran 15 top-level tests after the logout regression tests were added: 12 passed, the two PostgreSQL integration tests were skipped because their opt-in flag and database URL were absent, and the OIDC integration fixture could not bind its local `127.0.0.1` listener (`EPERM`). Ten other isolated tests and both new logout regression tests passed separately. This is an environment limitation, not a passing full-suite result. The last complete recorded run remains the 29/29 test run against a disposable PostgreSQL cluster documented above; repeat the full suite in an environment that permits local shared memory and loopback sockets before release.

In Safari, the existing local demo displayed a logout error, but a subsequent protected-profile request showed the session was gone. Reusing the existing Encvoy session logged the synthetic customer back in and returned the same customer ID. The browser's running server build could not be refreshed from this restricted environment. The demo source now checks the protected session after an ambiguous logout response, and two regression tests cover both outcomes: session ended despite an error response, and session still active after a rejected logout.

The Medusa backend build completed, but the Admin frontend build could not probe a free port because binding to `0.0.0.0` is denied (`EPERM`). `npm pack --dry-run` passed and contained 11 expected files including LICENSE and README; import checks passed for the provider's four public exports. A clean-project install was attempted but could not complete while npm registry requests were blocked. `npm audit --omit=dev` likewise could not reach the configured registry proxy. These archive and dependency checks must be repeated in an environment with npm registry access.

Chrome UI access was also rejected by the computer-use approval layer with `Computer Use was not approved to use Google Chrome`, so no current Chrome browser flow was attempted in this pass. Safari remains available for the historical/current-runtime observations above; the patched source still needs to be built and tested in a browser.

## Safari evidence

On 2026-10-08, Safari customer sign-in with the synthetic fixture credentials reached `/demo/profile`. Local logout then made the protected profile return Unauthorized. Selecting the existing Encvoy session on repeat sign-in returned the same Medusa customer without another password prompt.

Safari employee login **passed**: `/app/orders` opened as the synthetic Test Employee, including after restarting the dev server following the final build. The browser test exposed that the JWT SDK overrides request credentials with `omit`, losing the HttpOnly proof cookie. The Admin widget now uses native same-origin `fetch` for the fixed employee login-start and callback POSTs, then the Medusa SDK for JWT storage and the Admin identity request. Both HTTP and actual Safari login passed after this correction. At that time the native employee-menu logout still needed a browser check; the current dependency-tree check is recorded below.

On 2026-10-29, Chrome, Firefox 159.0, and Opera 139.0.6053.15 (Chromium 155.0.8059.85) each completed customer sign-in, reached the protected profile, signed out, and repeated sign-in through the existing Encvoy session. During the first logout attempt, all three clients displayed a false failure because the demo parsed an empty successful logout response as JSON. A read-only protected-page request confirmed that the Medusa session had actually been destroyed. The demo now accepts an empty response body; after reloading the changed script, logout displayed the signed-out state correctly in Chrome, Firefox and Opera. This browser pass did not cover cancellation or employee login. Safari 18.6 had no active Encvoy session; the synthetic username was entered and Encvoy advanced to its password form, where testing is waiting for the user to enter the password. Edge could not be opened through the available computer-use controller, and Yandex Browser was not present in its application inventory.

## Cross-browser acceptance target

The requested desktop browser matrix is current stable Chrome, Edge, Firefox, Safari, Opera, and Yandex Browser. Chromium-based browsers must be checked by their actual browser applications; a Chrome result alone does not count as an Opera, Edge, or Yandex result. Firefox and Safari cover the other major browser engines. Mobile browsers are outside the current target unless separately added to scope.

The customer login, protected-profile, logout, and repeat-login flows were user-confirmed in Chrome and Safari on 2026-11-03. On 2026-11-03, employee Admin login/logout and both customer error states were tested in all five installed browsers: Chrome 156.0.8078.80, Safari 18.6, Firefox 159.0, Opera 139.0.6053.15, and Yandex Browser 25.8.5.977. All used Medusa 2.22.2 and Encvoy 3.6.19. Employee checks used the pre-authorized synthetic `.invalid` fixture in the isolated `medusa_clean_final_222_codex` PostgreSQL database on port 55439. Microsoft Edge is not installed on this Mac. See the 2026-11-03 record below.

## Remaining manual checks

Use the real local Encvoy image stand and the requested browser matrix. Do not use real customer or employee data.

| Scenario | Evidence to record |
| --- | --- |
| Encvoy login cancellation | Chrome, Safari, Firefox, Opera, and Yandex passed on 2026-11-03 using an actual login-start and a synthetic `access_denied` callback; Edge is not installed. Encvoy's login screen has no Cancel button |
| Encvoy unavailable | Chrome, Safari, Firefox, Opera, and Yandex passed on 2026-11-03 using a synthetic HTTP 503 `provider_unavailable` response; Edge is not installed. Backend discovery failure is separately covered by the OIDC fixture test |
| Employee logout through Admin | Chrome, Safari, Firefox, Opera, and Yandex passed on 2026-11-03; Edge is not installed. After logout, Admin navigation requires login; a copied unexpired JWT may remain valid |

Test malformed ID-token signature, issuer, audience, and nonce using the isolated protocol fixture rather than changing Encvoy signing keys or weakening its configuration. Keep authorization codes, tokens, cookies, passwords, and client secrets out of logs and shared diagnostics.

## Upgrade checks

After changing any version, rerun the automated suites, the real HTTP acceptance script, and customer and employee flows in Chrome and Safari. Inspect the Medusa auth/session/workflow contracts and verify the custom Admin widget remains the only visible Encvoy login action. Current live HTTP compatibility evidence applies to the pinned Encvoy 3.6.19 image digests with Medusa 2.22.2; the historical browser checks used earlier dependency trees. The separate GitHub source snapshot has compile defects; a local-only patch now builds its backend and widget but has not been runtime-tested. See [image evidence](encvoy-image.md) and [local source notes](encvoy-local.md).

## Current browser verification (2026-11-03)

The customer login/profile/logout/repeat-login flows in Chrome and Safari were confirmed by the user on the current local build. The employee Admin flow was independently repeated in Chrome 156.0.8078.80 (headless, isolated temporary profile), Safari 18.6, Firefox 159.0, Opera 139.0.6053.15, and Yandex Browser 25.8.5.977 on macOS 15.7.3. Medusa was running version 2.22.2 at `localhost:9000`; Encvoy 3.6.19 was healthy at `localhost:9090`. The Medusa process connected to the isolated PostgreSQL cluster `/tmp/encvoy-medusa-pg-GYnuxH` on port 55439, database `medusa_clean_final_222_codex`; read-only inspection confirmed two `.invalid` customers and one `.invalid` employee.

In each installed browser, the pre-authorized synthetic employee completed Encvoy login and reached `/app/orders`. Opening the employee menu and choosing **Log out** returned to `/app/login`. Navigating directly to `/app/orders` after logout again redirected to `/app/login`.

The same day, `PATH="$PWD/.local/runtime/node_modules/node/bin:$PATH" npm test` passed **31/31** on the pinned Node.js 22.23.3. This includes all OIDC fixture cases and both PostgreSQL integration tests. The runner created a temporary PostgreSQL cluster under `/tmp`, stopped it, and removed its directory after completion.

The current package was built and packed as `medusa-plugin-encvoy-id@0.1.0`, then installed from that tarball in a separate temporary Medusa 2.22.2 project. npm independently resolved 1,099 packages from the public registry using an isolated cache; the installed package was extracted under `node_modules` rather than linked to the workspace. Its default, `EncvoyAuthProvider`, `EncvoyStateStore`, and `entityId` exports imported successfully. The clean project's full `medusa build` passed, including backend and production Admin frontend. Build-only dummy secrets and unreachable database/Redis URLs were used; no database connection was made.

In each of the five browsers, the customer demo's actual login-start request created OIDC state, then a synthetic `access_denied` callback was submitted through the same browser session. The page displayed “Sign-in was cancelled. You can try again.” and did not display the raw callback error. For provider unavailability, a browser-level API interceptor supplied the expected HTTP 503 `{ message: "provider_unavailable" }` response to the login-start request. The page displayed “Encvoy ID is unavailable. Please try again later.”, kept the login button available, and did not expose the raw error code. The backend's real discovery-unavailable handling is separately covered by the OIDC fixture test. The shared Encvoy containers were not stopped.
