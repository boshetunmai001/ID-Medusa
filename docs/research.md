# Compatibility research

Research date: 2026-10-08. Runtime evidence is recorded separately in `STATUS.md`.

## Selected versions

| Component | Pin | Evidence |
| --- | --- | --- |
| Encvoy ID | `5579bf5c05464da48585be28a3863c915b9b704f` | Upstream `main` checkout; no tags returned by `git ls-remote --tags` |
| Encvoy version labels | package `1.2.0`, backend constant `1.2.17` | These labels differ; the commit is the authoritative source pin |
| Medusa packages | `2.21.2` | Official documentation and npm registry |
| openid-client | `6.8.8` | npm registry; installed declarations and implementation |
| Node.js | `22.23.5` | Current repository pin in `.nvmrc`; unit, build, live HTTP, and browser runtime checks are dated individually in `verification.md` |
| PostgreSQL / Redis | Encvoy PostgreSQL 16.16 and Redis image digests in `infra/encvoy-image.compose.yaml`; Medusa PostgreSQL 16 in `infra/compose.yaml` | Verified image manifests; Encvoy 16.16 clone and stack acceptance on 2026-11-13 |

The source checkout is excluded from the integration package and remains under `research/encvoy-id`. No Encvoy or Medusa core changes are part of the integration. Encvoy's upstream quick start uses floating Docker tags and omits npm lockfiles. The local harness must preserve its resolved lockfiles before it can claim reproducibility. There is no tagged stable Encvoy release to select in this repository; the selected commit is a development snapshot, not a certified stable release.

## Encvoy source findings

All paths below refer to the pinned [upstream commit](https://github.com/encvoy/id/tree/5579bf5c05464da48585be28a3863c915b9b704f).

- `packages/oidc/src/main.ts` constructs `Provider(DOMAIN, configuration)`. Discovery is at `${DOMAIN}/.well-known/openid-configuration`.
- `packages/oidc/src/config.ts` defines `/oidc/auth`, `/oidc/token`, `/oidc/me`, `/oidc/jwks`, `/oidc/session/end`, `/oidc/token/introspection`, and `/oidc/token/revocation`. Use discovery instead of hardcoding protocol endpoints.
- Supported response types include `code` and hybrid/implicit combinations. This integration only requests `code` and does not request refresh tokens.
- PKCE is available through `oidc-provider`; Encvoy sets `pkce.required` to false. The integration requires advertised S256 support and always sends S256, state, and nonce.
- Available scopes include `openid`, `email`, `profile`, `phone`, `offline_access`, `accounts`, and internal scopes. Only `openid email profile` are requested.
- `packages/oidc/src/account.ts` removes unverified email and calculates `email_verified` from a matching confirmed EMAIL/EMAIL_CUSTOM account. An email merely entered in a profile does not qualify.
- `packages/oidc/src/utils/jwks.ts` generates and persists an RS256 private signing key. Preserve the JWKS directory; never distribute its private contents.
- Dynamic OIDC client registration is disabled. Applications are registered through the dashboard or protected `POST /api/v1/clients`. The API generates client IDs and secrets.
- `packages/backend/src/modules/users/users.dto.ts` and `users.service.ts` support administrator-created synthetic accounts with explicitly confirmed email. This avoids external email delivery for the local tests.
- `packages/backend/src/modules/prisma/prisma.service.ts` seeds an owner from environment variables and a second fixed-credential administrator. The local stand must secure that second bootstrap account before use.
- RP initiated logout is enabled, but Encvoy also exposes a separate custom session route with different behavior. The MVP does not call either route and makes no global logout guarantee.

The real platform requires PostgreSQL, Redis, the backend, OIDC service, auth service, and a built authentication widget. The dashboard is used for administration. The upstream local proxy config and quick-start hostname disagree; the integration stand uses its own local proxy configuration and non-conflicting ports.

## Medusa extension surfaces

The selected version supports a public [custom Auth Module Provider](https://docs.medusajs.com/resources/references/auth/provider) and [custom Admin authentication](https://docs.medusajs.com/resources/how-to-tutorials/how-to/admin/auth). This implementation uses those generic APIs, `AuthIdentity`, native auth routes, `createCustomerAccountWorkflow`, and native sessions. It never substitutes an Encvoy token for a Medusa token.

The maintained `@medusajs/auth-oidc` implementation exists, but is included in Medusa's [Enterprise Materials list](https://github.com/medusajs/medusa/blob/v2.21.2/ENTERPRISE-LICENSE.md). This project does not reuse that provider, its SSO user route, its bundled SSO login component, or enable Enterprise feature flags. No adequately verified maintained OSS alternative was found with the required identity and authorization policy.

Installed source checks:

- `@medusajs/auth/dist/services/auth-module.js`: `getState` performs cache get then invalidate. That is not an atomic consume under concurrency. The integration uses PostgreSQL `DELETE ... RETURNING` for state.
- `@medusajs/medusa/dist/api/auth/[actor_type]/[auth_provider]/callback/route.js`: native callback delegates to the provider and issues a Medusa token.
- `@medusajs/medusa/dist/api/auth/session/route.js`: POST establishes a native session; DELETE destroys the server-side session and clears its cookie.
- `@medusajs/core-flows/dist/customer/steps/validate-customer-account-creation.js`: this version refuses existing registered and guest customers. The example additionally applies a case-insensitive collision check under a shared lock.
- `@medusajs/customer/dist/models/customer.js`: uniqueness on `(email, has_account)` for non-deleted rows provides a final database guard in addition to integration locks.
- `@medusajs/framework/dist/http/express-loader.js`: default access logs include URLs and referrers. The example disables HTTP access logging so authorization codes are not logged.

The two configured provider IDs are explicitly restricted using `http.authMethodsPerActor`. Employee authorization is prebinding by external subject and existing Medusa user ID. Email and email domains are never used to grant employee access.
