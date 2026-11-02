# Instructions for AI agents

## Project

This repository is a local prototype of Encvoy ID OIDC authentication for Medusa v2. The reusable provider is in `packages/auth-encvoy`; the runnable Medusa example is in `examples/medusa`. See `llms.txt` for the setup path and `docs/` for the protocol, security, image, and verification details.

The workspace targets Node.js 22.23.3, Medusa 2.22.2, and `openid-client` 6.8.8. Full live HTTP acceptance passed on Medusa 2.22.2 on 2026-11-02 using an isolated clone of the synthetic test database. Vendor-distributed Encvoy 3.6.19 images are pinned by digest; the assignment's literal image version is 1.2, and the user selected the newer tested images. The separate GitHub source checkout at version 1.2.0 does not build cleanly because of upstream backend and widget compile errors. Do not describe the 3.6.19 images as builds of that source.

## Local setup

From the repository root, follow the full, ordered instructions in `README.md` under **Set up the local stand**. In brief:

1. Select Node.js 22.23.3 and install the locked workspace dependencies with `npm ci --legacy-peer-deps --no-audit --no-fund`.
2. Create local environment files with `node scripts/init-local.mjs` and `node scripts/encvoy-image-env.mjs`.
3. Start the loopback Medusa PostgreSQL/Redis services and prepare the pinned Encvoy image stand using `docs/encvoy-image.md`.
4. Provision the local synthetic clients, configure Medusa from `.local/encvoy-image-clients.env`, and start the API as documented in `README.md`.

Use only the documented synthetic `.invalid` identities. Keep `.local/` and `examples/medusa/.env` private; never print, commit, or paste their secrets. Use `localhost` consistently for the browser origin and callbacks.

## Security and changes

- Preserve Authorization Code Flow, S256 PKCE, state, nonce, signature validation, browser-proof binding, and one-time state consumption.
- Keep customer and employee providers separate. Employee access requires an explicit administrator-verified subject binding; never authorize by email or domain and never auto-create an employee.
- Preserve the account collision policy: do not automatically merge or link an existing customer based on email.
- Do not weaken token checks, enable insecure HTTP outside the explicit loopback development option, or log callback URLs, codes, tokens, cookies, or secrets.
- Before any operation that writes a client/business database, first present the exact target and write scope and obtain the user's explicit approval. This includes local integration tests that insert or delete records. Do not treat an existing test command as authorization.
- The old Encvoy source database at `127.0.0.1:55432/encvoy` was the target of an earlier migration incident. Never run source builds or migrations against it. Source-build migrations must use the isolated Compose profile database at `127.0.0.1:55433/encvoy_source`, and still require explicit approval unless verified disposable synthetic data is being used.
- Ask the user before `git push`, deployment, CI that can write data, npm publication, or other external publication. A request to finish local implementation does not authorize those actions.

## Verification evidence

Automated protocol and unit tests, the standard temporary PostgreSQL test cluster, a real HTTP acceptance run, and local build checks are documented in `docs/verification.md`. The latest recorded live HTTP acceptance passed on Medusa 2.22.2. Browser checks are older than that dependency update; Chrome/Safari customer flows and Safari pre-authorized employee login are recorded, while Safari employee-menu logout remains open. Do not claim a fresh browser pass on the current dependency tree.

The package name proposal is `medusa-plugin-encvoy-id`; registry lookup returned 404 when checked, but the package has not been published or reserved. The provider metadata and repository select the MIT License; review ownership before publication. Do not claim a public npm installation, clean-project archive install, public demo, or inclusion in the Medusa integration catalog until those steps have evidence.
