# Connect Encvoy ID to a Medusa consumer

This guide describes the application work required in addition to installing `medusa-plugin-encvoy-id`. The plugin supplies the Medusa Auth Module Provider and PostgreSQL state store; it does not ship customer routes, request middleware, the Admin login widget, or employee provisioning policy. The runnable reference implementation is under [`examples/medusa`](../examples/medusa).

## 1. Pin the supported runtime and install dependencies

Use Node.js **22.23.5** and Medusa **2.22.2** for the compatibility evidence in this repository. Install the package in the consumer project. While the package is unpublished, use the exact local tarball; after publication, install the exact published version and retain its integrity value in the consumer lockfile.

```sh
npm install ./medusa-plugin-encvoy-id-0.1.0.tgz
```

The publisher's root npm overrides do not propagate through a dependency. npm only resolves overrides from the root `package.json` of the project performing installation. The tested Medusa 2.22.2 consumer used:

```json
{
  "overrides": {
    "@graphql-tools/utils": "12.1.0",
    "ajv": "8.18.0",
    "bullmq": "5.81.5",
    "glob": "14.0.3",
    "lodash": "4.18.1",
    "minimatch": "11.0.4",
    "@sendgrid/helpers": {
      "deepmerge": "4.1.2"
    }
  }
}
```

These are root-project choices, not package requirements. The deepmerge pin is scoped only under `@sendgrid/helpers` and sets 4.1.2, below that package's declared `^4.2.2` range; it was selected because the GHSA reports the affected range as 4.2.0–4.3.1. The same-major SendGrid merge path was smoke-tested against this pin. Review all overrides against the consumer's full dependency tree, add them to its root manifest if adopting this tested resolution, then run `npm install` and commit the generated lockfile. npm's [override documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides) confirms that overrides in installed dependencies are ignored.

## 2. Register two Encvoy OIDC clients

Create separate confidential authorization-code clients for customer and employee identities. Keep the client secrets server-side. Register only the exact callbacks used by the consumer:

| Actor | Medusa provider ID | Callback URI |
| --- | --- | --- |
| Customer | `encvoy-customer` | `https://store.example/demo/callback` |
| Employee | `encvoy-user` | `https://store.example/app/login` |

Use the same trusted issuer and exact browser origin in the Medusa configuration. Request `openid email profile`; customer provisioning additionally requires a verified email. Never use email or email domain as the identity key or as proof that a person may enter Admin.

## 3. Configure both Medusa provider instances

Add both provider instances under `@medusajs/medusa/auth`, with separate client IDs and secrets, `actorType: "customer"` / `"user"`, fixed callback URLs, the exact browser origin, and the shared PostgreSQL connection. Configure `http.authMethodsPerActor` so customers can use only `encvoy-customer` and users can use only `encvoy-user`. Set JWT expiry to the employee-grant lifetime (the example uses 30 minutes).

Use [`examples/medusa/medusa-config.ts`](../examples/medusa/medusa-config.ts) as the working configuration. Its environment inputs are `MEDUSA_BROWSER_ORIGIN`, `ENCVOY_ISSUER`, `ENCVOY_CUSTOMER_CLIENT_ID`, `ENCVOY_CUSTOMER_CLIENT_SECRET`, `ENCVOY_USER_CLIENT_ID`, `ENCVOY_USER_CLIENT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and `COOKIE_SECRET`. Use HTTPS and secure cookies outside explicit loopback development.

## 4. Initialize shared PostgreSQL state

Install the example loader at `src/loaders/encvoy.ts` or call `new EncvoyStateStore(databaseUrl).initialize()` from an equivalent Medusa loader. Give the application database role the permissions needed to create and update the package's state and lock tables/indexes during initialization. All Medusa instances must share the same database; state consumption, concurrency locks, and employee revocation depend on it.

## 5. Add the request and browser middleware

Copy and adapt [`examples/medusa/src/api/middlewares.ts`](../examples/medusa/src/api/middlewares.ts). It is required to:

- restrict provider start and callback routes to same-origin POST requests and the matching actor/provider pair;
- issue a random 32-byte base64url `HttpOnly`, `SameSite=Lax`, `Path=/auth` browser-proof cookie, with `Secure` outside local HTTP development, and pass it through to the provider;
- set no-store/referrer protections and prevent callback query strings and credentials from entering access logs;
- require a completed customer identity before creating the native Medusa session, consume the customer callback JWT once, and deny refresh for Encvoy JWTs;
- check the signed employee login ID against the shared PostgreSQL grant registry on each `/admin` request, failing closed if the registry cannot be checked;
- block native registration paths that would bypass the explicit verified-email/conflict policy.

Do not enable the provider without this middleware or an equivalent implementation reviewed against the same requirements.

## 6. Implement customer callback, provisioning, profile, and logout

The customer callback page reads `code`, `state`, `iss`, or `error` once, immediately removes the query string from browser history, then POSTs the callback values to Medusa. After successful OIDC authentication, the browser calls `POST /encvoy/customer/complete`; only after that endpoint returns a linked customer may it call `POST /auth/session` to establish Medusa's native session. The protected profile is `GET /encvoy/profile`; local logout is `DELETE /auth/session`. In the example this destroys the native session and clears the cookie, but a copied customer bearer JWT remains usable on routes that accept it until its 30-minute expiry. JWT refresh is disabled. Logout also leaves the separate Encvoy SSO session active, so a new login may not require another password.

Implement the callback page and its script from [`demo-html.ts`](../examples/medusa/src/lib/demo-html.ts), the routes under [`src/api/demo`](../examples/medusa/src/api/demo), the completion route [`src/api/encvoy/customer/complete/route.ts`](../examples/medusa/src/api/encvoy/customer/complete/route.ts), and profile route [`src/api/encvoy/profile/route.ts`](../examples/medusa/src/api/encvoy/profile/route.ts).

Provision through Medusa's native customer workflow as shown in [`customer-account.ts`](../examples/medusa/src/lib/customer-account.ts). Require `email_verified === true`, normalize the email, serialize concurrent provisioning, and refuse every existing-email collision, including guest accounts. Do not merge, overwrite, or link an existing customer by email. If the consumer permits another registration path, apply the same collision policy there.

## 7. Add the Admin widget and explicitly bind employees

Install the widget at `src/admin/widgets/encvoy-login.tsx` and its same-origin browser helper at `src/admin/lib/encvoy-browser-auth.ts`, adapting [`examples/medusa/src/admin`](../examples/medusa/src/admin). The widget sends only the fixed Encvoy start/callback requests and stores the resulting Medusa JWT through the Medusa SDK.

An employee must first exist as a Medusa user. A trusted operator must independently verify the Encvoy issuer and subject, then create the explicit AuthIdentity binding using [`allow-employee.ts`](../examples/medusa/src/scripts/allow-employee.ts). The command refuses to replace a different binding. Never create or authorize an employee automatically from an email or domain match. In the example, Admin JWTs and employee grants expire after 30 minutes. Admin logout clears only the current browser's token storage; a copied JWT may keep working until expiry. Blocking the account in Encvoy does not revoke an already-issued Medusa JWT or its grant. For immediate offboarding, block the Encvoy account and revoke active Medusa grants with [`revoke-employee.ts`](../examples/medusa/src/scripts/revoke-employee.ts); the next protected Admin API request using a revoked token is denied. This revocation does not end Encvoy SSO or remove the Medusa identity binding. If future login must remain disabled after the Encvoy account is unblocked, remove/disable that binding through the consumer's trusted administration procedure.

## 8. Audit, build, and validate the consumer application

From the consumer root, install independently and inspect the resolved dependency tree. Keep any remaining audit findings visible; do not use `--force`, blanket audit ignores, or unreviewed version substitutions to make the report green.

```sh
npm ci
npm audit
npm audit --omit=dev
npm ls --depth=0
npm explain deepmerge
npm run typecheck
npm run build
```

Then verify customer and employee login, protected profile, repeat login and logout; denial for an unbound employee; existing-customer/guest email conflict without takeover; callback replay rejection; and employee grant revocation. Run browser checks on the final production build. Install and check the exact tarball, and after release repeat the install/audit/build checks against the exact published version. A workspace link does not constitute package-install evidence.

## Compatibility and dependency finding

The exact final tarball was independently installed in a clean Medusa 2.22.2 consumer with these seven overrides. On 2026-11-16, clean `npm ci`, `npm ls --depth=0`, typecheck, and production Backend/Admin build passed. Full and production `npm audit` both report zero findings. A focused SendGrid compatibility check constructed a `Personalization`, deep-merged nested dynamic-template data with `deepmerge@4.1.2`, and produced the same result as the baseline `deepmerge@4.3.1`.

At review time GitHub lists [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) as Low for `deepmerge` 4.2.0–4.3.1 and lists no patched version. The linked CVE-2026-93753 was subsequently [rejected by the CVE authority](https://www.cve.org/CVERecord?id=CVE-2026-93753), but npm audit continued to report the GHSA. The scoped consumer override selects 4.1.2 only beneath `@sendgrid/helpers`, outside that affected range; independent full and production audits now report zero findings. Because 4.1.2 is below `@sendgrid/helpers`' declared `^4.2.2` range, compatibility was checked with `npm ci`, full `npm ls --all`, Medusa typecheck/build, and a representative SendGrid dynamic-template merge. `npm explain deepmerge` identifies the override and the upstream range it supersedes. Recheck on upgrades. Full rationale and test evidence are in [security.md](security.md) and [verification.md](verification.md).
