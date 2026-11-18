# Medusa integrations directory listing draft

> Draft for the package release. The package is not published; this content is not submitted or listed yet.

Medusa describes its integrations directory as curated from npm. Its listing guidance asks for a `medusa-plugin-*` package name and the `medusa-plugin` or `medusa-plugin-integration` npm keyword. The current candidate follows that convention. See the [Medusa integrations directory](https://medusajs.com/integrations) and [directory listing guidance](https://medusajs.com/blog/integrations-jun-26).

## Listing details

- **Name:** Encvoy ID Authentication
- **Package:** `medusa-plugin-encvoy-id`
- **Category:** Authentication
- **Description:** Add Encvoy ID OpenID Connect sign-in to Medusa v2 storefront customers and Admin employees. Uses separate actor providers, Authorization Code with S256 PKCE, browser-bound state and nonce, verified identity claims, and explicit administrator binding for employees.
- **Install:** `npm install medusa-plugin-encvoy-id`
- **Documentation:** `README.md` in the project repository
- **Source:** https://github.com/boshetunmai001/ID-Medusa
- **Demo:** Local-only demo at the moment; no public HTTPS demo is available.

## Release facts to retain in the listing

- Target Medusa version: 2.22.2. Archive F (`c62d6d4d6f672fbbc3fe8f5a8c333375262140e1`) was independently installed in a clean consumer with independently resolved dependencies; `npm ls`, typecheck, production Backend/Admin build, and synthetic HTTP acceptance passed. HTTP acceptance includes logout revoking the employee grant and rejecting the copied JWT even when a customer cookie is also present. The package is still unpublished.
- On 2026-11-18 GitHub withdrew the [Picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Both the full and production-only online npm audits of the clean Medusa 2.22.2 consumer then reported zero findings using the existing overrides. Chrome and Safari employee login/logout passed on archive F. The local Encvoy front Nginx passed `nginx -t`; production Medusa proxy deployment remains unverified.
- Tested Encvoy runtime: vendor-distributed 3.6.19 images pinned by digest.
- The separate Encvoy GitHub source checkout at version 1.2.0 has upstream backend and widget build errors; do not describe the tested 3.6.19 images as builds of that source.
- Safari 18.6 on macOS 15.7.3 and Chrome 157.0.8103.51 passed customer login/profile/logout/repeat-login and pre-authorized employee Admin login/Orders/logout on archive D `dfbffc858341a000f676acecdcfaf61ce373ae35`, installed in a clean Medusa 2.22.2 consumer on 2026-11-16. On archive F, Chrome and Safari employee login/Admin Orders/logout and post-logout redirect passed on 2026-11-18. Safari redirected direct `/app/orders` navigation to `/app/login` after logout on archive D. Archive A/C results are historical; Firefox, Opera, and Yandex checks are supplementary; Edge is not installed.
- Encvoy customer JWT refresh is disabled; the example sets the session cookie and employee-grant lifetimes to 30 minutes. Customer logout destroys the native session but a copied customer bearer JWT can remain valid until expiry. Admin uses native Medusa session authentication; logout destroys the session and revokes the grant for that login, so a copied employee JWT from the same login is denied on the next Admin request. If the grant store is down, logout fails visibly and the operator can retry or use `src/scripts/revoke-employee.ts`. Neither logout ends Encvoy SSO. Encvoy account blocking alone does not revoke an existing Medusa session/grant. Immediate customer JWT revocation is not implemented.

## Release gate

Before requesting directory inclusion, publish the package with its final license and verified archive contents, complete clean-project installation and browser checks, and confirm the current listing process. Publishing and external submission require explicit user approval.
