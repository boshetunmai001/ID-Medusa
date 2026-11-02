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

- Target Medusa version: 2.22.2. Full live HTTP acceptance passed on 2026-11-02 against a cloned synthetic PostgreSQL test database. The current 0.1.0 archive still needs a fresh clean-project install and smoke test against 2.22.2 before release.
- Tested Encvoy runtime: vendor-distributed 3.6.19 images pinned by digest.
- The separate Encvoy GitHub source checkout at version 1.2.0 has upstream backend and widget build errors; do not describe the tested 3.6.19 images as builds of that source.
- Browser evidence predates the Medusa 2.22.2 dependency update. Chrome and Safari customer login/profile/logout/repeat-login and Safari pre-authorized employee login were recorded; fresh Chrome/Safari checks on 2.22.2 and Safari Admin-menu logout remain open.
- Encvoy customer and employee JWT refresh is disabled; a customer JWT can establish a native session once. Copied JWTs remain usable for direct API calls until their 30-minute expiry; do not promise immediate Encvoy-driven revocation of Medusa JWTs or sessions.

## Release gate

Before requesting directory inclusion, publish the package with its final license and verified archive contents, complete clean-project installation and browser checks, and confirm the current listing process. Publishing and external submission require explicit user approval.
