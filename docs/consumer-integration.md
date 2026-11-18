# Connect Encvoy ID to a Medusa consumer

This guide describes the application work required in addition to installing `medusa-plugin-encvoy-id`. The plugin supplies the Medusa Auth Module Provider and PostgreSQL state store; it does not ship customer routes, request middleware, the Admin login widget, or employee provisioning policy. The runnable reference implementation is under [`examples/medusa`](../examples/medusa).

## 1. Pin the supported runtime and install dependencies

Use Node.js **22.23.5** and Medusa **2.22.2** for the compatibility evidence in this repository. The package declares Node.js **22.23.5 or later within Node 22** as its supported runtime; npm may warn about an unsupported engine without stopping installation. Set `engine-strict=true` in npm configuration if installation must fail outside the declared range. Its peer dependency remains pinned to Medusa 2.22.2 because other Medusa versions have not been verified. Install the package in the consumer project. While the package is unpublished, use the exact local tarball; after publication, install the exact published version and retain its integrity value in the consumer lockfile. The package's `prepack` hook builds `dist/` before creating a tarball.

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

Use [`examples/medusa/medusa-config.ts`](../examples/medusa/medusa-config.ts) as the working configuration. Its environment inputs are `MEDUSA_BROWSER_ORIGIN`, `ENCVOY_ISSUER`, `ENCVOY_CUSTOMER_CLIENT_ID`, `ENCVOY_CUSTOMER_CLIENT_SECRET`, `ENCVOY_USER_CLIENT_ID`, `ENCVOY_USER_CLIENT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and `COOKIE_SECRET`. Set `ADMIN_AUTH_TYPE=session` in the Medusa build and runtime environment, and configure the Encvoy login widget's SDK for session auth. The widget must POST the callback JWT to `/auth/session` with same-origin credentials; `client.setToken()` alone only stores a JWT and does not create the server session. Use HTTPS and secure cookies outside explicit loopback development. Secure deployments use the `__Secure-` prefix for the browser-proof cookie; local HTTP uses an unprefixed development cookie.

## 4. Initialize shared PostgreSQL state

Install the example loader at `src/loaders/encvoy.ts` or call `new EncvoyStateStore(databaseUrl).initialize()` from an equivalent Medusa loader. Give the application database role the permissions needed to create and update the package's state and lock tables/indexes during initialization. All Medusa instances must share the same database; state consumption, concurrency locks, and employee revocation depend on it.

## 5. Add the request and browser middleware

Copy and adapt [`examples/medusa/src/api/middlewares.ts`](../examples/medusa/src/api/middlewares.ts). It is required to:

- restrict provider start and callback routes to same-origin POST requests and the matching actor/provider pair;
- issue a random 32-byte base64url `HttpOnly`, `SameSite=Lax`, `Path=/auth` browser-proof cookie, with `Secure` outside local HTTP development, and pass it through to the provider;
- set no-store/referrer protections and prevent callback query strings and credentials from entering access logs;
- require a completed customer identity before creating the native Medusa session, consume the customer callback JWT once, and deny refresh for Encvoy JWTs;
- check the signed employee login ID against the shared PostgreSQL grant registry on each `/admin` request, failing closed if the registry cannot be checked;
- exchange the employee callback JWT for a Medusa Admin session; on `DELETE /auth/session`, revoke that session's exact employee grant before destroying the session, returning an error rather than reporting logout success if revocation storage is unavailable;
- block native registration paths that would bypass the explicit verified-email/conflict policy.

Do not enable the provider without this middleware or an equivalent implementation reviewed against the same requirements.

The provided automatic grant check covers `/admin/**`. For any custom route outside `/admin` that accepts a Medusa `user`, add `activeEncvoyEmployeeRouteMiddlewares()` to the route's middleware list in the existing `src/api/middlewares.ts` file. Medusa loads that file's default `defineMiddlewares` export; a separate named `export const middlewares` is not discovered:

```ts
import { defineMiddlewares } from "@medusajs/framework/http"
import { activeEncvoyEmployeeRouteMiddlewares } from "../lib/employee-auth"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/internal/report",
      middlewares: [...activeEncvoyEmployeeRouteMiddlewares()],
    },
  ],
})
```

When `src/api/middlewares.ts` already has a default `defineMiddlewares` export, add this route object to its existing `routes` array instead of creating a second default export.

The Encvoy start and callback endpoints require proxy rate limiting in production. Include `infra/medusa-auth-rate-limit-http.nginx.conf` once from Nginx's `http {}` block, then include `infra/medusa-auth-rate-limit-location.nginx.conf` inside the existing proxy location(s) for `/auth/customer/encvoy-customer`, `/auth/customer/encvoy-customer/callback`, `/auth/user/encvoy-user`, and `/auth/user/encvoy-user/callback`. The sample uses a shared limit of 20 requests per minute and burst 10 per client IP; adjust this for expected traffic and NAT usage. If another trusted proxy sits in front of Nginx, configure real client IP handling only for that proxy.

Production Admin is served outside Medusa API middleware. Include `infra/medusa-admin-security-headers.nginx.conf` inside both Nginx locations that serve `/app` and `/app/…` so the production Admin receives anti-framing, MIME-sniffing, and referrer headers. The example's Vite hook covers development only; verify the headers through the production proxy after deployment.

For request-level operational logs, include `infra/medusa-safe-access-log-http.nginx.conf` once in `http {}` and `infra/medusa-safe-access-log-location.nginx.conf` in the Medusa API/Admin proxy locations. The format records `$uri` (path without query arguments), method, status, response size, duration, request ID, and client IP; it deliberately omits raw request lines, query strings, headers, and referrers. Apply an appropriate access and retention policy because client IPs are included.

## 6. Implement customer callback, provisioning, profile, and logout

The customer callback page reads `code`, `state`, `iss`, or `error` once, immediately removes the query string from browser history, then POSTs the callback values to Medusa. After successful OIDC authentication, the browser calls `POST /encvoy/customer/complete`; only after that endpoint returns a linked customer may it call `POST /auth/session` to establish Medusa's native session. The protected profile is `GET /encvoy/profile`; local logout is `DELETE /auth/session`. In the example this destroys the native session and clears the cookie, but a copied customer bearer JWT remains usable on routes that accept it until its 30-minute expiry. JWT refresh is disabled. Logout also leaves the separate Encvoy SSO session active, so a new login may not require another password.

Implement the callback page and its script from [`demo-html.ts`](../examples/medusa/src/lib/demo-html.ts), the routes under [`src/api/demo`](../examples/medusa/src/api/demo), the completion route [`src/api/encvoy/customer/complete/route.ts`](../examples/medusa/src/api/encvoy/customer/complete/route.ts), and profile route [`src/api/encvoy/profile/route.ts`](../examples/medusa/src/api/encvoy/profile/route.ts).

Provision through Medusa's native customer workflow as shown in [`customer-account.ts`](../examples/medusa/src/lib/customer-account.ts). Require `email_verified === true`, normalize the email, serialize concurrent provisioning, and refuse every existing-email collision, including guest accounts. Do not merge, overwrite, or link an existing customer by email. If the consumer permits another registration path, apply the same collision policy there.

## 7. Add the Admin widget and explicitly bind employees

Install the widget at `src/admin/widgets/encvoy-login.tsx` and its same-origin browser helper at `src/admin/lib/encvoy-browser-auth.ts`, adapting [`examples/medusa/src/admin`](../examples/medusa/src/admin). The widget sends only the fixed Encvoy start/callback requests and explicitly POSTs the resulting Medusa JWT to `/auth/session` to establish a server-side Medusa session; `client.setToken()` does not perform this exchange. Native Admin logout then calls the server, revokes the specific employee grant, and destroys the session. The example still permits bearer tokens for API clients; those are rejected after their grant is revoked or they expire.

An employee must first exist as a Medusa user. A trusted operator must independently verify the Encvoy issuer and subject, then create the explicit AuthIdentity binding using [`allow-employee.ts`](../examples/medusa/src/scripts/allow-employee.ts). The command refuses to replace a different binding. Never create or authorize an employee automatically from an email or domain match. In the example, the Admin session and employee grant expire after 30 minutes. Admin logout asks Medusa to destroy the session and revokes the associated grant, so a copied bearer JWT from that login is denied on its next protected request. If the shared store is unavailable, logout returns an error and leaves the session intact rather than claiming the grant was revoked. Blocking the account in Encvoy alone does not revoke an already-issued Medusa session or grant. For immediate offboarding, block the Encvoy account and revoke active Medusa grants with [`revoke-employee.ts`](../examples/medusa/src/scripts/revoke-employee.ts); the next protected Admin API request using a revoked token is denied. This revocation does not end Encvoy SSO or remove the Medusa identity binding. If future login must remain disabled after the Encvoy account is unblocked, remove/disable that binding through the consumer's trusted administration procedure.

The identity key includes the exact issuer and client ID. Rotating either value changes every identity key. Keep the old provider configuration available during a planned rotation, verify old-to-new subject mappings with an administrator, and prepare a reviewed rebind migration for each account. Do not match or migrate identities by email alone. The package does not perform this migration automatically.

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

On 2026-11-18 GitHub withdrew the [Picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf). Both the full and production-only online npm audits of the clean Medusa 2.22.2 consumer then reported zero findings using the existing overrides.
