# Instructions for AI agents

## Project

This repository is a local prototype of Encvoy ID OIDC authentication for Medusa v2. The reusable provider is in `packages/auth-encvoy`; the runnable Medusa example is in `examples/medusa`. See `llms.txt` for the setup path and `docs/` for the protocol, security, image, and verification details.

The workspace targets Node.js 22.23.5, Medusa 2.22.2, and `openid-client` 6.8.8. The local Encvoy 3.6.19 stand uses a pinned PostgreSQL 16.16 image and separate data volume. The three-page assignment PDF available with the handoff specifies images based on 1.2; the reviewer refers to another edition naming 3.6.19, whose file was not available for comparison. Runtime evidence is from vendor-distributed 3.6.19 images pinned by digest. It is not a verified build of the separate GitHub source checkout labeled 1.2.0 and does not establish compatibility with 1.2 images. Keep those distinctions explicit.

## Local setup

From the repository root, follow the full, ordered instructions in `README.md` under **Set up the local stand**. In brief:

1. Select Node.js 22.23.5 and install the locked workspace dependencies with `npm ci --legacy-peer-deps --no-audit --no-fund`.
2. Create local environment files with `node scripts/init-local.mjs` and `node scripts/encvoy-image-env.mjs`.
3. Start the loopback Medusa PostgreSQL/Redis services and prepare the pinned Encvoy image stand using `docs/encvoy-image.md`.
4. Provision the local synthetic clients, configure Medusa from `.local/encvoy-image-clients.env`, and start the API as documented in `README.md`.

Use only the documented synthetic `.invalid` identities. Keep `.local/` and `examples/medusa/.env` private; never print, commit, or paste their secrets. Use `localhost` consistently for the browser origin and callbacks.

## Security and changes

- Preserve Authorization Code Flow, S256 PKCE, state, nonce, signature validation, browser-proof binding, and one-time state consumption.
- Keep customer and employee providers separate. Employee access requires an explicit administrator-verified subject binding; never authorize by email or domain and never auto-create an employee.
- Preserve the account collision policy: do not automatically merge or link an existing customer based on email.
- Be precise about sessions: local logout does not terminate Encvoy SSO. In the example, a copied customer bearer JWT can last to its 30-minute expiry; employee JWTs can also last that long unless their PostgreSQL grant is revoked. Blocking an employee in Encvoy alone does not revoke a Medusa JWT/grant. The trusted employee offboarding procedure blocks Encvoy and runs `examples/medusa/src/scripts/revoke-employee.ts`; immediate customer JWT revocation is not implemented. See `docs/security.md`.
- Do not weaken token checks, enable insecure HTTP outside the explicit loopback development option, or log callback URLs, codes, tokens, cookies, or secrets.
- Before any operation that writes a client/business database, first present the exact target and write scope and obtain the user's explicit approval. This includes local integration tests that insert or delete records. Do not treat an existing test command as authorization.
- The old Encvoy source database at `127.0.0.1:55432/encvoy` was the target of an earlier migration incident. Never run source builds or migrations against it. Source-build migrations must use the isolated Compose profile database at `127.0.0.1:55433/encvoy_source`, and still require explicit approval unless verified disposable synthetic data is being used.
- Ask the user before `git push`, deployment, CI that can write data, npm publication, or other external publication. A request to finish local implementation does not authorize those actions.

## Verification evidence

Automated protocol and unit tests, the standard temporary PostgreSQL test cluster, a real HTTP acceptance run, and local build checks are documented in `docs/verification.md`. On 2026-11-16, final local archive D SHA-1 `dfbffc858341a000f676acecdcfaf61ce373ae35` passed clean-consumer install/audit/typecheck/build and the complete live HTTP acceptance suite, including refusal to create a session before customer account completion and immediate employee grant revocation. On 2026-11-16, Chrome 157.0.8103.51 and Safari 18.6 on macOS 15.7.3 passed customer and employee flows on archive D. On archive F, Chrome employee login/Admin Orders/logout and the post-logout redirect passed 2026-11-18; Safari employee login/Admin Orders/logout and post-logout redirect passed on archive F on 2026-11-18. The running Encvoy front Nginx passed `nginx -t`; Medusa Nginx snippets were checked on a disposable local proxy, while a production Medusa proxy is not deployed in this stand. Published-version installation remains a post-publication check; public npm lookup returns 404 and npm auth is unavailable.

The clean-consumer sequence is `npm ci`, `npm audit`, `npm audit --omit=dev`, `npm ls --depth=0`, `npm explain deepmerge`, `npm run typecheck`, then `npm run build` (production Backend/Admin). In the workspace, build the provider first with `npm run build`, then run `npm run typecheck`; see `README.md` and `docs/consumer-integration.md` for the complete sequences. Chrome and Safari checks on archive D are historical. Chrome and Safari employee flows on archive F passed. The handoff PDF specifies Encvoy 1.2 images, while the reviewer refers to a separate edition specifying 3.6.19. Tests use vendor 3.6.19 images; no 1.2 image compatibility claim is established.

The package name proposal is `medusa-plugin-encvoy-id`; the package has not been published or reserved. A local 0.1.0 tarball has been independently installed and HTTP-tested in a clean Medusa 2.22.2 consumer project; see `docs/verification.md`. The provider metadata and repository select the MIT License; review ownership before publication. Do not claim a public npm installation, public demo, or inclusion in the Medusa integration catalog until those steps have evidence.
