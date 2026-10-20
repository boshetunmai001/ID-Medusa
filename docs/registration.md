# Register the Encvoy applications

The verified local integration provisions clients through Encvoy ID 3.6.19's supported administration API. `scripts/bootstrap-image-clients.mjs` creates two confidential authorization-code clients and three synthetic users, then verifies the client settings and each user through real signed OIDC logins. For the exact local image setup, follow [the image stand guide](encvoy-image.md).

The integration uses separate clients so customer credentials cannot be used for Medusa Admin access:

| Client | Registered redirect URI | Medusa actor |
| --- | --- | --- |
| Customer | `http://localhost:9000/demo/callback` | `customer` |
| Employee | `http://localhost:9000/app/login` | `user` |

Each client is registered with the following values and checked again through Encvoy's API:

| OIDC setting | Required value |
| --- | --- |
| Application domain | `http://localhost:9000` |
| `redirect_uris` | Exactly the single actor-specific URI above |
| `response_types` | `code` only |
| `grant_types` | `authorization_code` only |
| `token_endpoint_auth_method` | `client_secret_basic` |
| Introspection and revocation authentication | `client_secret_basic` |
| `id_token_signed_response_alg` | `RS256` |
| `subject_type` | `public` |

Medusa requests `openid email profile`, uses S256 PKCE, and validates discovery, issuer, audience, nonce, expiry, and the signed ID token. Do not add wildcard redirects, implicit flow, password grant, or dynamic client registration.

To provision the tested local applications after the Encvoy image is healthy, run:

```sh
node scripts/bootstrap-image-clients.mjs
node scripts/configure-medusa.mjs --clients .local/encvoy-image-clients.env
```

The first command stores both client IDs and secrets in the ignored mode-0600 file `.local/encvoy-image-clients.env`; the second writes the Medusa server configuration to the ignored `examples/medusa/.env`. Do not copy secrets into browser variables, tracked files, tickets, chat, or logs. The issuer is `http://localhost:9090` for this local stand and must exactly match discovery.

## Synthetic identities

Only synthetic users with reserved `.invalid` identifiers are created. The login identifier and email are different fields, for example `customer.medusa-encvoy.invalid` and `customer@medusa-encvoy.invalid`; the employee and outsider fixtures follow the same pattern. Their passwords are generated locally to satisfy this release's 8–32 character policy and avoid its rejected hyphen character. Values stay in `.local/encvoy-image-fixtures.env` and are never printed by the provisioning helper.

The local fixture accounts have verified email. Encvoy's default external OAuth profile exposes nickname and picture; the bootstrap opts these synthetic users into only `email`, `email_verified`, `given_name`, and `family_name` through their supported profile API. This permission is set to `publicOauth` and does not enable Gravatar publication. The helper verifies the profile settings and then confirms each subject using a signed Encvoy ID token.

For the employee actor, a Medusa user must still be explicitly bound to the verified Encvoy subject. Encvoy application access or a matching email does not grant Medusa employee permissions. Use the trusted server-side binding steps in the [workspace README](../README.md); never infer a subject from an unverified browser token.

These API settings and results apply to the pinned vendor image digests in this repository. The separate GitHub source snapshot is not a build of that image release. If using a different Encvoy deployment, verify its own registration and claim behavior before using these values.
