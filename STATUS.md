# Project status

Updated: 2026-10-08.

The local Encvoy ID integration works against the pinned official Encvoy **3.6.19** images and Medusa **2.21.2**. Real customer and pre-authorized employee OIDC login passed HTTP acceptance and Safari. This is a local prototype; nothing has been published, pushed, or deployed.

| Stage | Verified result |
| --- | --- |
| Local infrastructure | Medusa on localhost:9000; six isolated Encvoy services healthy on localhost:9090; discovery/JWKS verified |
| Account provisioning | Random root password verified at first seed; Editor password rotated; two confidential clients and three synthetic users created through the real API |
| Customer login | Real authorization code + S256; protected profile; eight concurrent completions return one customer |
| Repeat login and conflicts | Same customer ID and exactly one native customer; existing-email guest refused with HTTP 422 / account_conflict, unchanged |
| Employee login | Verified Encvoy subject explicitly bound to a pre-created Medusa user; real Admin API and Safari Admin access |
| Negative checks | Cancellation, changed state, wrong browser proof, callback/return overrides, replay, customer/Admin separation, unbound staff denial |
| Local logout | Customer session and old cookie invalidated; Safari protected page returns Unauthorized; retained JWT can still refresh |
| Safari | Customer login/profile/logout/repeat and employee Admin login passed; employee menu logout verification pending |
| Tests and build | 23 protocol/unit, two Admin browser-request regressions, and two real PostgreSQL tests passed; typechecks, provider build, final full backend/Admin build and package dry-run passed |
| Bootstrap recovery | Missing Editor rotation marker and employee subject recovered; existing client IDs, secrets, fixture passwords and mode 0600 preserved |
| Secret scan and documentation | 17 actual private values checked against 464 shareable files, including 358 frontend assets: zero matches; English docs and private Russian handoff updated |

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

The separately inspected GitHub commit `5579bf5c05464da48585be28a3863c915b9b704f` still fails backend/widget compilation because of upstream missing symbols. Official image release 3.6.19 has no OCI revision label linking it to that source commit. All six imported images were verified against pinned OCI manifests, compressed layers, configs, architecture and rootfs hashes. See `docs/encvoy-image.md` and `docs/encvoy-local.md`.

Local logout does not end the Encvoy SSO session. Copied Medusa JWTs can remain usable until expiry and can be refreshed without consulting Encvoy; the 30-minute lifetime is not a maximum total access duration. Encvoy account blocking does not immediately revoke Medusa access. There is no production-readiness claim.

## Local entry points

- Customer: http://localhost:9000/demo
- Staff: http://localhost:9000/app/login
- Encvoy: http://localhost:9090

Private credentials remain in ignored `.local/*.env` and `examples/medusa/.env`. The runtime is `.local/runtime/node_modules/node/bin/node` (22.23.3). The services remain local and running. No push or publication is authorized.
