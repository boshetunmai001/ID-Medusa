# Verification checklist and evidence

Keep protocol-fixture results separate from Encvoy acceptance. This page records the available local evidence; it does not certify another Encvoy release or a production deployment.

## Automated and local integration checks

Use Node 22.23.3 from the repository root:

```sh
npm run build
npm run typecheck
npm test
node scripts/medusa.mjs build
npm pack --workspace @local/medusa-auth-encvoy --dry-run
```

The protocol tests use a local OIDC fixture with signed tokens and controlled errors. They cover signature, issuer, audience, expiration, nonce, browser proof and state, replay, cancellation, discovery errors, employee allowlisting, and identity namespace separation. They do not exercise Encvoy.

The opt-in PostgreSQL state test uses the project's local database and removes its rows:

```sh
RUN_POSTGRES_INTEGRATION=1 .local/runtime/node_modules/node/bin/node --env-file=.local/infra.env --import tsx --test tests/postgres-state.integration.test.ts
```

It exercises context binding, expiry, one-time consumption under concurrent requests, and advisory-lock serialization using real PostgreSQL connections. The opt-in native Medusa harness also needs the local API running on port 9000:

```sh
RUN_MEDUSA_INTEGRATION=1 .local/runtime/node_modules/node/bin/node scripts/medusa.mjs exec src/scripts/check-integration.ts
```

That harness uses Medusa's own JWT signing utility; it does not authenticate through Encvoy. The latest rerun passed all 23 protocol/unit tests and both PostgreSQL tests. Two additional Admin request regressions passed: both auth POSTs preserve same-origin browser credentials, and network, HTTP and JSON failures expose only a generic message. Provider/example typechecks, provider build, the final full backend/Admin build, and the package dry-run passed.

The live bootstrap recovery check removed the saved Editor rotation marker and employee subject, then successfully recovered them without changing existing client IDs, client secrets or fixture passwords. It verified the existing employee's signed identity before the recovery run. Re-running the fixture helper preserved passwords and mode 0600; captured output contained no fixture secrets.

The final scan compared 17 actual private values against 464 shareable files, including 358 compiled frontend assets, and found zero matches. The separate client-creation lost-response recovery branch was reviewed but has not received a runtime fault-injection test.

## Real Encvoy HTTP acceptance

The recorded run used the vendor-distributed Encvoy ID 3.6.19 images pinned by digest, Medusa 2.21.2, Node 22.23.3, the isolated local PostgreSQL/Redis services, and only synthetic `.invalid` identities. With both local systems running and Medusa configured from `.local/encvoy-image-clients.env`, run:

```sh
RUN_ENCVOY_ACCEPTANCE=1 .local/runtime/node_modules/node/bin/node scripts/check-live-login.mjs
```

The full script passed. It performs real Encvoy browser-protocol requests, exchanges signed ID tokens, and exercises the live Medusa HTTP API. Evidence from the completed run:

| Scenario | Result |
| --- | --- |
| First customer login and account completion | Pass; eight concurrent completion requests resolved to the same customer, and native Admin listed exactly one customer for the fixture email |
| Repeat customer login | Pass; returned the same customer |
| Provider cancellation and state consumption | Pass; cancellation created no session and replay was rejected |
| Changed state and another browser's proof cookie | Pass; rejected without taking ownership of the initiating browser's state |
| Callback and return URL overrides | Pass; unapproved URLs were rejected and callback state could not be reused |
| Callback replay and customer access to Admin API | Pass; replay failed and customer credentials were denied |
| Customer logout | Pass; profile access and the previous session cookie were rejected |
| Retained Medusa JWT after logout | Refresh succeeded; this is a documented local revocation limitation because refresh does not consult Encvoy |
| Pre-authorized employee login | Pass; the employee token accessed the native Admin API as the explicitly bound user |
| Unbound Encvoy user | Pass; employee login was denied and no Medusa user was created |
| Existing guest with the same email | Pass; account completion returned HTTP 422 with `duplicate_error` / `account_conflict`, and the guest record remained unchanged |

These checks do not establish immediate Encvoy logout or revocation. The script is HTTP-based and does not claim Safari coverage.

## Safari evidence

On 2026-10-08, Safari customer sign-in with the synthetic fixture credentials reached `/demo/profile`. Local logout then made the protected profile return Unauthorized. Selecting the existing Encvoy session on repeat sign-in returned the same Medusa customer without another password prompt.

Safari employee login **passed**: `/app/orders` opened as the synthetic Test Employee, including after restarting the dev server following the final build. The browser test exposed that the JWT SDK overrides request credentials with `omit`, losing the HttpOnly proof cookie. The Admin widget now uses native same-origin `fetch` for the fixed employee login-start and callback POSTs, then the Medusa SDK for JWT storage and the Admin identity request. Both HTTP and actual Safari login passed after this correction. The native employee-menu logout still needs a browser check: the automation could not open its dropdown through accessibility, and coordinate input failed with `noWindowsAvailable`.

## Remaining manual checks

Use the real local Encvoy image stand and Safari. Do not use real customer or employee data.

| Scenario | Evidence to record |
| --- | --- |
| Encvoy login cancellation in Safari | Safe error shown and no account/session granted |
| Encvoy unavailable in Safari | Safe unavailable message; no upstream body or secret shown |
| Employee logout in Safari | SDK token storage cleared and navigation requires login; separately note a copied unexpired JWT may remain valid |

Test malformed ID-token signature, issuer, audience, and nonce using the isolated protocol fixture rather than changing Encvoy signing keys or weakening its configuration. Keep authorization codes, tokens, cookies, passwords, and client secrets out of logs and shared diagnostics.

## Upgrade checks

After changing any version, rerun the automated suites, the real HTTP acceptance script, and both Safari actor flows. Inspect the Medusa auth/session/workflow contracts and verify the custom Admin widget remains the only visible Encvoy login action. Current compatibility evidence applies only to the pinned Encvoy 3.6.19 image digests with Medusa 2.21.2; the GitHub source snapshot is separate and remains blocked by upstream compile errors. See [image evidence](encvoy-image.md).
