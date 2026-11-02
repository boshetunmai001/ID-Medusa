# Project status

Updated: 2026-11-02.

The current workspace targets Medusa **2.22.2** and uses the pinned official Encvoy **3.6.19** images. Full live HTTP acceptance passed on 2.22.2 on 2026-11-02 against a cloned, isolated synthetic PostgreSQL database. Browser-specific smoke checks on this dependency update remain pending. The assignment says ready-made Encvoy images based on 1.2; the user chose the latest version. Report 3.6.19 as the latest image release verified by this project, not as independently confirmed latest overall. This is a local prototype; nothing has been published, pushed, or deployed.

| Stage | Verified result |
| --- | --- |
| Local infrastructure | Medusa on localhost:9000; six isolated Encvoy services healthy on localhost:9090; discovery/JWKS verified |
| Account provisioning | Random root password verified at first seed; Editor password rotated; two confidential clients and three synthetic users created through the real API |
| Customer login | Real authorization code + S256; protected profile; eight concurrent completions return one customer |
| Repeat login and conflicts | Same customer ID and exactly one native customer; existing-email guest refused with HTTP 422 / account_conflict, unchanged |
| Employee login | Verified Encvoy subject explicitly bound to a pre-created Medusa user; real Admin API and Safari Admin access |
| Negative checks | Cancellation, changed state, wrong browser proof, callback/return overrides, replay, customer/Admin separation, unbound staff denial |
| Local logout | Customer session and old cookie invalidated; Encvoy refresh is refused; a copied JWT can still call protected API routes until its 30-minute expiry |
| Safari | Customer logout and repeat login reconfirmed on 2026-11-01; same customer ID returned. Employee menu logout verification pending; browser version not recorded |
| Tests and build | 23 protocol/unit, two Admin browser-request regressions, and two real PostgreSQL tests passed; typechecks, provider build, final full backend/Admin build and package dry-run passed |
| Security/crash audit (2026-11-01, historical) | The first pass found missing Admin response headers and browser request deadlines; both were added and checked on 2026-11-02. Dependency audit stalled in that earlier run; the current result is recorded below. |
| Bootstrap recovery | Missing Editor rotation marker and employee subject recovered; existing client IDs, secrets, fixture passwords and mode 0600 preserved |
| Secret scan and documentation | 17 actual private values checked against 464 shareable files, including 358 frontend assets: zero matches; English docs and private Russian handoff updated |
| Browser target | Firefox customer login/profile/logout (`Unauthorized`)/repeat-login with same customer ID confirmed manually on 2026-10-30; Safari and Chrome customer logout/repeat-login reconfirmed 2026-11-01; both returned the same customer ID. Browser versions and employee-menu logout remain to be recorded; Edge/Yandex excluded at user's request |
| Publication preparation | `medusa-plugin-encvoy-id` returned npm 404 when checked; `npm whoami` returned `ENEEDAUTH`. Local Git remote is `boshetunmai001/ID-Medusa`; authenticated `git ls-remote` can read `main`, but public GitHub/API return 404 and repository write permission is unverified. Package `repository`/`homepage`/`bugs` fields match the configured remote. User deferred final archive build/install pending a separate model audit; no publication |
| Clean archive install | A fresh npm project independently installed a local 0.1.0 tarball and resolved Medusa 2.21.2 dependencies (1,083 installed packages, no workspace symlink); import, typecheck and Medusa production build passed after declaring ts-node 10.9.2 and TypeScript 5.9.3 in the example. This predates the current 2.22.2 dependency tree and must be repeated before release; no npm publication |
| Standard PostgreSQL suite | All 27 tests passed against a temporary PostgreSQL 14.19 cluster under `/tmp`; no project database used |
| Latest real HTTP acceptance | Passed on 2026-11-02 against Encvoy 3.6.19 and Medusa 2.22.2 using a cloned disposable PostgreSQL database; customer/repeat login, one-time session establishment, customer and employee refresh denial, logout, staff authorization, outsider denial, replay/cancellation, concurrency and account-conflict checks passed. |
| Restricted environment rerun (2026-11-02) | Provider/example typechecks, provider build, 10 isolated tests, two new logout regression tests, and package export/pack checks passed. Full tests, PostgreSQL tests, Admin frontend build, clean npm install, and npm audit could not run to completion because this execution environment blocks SysV shared memory, loopback binding, database/Docker sockets, and the configured npm registry proxy. In Safari, an existing synthetic customer logout showed an error although the protected route confirmed the session was gone; repeat Encvoy login returned the same customer ID. The demo source now rechecks session state after ambiguous logout responses; browser validation of the changed build remains pending. |
| npm dependency audit | After clean install and security overrides, `npm audit` reports 0 high, 0 moderate and 6 low findings. Overrides move some Medusa-pinned transitive dependencies outside their declared ranges; typecheck, all 29 tests, Medusa build and full live HTTP acceptance passed. The remaining low finding is in Medusa's SendGrid/`deepmerge` dependency chain; no patched `deepmerge` 4.x release is available. |
| Historical browser check (2026-10-29) | Chrome, Firefox and Opera customer sign-in/profile/logout/repeat-login passed; fixed demo logout's empty-response handling after discovering false error despite successful session destruction. Firefox 159.0 and Opera 139.0.6053.15 (Chromium 155.0.8059.85). Safari customer and pre-authorized employee flows were confirmed earlier; the employee Admin-menu logout and final-archive Chrome/Safari smoke still need a fresh record. Edge/Yandex are excluded at the user's request. |

See [the Russian final checklist](docs/FINAL_CHECKLIST_RU.md) for the current acceptance tasks and their evidence.

## Real compatibility fixes

- The image backend must reach its own canonical localhost issuer. Frontend, backend, OIDC and auth share a Docker network namespace; only Nginx port 9090 is published on loopback.
- Root is initialized with a strong random password before the database seed. The Editor API cannot rotate root, and updating seed environment variables does not change an existing password. The original database and configuration were preserved; the active database is `encvoy_image_secure_seed`, with a separate Redis volume for its sessions.
- Synthetic passwords follow the image's active 8–32 character rules and avoid the hyphen rejected by its stored charset expression. Login identifiers are separate from email because the image forbids `@` in logins.
- By default, the image exposes only nickname/picture to external OAuth clients. Each synthetic user explicitly opts its email, email_verified and name fields into OAuth sharing through its own supported profile API. Gravatar publication is not enabled. The provider still requires a verified email.
- Medusa's JWT SDK overrides request credentials with `omit`, dropping the browser-proof cookie. The custom Admin widget now uses native same-origin fetch for the fixed start/callback POSTs, then the normal SDK for JWT storage and `/admin/users/me`. Safari reproduced the failure and passed after the correction.
- Bootstrap uses private atomic writes and persistent creation intents. User recovery verifies a signed OIDC subject using the saved random fixture password; client recovery uses a nonce and verifies the full registered configuration. Independent review found no remaining material issues after these corrections.

## Evidence boundaries

The real HTTP acceptance script is `scripts/check-live-login.mjs`. Unlike the signed protocol fixture and native Medusa harness, it authenticates through the running Encvoy images. The native harness's earlier successful checks remain useful for API/account/session edge cases, but its locally minted JWTs are not external SSO evidence.

Safari confirmed `/demo/profile` with the same customer ID before and after logout/relogin. Local logout denied protected profile access; selecting the saved Encvoy session allowed reuse without another password. Safari also opened `/app/orders` as the synthetic Test Employee after the Admin cookie correction. Passwords were not saved to Safari.

The separately inspected GitHub commit `5579bf5c05464da48585be28a3863c915b9b704f` has two compile defects. In the ignored local checkout only, adding the referenced `TRUSTED_USER` enum and the missing credentials-provider type guard allowed backend and widget production builds to pass. Those local edits are uncommitted and have no runtime acceptance; the pristine source commit remains broken. Official image release 3.6.19 has no OCI revision label linking it to that source commit. All six imported images were verified against pinned OCI manifests, compressed layers, configs, architecture and rootfs hashes. See `docs/encvoy-image.md` and `docs/encvoy-local.md`.

Local logout does not end the Encvoy SSO session. Encvoy JWT refresh is disabled, but copied Medusa JWTs remain usable for direct API requests until their 30-minute expiry. Encvoy account blocking does not immediately revoke Medusa access. There is no production-readiness claim.

## Local entry points

- Customer: http://localhost:9000/demo
- Staff: http://localhost:9000/app/login
- Encvoy: http://localhost:9090

Private credentials remain in ignored `.local/*.env` and `examples/medusa/.env`. The runtime is `.local/runtime/node_modules/node/bin/node` (22.23.3). The services remain local and running. No push or publication is authorized.
