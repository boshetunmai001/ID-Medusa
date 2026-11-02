# OIDC Login for Medusa v2 with Encvoy ID

> **Publication draft.** This article describes the local prototype in this repository. The package is unpublished, and the browser and release coverage listed below is incomplete.

Medusa v2 applications often need to connect an existing identity provider without turning its tokens into application credentials or silently linking accounts by email. This project demonstrates an OpenID Connect Authorization Code flow for Encvoy ID, with separate sign-in paths for storefront customers and Medusa Admin employees.

The integration is implemented as a Medusa Auth Module Provider in `packages/auth-encvoy`, with a runnable example in `examples/medusa`. Its current live HTTP compatibility evidence covers Medusa 2.21.2 and 2.22.2, Node.js 22.23.3, `openid-client` 6.8.8, and the vendor-distributed Encvoy ID 3.6.19 images pinned by immutable digest. Fresh browser smoke checks against the updated 2.22.2 dependency tree are pending.

## Separate customer and employee sign-in

The example configures two provider instances: `encvoy-customer` for customers and `encvoy-user` for employees. Medusa restricts each actor type to its corresponding provider. Customer sign-in can provision a Medusa customer after successful identity verification. Employee sign-in does not create a Medusa user: a trusted operator must first bind an existing Medusa user to an Encvoy issuer and subject verified through trusted administration.

This separation keeps storefront identities out of the Admin authorization path. An email address or domain is not sufficient to grant employee access.

## Protecting the OIDC flow

The provider uses Authorization Code flow with S256 PKCE, a random state value, and a nonce. A separate unpredictable HttpOnly browser-proof cookie binds the callback to the browser that started the login. The state record is stored in PostgreSQL, expires after five minutes, and is consumed atomically before the authorization code is exchanged.

The server validates the issuer, token signature and claims through `openid-client`. The callback URI and browser origin are fixed by server configuration; callback and return-URL overrides are rejected. Authorization codes, tokens, and upstream error details are not exposed as application logs or credentials.

## Customer accounts and email collisions

The provider creates or finds a Medusa AuthIdentity. The example then uses Medusa's native customer account workflow to create the customer. Before provisioning, it requires a verified email and checks for an existing customer with the same normalized address. If one exists, including a guest account, the request is refused. The example does not merge or automatically link accounts by email.

That policy avoids using a mutable profile claim as proof of ownership of an existing store account. Account recovery or linking requires an administrator's ownership review and is outside this prototype.

## Local demo and verification

The repository includes a local Medusa example with a customer sign-in and protected profile page, plus an Encvoy login widget in the Admin. The documented setup uses synthetic `.invalid` identities and loopback services. It is not a production deployment guide; production requires HTTPS, secure cookies, protected secrets, exact callback and origin configuration, and an operational session-revocation policy.

The recorded automated checks include protocol and state-store coverage, a standard test run with a temporary PostgreSQL cluster, real HTTP acceptance against the pinned Encvoy images, and local build checks. A fresh Medusa 2.21.2 server using the package tarball completed synthetic customer login; full live HTTP acceptance also passed on Medusa 2.22.2. Safari customer login/profile/logout/reuse and pre-authorized employee login are recorded as passed. Current checks also confirm customer sign-in and protected profile access in Chrome, Firefox, and Opera; fresh browser flows on the updated dependency tree and the remaining Edge/Yandex checks are pending. The npm package remains unpublished. The 2.22.2 install uses documented npm overrides for security updates beyond upstream dependency pins; see the [security audit](security.md) and [verification record](verification.md).

## Session limitations

Local logout ends the Medusa customer session, but it does not end the Encvoy SSO session. Customer JWTs cannot be refreshed or used to establish a session more than once; employee JWT refresh is disabled. A copied JWT can still access protected routes until its 30-minute expiry. Immediate cross-system revocation, back-channel logout, and session synchronization are not implemented.

## Source and image versions

The successful acceptance evidence uses vendor-distributed Encvoy ID 3.6.19 images. They are not established as builds of the separate GitHub source checkout pinned at version 1.2.0; its pristine backend and authentication-widget builds have upstream compile errors. Local uncommitted fixes make both compile, but have not been runtime-tested. The image manifests contain no source-revision metadata linking the two distributions. Results should therefore be read as evidence for the exact pinned images and Medusa version above, not as proof for Encvoy 1.2.0 or other releases.

## Project resources

- Local setup: `README.md`
- Provider contract: `packages/auth-encvoy/README.md`
- Security model: `docs/security.md`
- Image evidence and operations: `docs/encvoy-image.md`
- Verification record: `docs/verification.md`
