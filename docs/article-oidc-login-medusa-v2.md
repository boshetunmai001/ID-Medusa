# OIDC Login for Medusa v2 with Encvoy ID

> **Publication draft, updated 2026-11-16.** This article describes the local prototype in this repository; the npm package is not published. Final local archive D passed independent installation in a clean Medusa 2.22.2 consumer, zero-finding full and production dependency audits, typecheck, production Backend/Admin build, and the full HTTP acceptance suite, including employee-grant revocation. Chrome 157.0.8103.51 and Safari 18.6 on D passed customer login/profile/logout/repeat-login and employee login/Admin Orders/logout. The full HTTP and browser acceptance preceded the final dependency-only SendGrid override; its compatibility was separately checked with clean install, audit, typecheck, build, and a focused merge smoke test. See the [verification record](verification.md) for the archive hash and evidence boundaries.

Medusa v2 applications often need to connect an existing identity provider without turning its tokens into application credentials or silently linking accounts by email. This project demonstrates an OpenID Connect Authorization Code flow for Encvoy ID, with separate sign-in paths for storefront customers and Medusa Admin employees.

The integration is implemented as a Medusa Auth Module Provider in `packages/auth-encvoy`, with a runnable example in `examples/medusa`. Current release-candidate evidence covers Medusa 2.22.2, Node.js 22.23.5, `openid-client` 6.8.8, and vendor-distributed Encvoy ID 3.6.19 images pinned by immutable digest. The three-page assignment PDF available with the handoff says Encvoy images based on 1.2; the reviewer refers to another edition naming 3.6.19, which was not available for direct comparison. Runtime results below are from the 3.6.19 vendor images and are not a compatibility claim for Encvoy 1.2 images or a build of the separate 1.2.0 source snapshot. The current 33-test suite passed on 2026-11-16. Final local archive D (SHA-1 `dfbffc858341a000f676acecdcfaf61ce373ae35`) passed clean-consumer install, zero-finding full and production audits, typecheck, production build, and full live HTTP acceptance on synthetic data. The run included refusal to establish a customer session before account completion and employee grant revocation. Chrome 157.0.8103.51 and Safari 18.6 on D passed customer login/profile/logout/repeat-login and employee login/Admin Orders/logout. See the [verification record](verification.md) for exact evidence.

## Separate customer and employee sign-in

The example configures two provider instances: `encvoy-customer` for customers and `encvoy-user` for employees. Medusa restricts each actor type to its corresponding provider. Customer sign-in can provision a Medusa customer after successful identity verification. Employee sign-in does not create a Medusa user: a trusted operator must first bind an existing Medusa user to an Encvoy issuer and subject verified through trusted administration.

This separation keeps storefront identities out of the Admin authorization path. An email address or domain is not sufficient to grant employee access.

## Minimal Medusa configuration

Install the package in the Medusa application and configure separate confidential Encvoy clients for customers and employees. Keep secrets in server-side environment variables. A shortened configuration shape is:

```ts
const provider = (actorType: "customer" | "user") => ({
  resolve: "medusa-plugin-encvoy-id",
  id: `encvoy-${actorType}`,
  options: {
    actorType,
    issuer: process.env.ENCVOY_ISSUER!,
    clientId: process.env[`ENCVOY_${actorType.toUpperCase()}_CLIENT_ID`]!,
    clientSecret: process.env[`ENCVOY_${actorType.toUpperCase()}_CLIENT_SECRET`]!,
    callbackUrl: `${process.env.MEDUSA_BROWSER_ORIGIN}${actorType === "customer" ? "/demo/callback" : "/app/login"}`,
    browserOrigin: process.env.MEDUSA_BROWSER_ORIGIN!,
    databaseUrl: process.env.DATABASE_URL!,
  },
});

// In projectConfig.http:
authMethodsPerActor: {
  customer: ["encvoy-customer"],
  user: ["encvoy-user"],
}

// In the auth module's providers:
providers: [provider("customer"), provider("user")]
```

This snippet shows provider registration only; it does not replace the required browser middleware, customer callback/account-completion routes, Admin widget, PostgreSQL state-store loader, or employee allowlist binding. To reproduce the integration, install the exact package tarball in a clean Medusa 2.22.2 app, apply and lock the documented consumer-root overrides, register the two providers, initialize the shared state store, then add the middleware/routes, customer completion flow, Admin widget, and explicit employee binding. The runnable [Medusa example configuration](../examples/medusa/medusa-config.ts) and [step-by-step consumer integration guide](consumer-integration.md) show each piece. The guide includes clean-install, audit, typecheck, Backend/Admin build, and scenario-check commands.

The customer flow has two server-side steps before it can create a native Medusa session: first POST the callback token to `/encvoy/customer/complete`, then POST it to `/auth/session`. The example middleware reloads the AuthIdentity before session creation and requires its persisted `customer_id`; it hydrates the registered customer actor ID because the OIDC callback token was issued before account completion. Do not enable the native session route without this completed-account check. For staff, create the Medusa user and bind its verified Encvoy issuer/subject through the trusted allowlist script before login.

In a browser callback page, keep the Encvoy token in memory and send each request to the same Medusa origin so the HttpOnly browser-proof cookie is included:

```ts
const callback = await fetch("/auth/customer/encvoy-customer/callback", {
  method: "POST",
  credentials: "same-origin",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, state, iss }),
});
if (!callback.ok) throw new Error("Envcoy sign-in failed");
const { token } = await callback.json();

const account = await fetch("/encvoy/customer/complete", {
  method: "POST",
  credentials: "same-origin",
  headers: { authorization: `Bearer ${token}` },
});
if (!account.ok) throw new Error("Customer account could not be completed");

const session = await fetch("/auth/session", {
  method: "POST",
  credentials: "same-origin",
  headers: { authorization: `Bearer ${token}` },
});
if (!session.ok) throw new Error("Medusa session could not be established");
```

The runnable implementation also handles provider cancellation, removes callback query parameters from browser history, rejects email collisions, and redirects to the protected profile. For staff offboarding, block the identity in Encvoy and run `node scripts/medusa.mjs exec ./src/scripts/revoke-employee.ts` from the repository root after setting the verified user ID in the private Medusa environment. The next protected Admin API request rejects any JWT carrying that revoked grant.

## Protecting the OIDC flow

The provider uses Authorization Code flow with S256 PKCE, a random state value, and a nonce. A separate unpredictable HttpOnly browser-proof cookie binds the callback to the browser that started the login. The state record is stored in PostgreSQL, expires after five minutes, and is consumed atomically before the authorization code is exchanged.

The server validates the issuer, token signature and claims through `openid-client`. The callback URI and browser origin are fixed by server configuration; callback and return-URL overrides are rejected. Authorization codes, tokens, and upstream error details are not exposed as application logs or credentials.

## Customer accounts and email collisions

The provider creates or finds a Medusa AuthIdentity. The example then uses Medusa's native customer account workflow to create the customer. Before provisioning, it requires a verified email and checks for an existing customer with the same normalized address. If one exists, including a guest account, the request is refused. The example does not merge or automatically link accounts by email.

That policy avoids using a mutable profile claim as proof of ownership of an existing store account. Account recovery or linking requires an administrator's ownership review and is outside this prototype.

## Local demo and verification

The repository includes a local Medusa example with a customer sign-in and protected profile page, plus an Encvoy login widget in the Admin. The documented setup uses synthetic `.invalid` identities and loopback services. It is not a production deployment guide; production requires HTTPS, secure cookies, protected secrets, exact callback and origin configuration, and an operational session-revocation policy.

The recorded automated checks include protocol and state-store coverage, a standard test run with a temporary PostgreSQL cluster, real HTTP acceptance against the pinned Encvoy images, and local build checks. A fresh Medusa 2.21.2 server using the package tarball completed synthetic customer login; full live HTTP acceptance also passed on Medusa 2.22.2. On 2026-11-03, customer flows passed in Chrome and Safari on the application build. On 2026-11-13, Safari 18.6 customer and employee login/logout passed on archive A. On 2026-11-16, final local archive D passed the complete scripted HTTP suite in an independent clean consumer; on final archive D, Chrome 157.0.8103.51 and Safari 18.6 customer login/profile/logout/repeat-login and employee Admin login/Orders/logout passed. Firefox, Opera, and Yandex checks are supplementary; Edge was unavailable. The npm package remains unpublished. The 2.22.2 install uses documented npm overrides for security updates beyond upstream dependency pins; see the [security audit](security.md) and [verification record](verification.md).

## Session limitations

In the example, the Medusa session cookie, customer and employee JWTs, and employee grants expire after 30 minutes; JWT refresh is disabled for both Encvoy providers. Customer logout destroys the native Medusa session and clears its cookie, but a copied customer bearer JWT may still access routes that accept it until its `exp`. Admin logout clears only the current browser's token storage; a copied employee JWT can continue to access protected Admin APIs until expiry unless its grant is revoked. Neither logout ends the separate Encvoy SSO session, so another login may complete without a password while that session remains valid.

Blocking an employee in Encvoy does not revoke an already-issued Medusa JWT or employee grant. For immediate offboarding, block the Encvoy account and run [`revoke-employee.ts`](../examples/medusa/src/scripts/revoke-employee.ts) with the verified Medusa user ID. Each protected Admin API request checks the shared PostgreSQL grant registry; after revocation, the next request with that JWT is denied. This does not end Encvoy SSO or remove the Medusa identity binding. Remove/disable the binding through trusted administration if future login must remain disabled after the Encvoy account is unblocked. This immediate employee revocation is implemented in the example; equivalent middleware, state storage, and offboarding steps must be carried into a consumer app. Immediate customer JWT revocation is not implemented. See the [session and revocation design](security.md#logout-and-revocation).

## Source and image versions

The exact assignment PDF available with the handoff specifies ready-made Encvoy images based on 1.2; the reviewer identifies a different assignment edition naming 3.6.19. That other document was not available for direct comparison. Project acceptance used vendor-distributed Encvoy ID 3.6.19 images. They are not established as builds of the separate GitHub source checkout pinned at version 1.2.0; its pristine backend and authentication-widget builds have upstream compile errors. Local uncommitted fixes make both compile, but have not been runtime-tested. The image manifests contain no source-revision metadata linking the distributions. Results apply to the exact pinned images and Medusa version above, not automatically to Encvoy 1.2 images or other releases.

## Project resources

- [Local setup and project overview](../README.md)
- [Provider contract and integration checklist](../packages/auth-encvoy/README.md)
- [Complete consumer installation and wiring guide](consumer-integration.md)
- [Security model and dependency audit rationale](security.md)
- [Envcoy image evidence and operations](encvoy-image.md)
- [Verification record, artifact hash, and evidence boundaries](verification.md)
- [Russian final acceptance checklist](FINAL_CHECKLIST_RU.md)
