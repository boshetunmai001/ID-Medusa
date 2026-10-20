# Identity and session model

An external identity is identified by the collision-safe hash of the JSON tuple `[verified issuer, verified subject, configured client ID, Medusa actor type]`. The provider instance ID remains a separate Medusa namespace. The raw context is stored as provider metadata to make administrative bindings auditable. Email is mutable profile data, not the identity key.

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

The customer demo holds Medusa JWTs only in memory during callback and exchanges the final JWT for a native server-side session. Local logout calls `DELETE /auth/session`; it destroys that session and clears the cookie. A subsequent request with the old session must fail.

The example's refresh endpoint requires an explicit Bearer token and replaces Medusa's default session-first authentication context. An older customer session therefore cannot silently replace a newly authenticated identity during account switching. Session establishment regenerates the session ID and invalidates the previous session. The real HTTP acceptance run verified that customer logout invalidates the old session cookie and protected profile request.

Medusa Admin uses the documented JWT authentication mode. Its logout clears the SDK's local token storage. A previously copied JWT remains valid until expiration unless additional local revocation policy is implemented. The example configures a 30-minute token lifetime. Medusa's token refresh endpoint is local and does not re-check Encvoy, so token renewal is not an Encvoy session validity check.

The 30-minute JWT lifetime is not a maximum total access duration: native refresh may issue further tokens while the local AuthIdentity remains valid. The real HTTP acceptance run confirmed that a retained Medusa JWT still refreshes after local session logout. Ending or disabling the Encvoy account alone does not stop this renewal path.

Neither logout ends the Encvoy SSO session. A later login may complete without another password prompt. Disabling an Encvoy user does not immediately revoke an already issued Medusa JWT or session. Immediate global revocation, backchannel logout, and session synchronization are outside the MVP.

## Environment boundary

The local stand uses an explicit localhost HTTP option and loopback addresses. This option is rejected in production. Production configuration requires HTTPS, Secure cookies, exact callback URIs and browser origins, trusted proxy configuration, protected secrets, shared state/session stores, and deliberate session expiration/revocation policy. Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` or disable token validation.

Secrets are stored in ignored local environment files with restrictive permissions. No secret uses a `VITE_` prefix. Access logs that include callback query strings or referrers are disabled; the local proxy must follow the same rule. Do not put OIDC access/refresh tokens, authorization codes, passwords, or client secrets in metadata or diagnostic output.

The GitHub source snapshot pinned in this repository still has upstream backend and widget compile errors. The working acceptance evidence uses the vendor-distributed Encvoy 3.6.19 images pinned by digest, which have no source-revision metadata linking them to that GitHub commit. Results therefore apply to those exact images with Medusa 2.21.2 and Node 22.23.3; they do not certify other Encvoy versions or production deployment. See the [image evidence](encvoy-image.md) and [verification record](verification.md).
