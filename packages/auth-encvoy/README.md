# Medusa Encvoy ID auth provider

`medusa-plugin-encvoy-id` is a Medusa Auth Module Provider for Encvoy ID over OpenID Connect. Version 0.1.0 targets Medusa **2.22.2**, Node.js **22.23.5**, and `openid-client` **6.8.8**. The final local tarball was independently installed in a clean consumer and passed install, typecheck, production build, and full live HTTP acceptance, including employee JWT revocation, on 2026-11-16. After a dependency-only consumer override to `deepmerge@4.1.2`, full and production audits returned zero findings; clean install, `npm ls --depth=0`, typecheck, production Backend/Admin build, and a SendGrid merge smoke check passed. The full HTTP and Chrome/Safari flows on archive D predate this dependency-only override; the Encvoy provider does not call SendGrid. The package remains unpublished. See the [verification record](https://github.com/boshetunmai001/ID-Medusa/blob/main/docs/verification.md) for the current artifact hash and exact evidence. The MIT license is included in this package: [LICENSE](./LICENSE).

## Installation

Install the provider in a Medusa v2 project:

```sh
npm install medusa-plugin-encvoy-id
```

### Dependency audit

The package does not transfer the publisher workspace's npm `overrides` to your project. In a clean Medusa 2.22.2 consumer project, the 2026-11-13 audit reported 83 findings without overrides (14 high, 65 moderate, 4 low). The six Medusa dependency overrides below reduced that to six Low nodes in the Medusa/SendGrid/`deepmerge` chain. A seventh override to `deepmerge@4.1.2` places the installed version below GHSA-gcqx-w48m-w2h4's affected range; full and production audits then report zero findings.

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

Why these versions are selected: `@graphql-tools/utils@12.1.0` resolves two GraphQL Tools prototype-pollution advisories; `ajv@8.18.0` resolves the `$data` ReDoS advisory; `bullmq@5.81.5` moves Medusa's Redis queue beyond the vulnerable BullMQ range; the scoped `@sendgrid/helpers → deepmerge@4.1.2` override selects the latest published version below GHSA-gcqx-w48m-w2h4's affected range, which starts at 4.2.0; `glob@14.0.3` resolves the glob cancellation issue and selects a fixed minimatch dependency; `lodash@4.18.1` resolves the template code-injection and array-path prototype-pollution advisories; `minimatch@11.0.4` resolves the globparts amplification DoS advisory. The deepmerge pin is below `@sendgrid/helpers`' declared `^4.2.2` range, so it is a deliberate compatibility override and must be retested on upgrades. `npm explain deepmerge` makes the superseded range visible; `npm ls --all` succeeds in the tested clean consumer. The workspace audit without these overrides reported the corresponding high/moderate findings. These are top-level npm overrides, and several selected versions exceed ranges declared by Medusa 2.22.2 or its transitive packages. The consumer checks below establish compatibility for this exact Medusa version and project; they do not guarantee compatibility with other Medusa versions or application-specific plugins.

Before the `deepmerge@4.1.2` override, the six remaining npm findings were package nodes on one path: Medusa → `@medusajs/notification-sendgrid` → `@sendgrid/mail` → `@sendgrid/helpers` → `deepmerge@4.3.1`. GitHub still lists Low advisory [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) for 4.2.0–4.3.1 with no patched version, even though the linked CVE-2026-93753 was [rejected by the CVE authority](https://www.cve.org/CVERecord?id=CVE-2026-93753). The audit report did not disappear when the CVE was rejected. The consumer now resolves `deepmerge@4.1.2`, outside the GHSA's affected range, and full/production audits report zero findings. This example does not configure SendGrid. The tested SendGrid `Personalization` merge operation produced the same nested merge output on 4.1.2 as on 4.3.1, and Medusa typecheck/production build passed. Keep the override scoped to the consumer root, and recheck both SendGrid helper compatibility and current advisory ranges before upgrades.

These versions were checked in an independently installed Medusa 2.22.2 consumer: `npm ci`, full and production audits with zero findings, top-level `npm ls --depth=0`, typecheck, Backend/Admin production build, and a SendGrid `Personalization` nested data merge check passed. Full Encvoy HTTP acceptance passed on the same package archive before the deepmerge-only override; the provider does not call SendGrid. The overrides are consumer-project configuration and must be reviewed and added there; installing this plugin does not apply them. Run `npm audit` in your own project after installation and recheck the dependency tree when upgrading Medusa or SendGrid.

## Complete integration sequence

For a more detailed, ordered consumer checklist with the exact callback/session route sequence and source file mapping, see the [consumer integration guide](https://github.com/boshetunmai001/ID-Medusa/blob/main/docs/consumer-integration.md).

The provider package supplies the OIDC provider and PostgreSQL state store. The customer browser flow, security middleware, profile/completion endpoints, and employee Admin widget are application code and must also be installed. Use the [Medusa example](https://github.com/boshetunmai001/ID-Medusa/tree/main/examples/medusa) as the reference implementation; adapt and review each item below before enabling login.

1. **Install and pin dependencies.** Use Medusa 2.22.2, Node.js 22.23.5, and install `medusa-plugin-encvoy-id`. Add the seven overrides above to the consuming app's root `package.json` only after reviewing their compatibility. Run `npm install` to create that app's lockfile. Do not expect the plugin to change its dependencies.
2. **Register Encvoy clients.** Create separate confidential OIDC clients for customers and staff. Configure the exact issuer and fixed redirect URIs for the customer callback page and the Admin login callback. Keep both client secrets server-side. Set the requested scopes/claims according to your Encvoy policy; identity is keyed by verified issuer, subject, client ID, and actor type, never by email.
3. **Configure Medusa.** Register two provider instances with IDs `encvoy-customer` and `encvoy-user`, correct `actorType`, issuer, client credentials, exact callback URI, browser origin, and the shared PostgreSQL `DATABASE_URL`. Set `http.authMethodsPerActor` to allow `encvoy-customer` only for customers and `encvoy-user` only for users. See [`medusa-config.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/medusa-config.ts).
4. **Initialize persistent state.** Call `new EncvoyStateStore(DATABASE_URL).initialize()` from a Medusa loader, as in [`src/loaders/encvoy.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/loaders/encvoy.ts). The runtime DB role needs create/update permissions for the package's state and lock tables and indexes during initialization. Keep the state database shared across app instances. State expires after five minutes and is single-use.
5. **Add browser and request security middleware.** Copy/adapt [`middlewares.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/api/middlewares.ts): require same-origin POST for login start/callback/session changes, set no-store and no-referrer headers, create a random 32-byte HttpOnly/SameSite=Lax browser proof cookie, and pass it to the provider. For `encvoy-user`, also authenticate the supplied Admin JWT and check its signed `encvoy_login_id` against `EncvoyStateStore.isEmployeeGrantActive` on every `/admin` request. Restrict provider/actor combinations and disable alternate registration or automatic account-linking endpoints. Redact callback query strings and credentials from proxy and application logs.
6. **Implement the customer callback and account completion.** Provide a browser page that reads the OIDC callback once, removes the query string from browser history, and POSTs code/state/issuer or cancellation to `/auth/customer/encvoy-customer/callback`. After successful authentication, call a same-origin customer completion endpoint. Require verified email and use Medusa's native customer-creation workflow with an explicit existing-account conflict policy; never attach an existing customer by email alone. See [`demo-html.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/lib/demo-html.ts), [`customer-account.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/lib/customer-account.ts), and [`complete/route.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/api/encvoy/customer/complete/route.ts).
7. **Add the staff login UI and allowlist binding.** Install the Admin login widget and its same-origin browser helper from [`encvoy-login.tsx`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/admin/widgets/encvoy-login.tsx) and [`encvoy-browser-auth.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/admin/lib/encvoy-browser-auth.ts). Create a Medusa user through a trusted admin process, independently verify staff identity, then bind that existing user to the exact Encvoy issuer and subject using [`allow-employee.ts`](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/scripts/allow-employee.ts). Do not auto-create or authorize employees by matching email.
8. **Review logout and revocation.** In the example, session cookies, customer/employee JWTs, and employee grants have a 30-minute lifetime; Encvoy JWT refresh is disabled. Customer logout destroys the native Medusa session but a copied customer bearer JWT may continue to work on routes that accept it until its `exp`. Admin logout clears only the current browser's SDK token storage; a copied employee JWT may continue to work until expiry while its grant remains active. Neither logout ends the separate Encvoy SSO session, so a repeat login may complete without another password. Blocking an employee in Encvoy does not revoke an existing Medusa JWT/grant. For immediate offboarding, block the Encvoy account and run the example's `src/scripts/revoke-employee.ts` with the verified Medusa user ID; the next protected Admin API request using any revoked JWT is denied. This command does not end Encvoy SSO or remove the Medusa identity binding. Remove/disable the binding through trusted administration if future login must remain disabled. See the [security model and operational procedure](https://github.com/boshetunmai001/ID-Medusa/blob/main/docs/security.md#immediate-employee-revocation).
9. **Verify the consumer app.** In the consumer project, run `npm audit`, `npm ls --depth=0`, `npm explain deepmerge`, typecheck, backend/Admin production build, and the customer/staff login, repeat login, logout, unbound employee, existing-account conflict, and callback replay scenarios. Test the final built app in the supported browsers. Repeat against the exact packed or published package artifact; a workspace link is not package-install evidence.

Configure two provider instances, one for each Medusa actor. Keep client secrets and the PostgreSQL connection string on the server. The example configuration and required browser middleware are in the [Medusa example](https://github.com/boshetunmai001/ID-Medusa/tree/main/examples/medusa).

`employeeGrantLifetimeSeconds` defaults to 1800 seconds. Configure it no shorter than the consumer's `http.jwtExpiresIn`, so the registry does not reject an otherwise-valid employee JWT early. Longer grants do not extend the signed JWT lifetime.

```ts
modules: [{
  resolve: "@medusajs/medusa/auth",
  options: {
    providers: [
      { resolve: "medusa-plugin-encvoy-id", id: "encvoy-customer", options: customerOptions },
      { resolve: "medusa-plugin-encvoy-id", id: "encvoy-user", options: employeeOptions },
    ],
  },
}],
```

Set `http.authMethodsPerActor` so customers can use only `encvoy-customer` and employees only `encvoy-user`. Use distinct confidential Encvoy clients and exact callback URLs for each actor.

The default export is a native `ModuleProvider(Modules.AUTH, ...)`.

Required options:

| Option | Meaning |
| --- | --- |
| `actorType` | `customer` or `user` |
| `issuer` | Exact trusted OIDC issuer |
| `clientId`, `clientSecret` | Confidential client credentials, server only |
| `callbackUrl` | Exact fixed browser callback URI |
| `browserOrigin` | Exact permitted browser origin |
| `databaseUrl` | Shared PostgreSQL connection for state and locks |
| `allowInsecureLocalhost` | Optional explicit development-only HTTP permission; defaults false |
| `cookieName` | Optional browser proof cookie name; defaults per actor |

## Troubleshooting

- **`provider_unavailable`:** verify that the configured issuer exactly matches the issuer in its OIDC discovery document and that Medusa can reach the discovery and JWKS endpoints.
- **`login_expired`:** restart login in the same browser. State is short-lived, single-use, and bound to the initiating browser's proof cookie.
- **`not_authorized` for an employee:** bind the verified Encvoy issuer and subject to an existing Medusa user through a trusted server-side process. Email matching does not grant employee access.
- **State-store initialization fails:** the runtime database role needs permission to create and update the package's two state tables and indexes. PostgreSQL is required for atomic state consumption and concurrency locks.
- **The callback is rejected:** send it as a same-origin POST with the browser-proof cookie. Use exact configured callback URLs and do not override callback or return URLs from the browser.

Call `new EncvoyStateStore(databaseUrl).initialize()` from an application loader. It creates the small state tables idempotently. The runtime DB user needs the relevant DDL permission during this initialization. State has a five-minute lifetime and is atomically consumed with browser and client/actor context binding.

The package intentionally requires application middleware. For native `/auth/{actor}/encvoy-{actor}` and its `/callback` endpoint, require POST and the configured Origin. Before initiating login, create an unpredictable 32-byte base64url browser proof cookie with HttpOnly, SameSite=Lax, Path=/auth, and Secure outside explicit local HTTP development. Pass that cookie to the provider through native request headers. Never synthesize the proof from user-controlled request data. See the [example middleware](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/api/middlewares.ts) for the working contract.

The browser callback removes the query string immediately and submits code/state/issuer or cancellation to the native callback using POST. Only the server performs discovery, token exchange, signature and claims verification. Disable request/referrer logging on all callback paths and proxies.

The provider creates customer AuthIdentities, not customer records. Complete registration with the native Medusa workflow and an explicit collision policy such as the [example account policy](https://github.com/boshetunmai001/ID-Medusa/blob/main/examples/medusa/src/lib/customer-account.ts); block alternative registration endpoints that could bypass that policy. Employees require an existing identity with a server-authorized `user_id`; use the example binding script after verifying ownership.

Named exports: `EncvoyAuthProvider`, `EncvoyStateStore`, `entityId`, and provider option types. The external identity key is the hash of `[issuer, subject, clientId, actorType]`. The provider never uses email as the identity key or stores OIDC tokens.

This is a PostgreSQL-backed prototype, not a production-certified drop-in login package. The app's middleware, customer policy, browser callback, and employee binding are required parts of the integration. See the [verification record](https://github.com/boshetunmai001/ID-Medusa/blob/main/docs/verification.md) for tested scenarios and known limitations.
