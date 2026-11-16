# Identity and session model

An external identity is identified by the collision-safe hash of the JSON tuple `[verified issuer, verified subject, configured client ID, Medusa actor type]`. The provider instance ID remains a separate Medusa namespace. The raw context is stored as provider metadata to make administrative bindings auditable. Email is mutable profile data, not the identity key.

## Dependency overrides and residual audit signal

The workspace root and tested Medusa 2.22.2 consumer use these top-level npm overrides to move vulnerable transitive packages beyond their audited affected ranges:

| Root override | Audit reason for this pin |
| --- | --- |
| `@graphql-tools/utils@12.1.0` | Two GraphQL Tools prototype-pollution advisories |
| `ajv@8.18.0` | `$data` regular-expression denial-of-service advisory |
| `bullmq@5.81.5` | Move Medusa's Redis queue package beyond the vulnerable BullMQ range |
| `@sendgrid/helpers` → `deepmerge@4.1.2` | Resolve GHSA-gcqx-w48m-w2h4 by selecting the latest release below its affected range (4.2.0–4.3.1); this is below `@sendgrid/helpers`' declared `^4.2.2` range and was compatibility-tested |
| `glob@14.0.3` | glob AbortSignal cancellation traversal issue; selected alongside the separately pinned fixed minimatch |
| `lodash@4.18.1` | Template code-injection and array-path prototype-pollution advisories |
| `minimatch@11.0.4` | globparts amplification denial-of-service advisory |

The pins were selected from patched releases available to the audited dependency tree, except `deepmerge`, where 4.1.2 is used because no fixed release exists and the advisory's affected range starts at 4.2.0. Several pins exceed declared ranges, so they were treated as compatibility changes rather than assumed-safe upgrades. The exact final tarball in a clean consumer passed `npm ci`, `npm ls`, typecheck, production Backend/Admin build, and a focused SendGrid dynamic-template merge check with all seven overrides; full and production audits reported zero findings. The full live HTTP acceptance for archive D was completed before this dependency-only deepmerge change; the Encvoy provider does not call SendGrid. This is compatibility evidence for Medusa 2.22.2 and the tested dependency tree only. These overrides are not published by this provider and npm considers only the consumer root `package.json`; the consumer must review them, add them to its own root manifest, lock the result, and repeat dependency and application checks. See the [complete consumer integration sequence](consumer-integration.md), [npm override semantics](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides), and [verification evidence](verification.md).

Before the `deepmerge@4.1.2` override, npm reported six Low package nodes on one path: Medusa → `@medusajs/notification-sendgrid` → `@sendgrid/mail` → `@sendgrid/helpers` → `deepmerge@4.3.1`. They were six nodes for one GHSA, not six distinct advisories. As checked on 2026-11-16, GitHub lists [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) as an active Low advisory for `deepmerge` 4.2.0–4.3.1 and lists no patched version. The linked CVE-2026-93753 was subsequently [rejected by the CVE authority](https://www.cve.org/CVERecord?id=CVE-2026-93753); npm audit nevertheless continued to report the GHSA. The consumer now overrides to 4.1.2, outside the reported affected range; fresh full and production audits both return zero findings. This example does not configure or call SendGrid, though a consumer that does may exercise its helper path. Keep the pin visible and compatibility-tested, and recheck the GHSA, upstream package, and consumer dependency path before upgrades. The package-level integration order is in the [consumer guide](consumer-integration.md).

Customer and employee clients, provider instances, browser cookies, and actor types are separate. A customer token cannot authenticate an admin API request. Employee callback never creates a user or grants access based on an email domain: it requires an existing AuthIdentity with an explicit `user_id` binding. An administrator must verify the external subject through trusted Encvoy administration before running the binding command. The real local employee test uses a synthetic Medusa user bound before login; an unbound Encvoy user was denied without creating a Medusa user.

## First customer login and conflicts

Successful OIDC authentication creates or finds the customer's AuthIdentity. A pending native Medusa token is used to call `/encvoy/customer/complete`; that endpoint reads verified identity metadata on the server, serializes account provisioning, refuses email collisions, and runs Medusa's account workflow. The browser cannot choose the account email or target customer ID. Repeated completion returns the same customer. Provisioning requires Encvoy to return a verified email; the synthetic image fixtures explicitly enable the required email and name claims for their own OAuth profile.

If any existing customer, including a guest, has the normalized email, the MVP returns `account_conflict`. It does not link or overwrite that account. The user must contact the store administrator for ownership verification. A self-service account-linking UI and automated legacy account migration are outside the MVP. The example deliberately blocks the standard customer creation endpoint to prevent bypassing this policy; adding other registration providers requires equivalent enforcement.

After a customer is bound, a changed Encvoy email does not rebind the identity or overwrite the existing customer's email. Profile synchronization is outside this release.

## Login ceremony

Authorization Code Flow uses a server-side client secret, S256 PKCE, random state, and nonce. A separate HttpOnly cookie proves that callback came from the initiating browser. State expires after five minutes and is atomically consumed before token exchange, including when login is cancelled. Replay, missing browser proof, and mismatched state fail closed. The callback URI is fixed by server configuration; arbitrary return URLs and callback overrides are not accepted.

The custom Admin widget sends only the fixed employee login-start and callback POSTs with native same-origin `fetch`, so the browser sends and stores the HttpOnly proof cookie. It gives the resulting Medusa JWT to the SDK's token storage and uses the SDK for the Admin identity request.

OIDC protocol and signature validation belongs to `openid-client`. Its non-repudiation checks are explicitly enabled so ID-token JWS signatures are checked even after a backchannel exchange. Issuer, audience, expiration, nonce, subject, and signing algorithm must pass validation. Only a confirmed email can provision a customer. Upstream token contents and error descriptions are not returned or logged.

## Logout and revocation

In the example, `http.jwtExpiresIn` is 1800 seconds and the Medusa session cookie has a 30-minute max age. The customer demo holds the callback JWT in memory and exchanges it for a native Medusa session. Local logout calls `DELETE /auth/session`; this destroys the native session and clears its cookie, so the old session cookie is rejected. It does not revoke a copy of the bearer JWT issued before the exchange. That copied JWT may still authenticate to routes that accept it until its `exp`, at most 30 minutes from issue. Refresh is disabled, so the token cannot be extended.

The example's refresh endpoint requires an explicit Bearer token and replaces Medusa's default session-first authentication context, then refuses refresh for Encvoy customer and employee providers. A customer JWT establishes a native session directly and may do so only once; the database stores only its SHA-256 hash until token expiry. Session establishment regenerates the session ID and invalidates the previous session.

Medusa Admin uses JWT authentication. Its logout clears the SDK's local token storage in that browser, but it does not revoke the signed token or server-side grant. If a copy of the employee JWT exists, it can continue to access protected Admin APIs until expiry (at most 30 minutes from issue in the example) while its grant remains active. Refresh for the Encvoy employee provider is denied. Every protected `/admin` request first authenticates normally, then checks the JWT's signed `encvoy_login_id` against a shared PostgreSQL employee-grant registry. A copied employee JWT is rejected on its next protected request after its grant is revoked. The example configures matching 30-minute JWT and grant lifetimes. Medusa documents `jwtExpiresIn` as the token expiration setting and bearer JWTs as an Admin API authentication method ([configuration](https://docs.medusajs.com/resources/references/medusa-config#httpjwtexpiresin), [Admin authentication](https://docs.medusajs.com/api/admin/authentication)).

Refresh is disabled, so an expired Medusa JWT must be replaced by a new Encvoy login. Medusa logout does not end the Encvoy SSO session; if that separate Encvoy session remains active, another login may complete without asking for the password again. Its lifetime and revocation behavior are controlled by the Encvoy deployment, not by this provider. Blocking a user in Encvoy does not revoke an already-issued Medusa JWT or its active employee grant, and does not provide immediate Medusa API revocation. Do not rely on the Encvoy block alone to end access already established in Medusa.

### Immediate employee revocation

Each successful Encvoy employee callback creates a random login identifier, stores a grant bound to the existing Medusa user ID and expiry in PostgreSQL, and signs that identifier into the Medusa JWT. Middleware checks the grant on each `/admin` request and fails closed if the registry cannot be reached. No positive cache is used, so revocation applies to the next request across application instances that share this database. It cannot remove data already displayed, copied, or exported.

For immediate employee offboarding, block the account in Encvoy, set the verified Medusa user ID in `examples/medusa/.env`, then run the repository's Medusa wrapper from the repository root:

```sh
node scripts/medusa.mjs exec ./src/scripts/revoke-employee.ts
```

The command revokes all active Encvoy grants for that Medusa user; it does not end the Encvoy SSO session, delete the employee binding, or modify Medusa business records. The next protected Admin API request carrying any of those JWTs is denied across application instances that share the grant database. Future Encvoy logins remain possible if Encvoy allows the account and the explicit Medusa binding remains; remove/disable that binding through the trusted administration process when the employee should permanently lose access. A database outage causes protected Admin API checks for Encvoy employees to fail closed; operators should monitor database availability and restore service promptly. This immediate revocation mechanism is implemented in the example and must be carried into a consumer app along with the middleware, shared state store, and offboarding command. There is no equivalent immediate customer-JWT revocation mechanism in this release; customer bearer tokens can remain usable until their 30-minute expiry.

## Environment boundary

In Medusa development mode, the Admin Vite middleware sets anti-framing, MIME-sniffing, and referrer headers. Medusa serves the production Admin from its own static Express middleware, outside this Vite hook. A production reverse proxy must apply those headers to every `/app` response; `infra/medusa-admin-security-headers.nginx.conf` is a location snippet for that proxy. The Medusa Admin response path must be checked after deployment.

The local stand uses an explicit localhost HTTP option and loopback addresses. This option is rejected in production. Production configuration requires HTTPS, Secure cookies, exact callback URIs and browser origins, trusted proxy configuration, protected secrets, shared state/session stores, and deliberate session expiration/revocation policy. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable token validation.

Secrets are stored in ignored local environment files with restrictive permissions. No secret uses a `VITE_` prefix. Access logs that include callback query strings or referrers are disabled; the local proxy must follow the same rule. Do not put OIDC access/refresh tokens, authorization codes, passwords, or client secrets in metadata or diagnostic output.

The GitHub source snapshot pinned in this repository still has upstream backend and widget compile errors. The working acceptance evidence uses the vendor-distributed Encvoy 3.6.19 images pinned by digest, which have no source-revision metadata linking them to that GitHub commit. Results therefore apply to those exact images with Medusa 2.21.2 and 2.22.2; automated checks were repeated on Node.js 22.23.5. They do not certify other Encvoy versions or production deployment. See the [image evidence](encvoy-image.md) and [verification record](verification.md).
