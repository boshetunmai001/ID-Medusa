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

- Target Medusa version: 2.22.2. Final local archive D (`dfbffc858341a000f676acecdcfaf61ce373ae35`) was independently installed in a clean consumer with independently resolved dependencies; `npm ci`, full/production audits (zero findings with the documented seven consumer-root overrides), `npm ls`, typecheck, production Backend/Admin build, focused SendGrid merge check, and the full live HTTP acceptance passed. Chrome 157.0.8103.51 and Safari 18.6 customer and employee flows passed on archive D on 2026-11-16. The full HTTP and browser runs preceded the final dependency-only SendGrid override; see the [verification record](verification.md) for this boundary.
- Tested Encvoy runtime: vendor-distributed 3.6.19 images pinned by digest.
- The separate Encvoy GitHub source checkout at version 1.2.0 has upstream backend and widget build errors; do not describe the tested 3.6.19 images as builds of that source.
- Safari 18.6 on macOS 15.7.3 and Chrome 157.0.8103.51 passed customer login/profile/logout/repeat-login and pre-authorized employee Admin login/Orders/logout on final archive D `dfbffc858341a000f676acecdcfaf61ce373ae35`, installed in a clean Medusa 2.22.2 consumer on 2026-11-16. Safari redirected direct `/app/orders` navigation to `/app/login` after logout. Archive A/C results are historical; Firefox, Opera, and Yandex checks are supplementary; Edge is not installed.
- Encvoy customer and employee JWT refresh is disabled; the example sets session-cookie, JWT, and employee-grant lifetimes to 30 minutes. Customer logout destroys the native session but a copied bearer JWT can remain valid until expiry. Admin logout clears only local token storage; a copied employee JWT remains valid until expiry unless its grant is revoked. Neither logout ends Encvoy SSO. Encvoy account blocking alone does not revoke an existing Medusa JWT/grant. For immediate employee revocation, block the Encvoy identity and run `src/scripts/revoke-employee.ts`; the next protected Admin API request is denied. Immediate customer JWT revocation is not implemented.

## Release gate

Before requesting directory inclusion, publish the package with its final license and verified archive contents, complete clean-project installation and browser checks, and confirm the current listing process. Publishing and external submission require explicit user approval.
