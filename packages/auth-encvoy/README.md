# Medusa Encvoy ID auth provider

`medusa-plugin-encvoy-id` is a Medusa Auth Module Provider for Encvoy ID over OpenID Connect. Version 0.1.0 targets Medusa **2.22.2**, Node.js **22.23.3**, and `openid-client` **6.8.8**. Full live HTTP acceptance passed on Medusa 2.22.2 on 2026-11-02 using isolated synthetic test data; fresh browser checks on this dependency update remain pending. The MIT license is included in this package: [LICENSE](./LICENSE).

## Installation

Install the provider in a Medusa v2 project:

```sh
npm install medusa-plugin-encvoy-id
```

Configure two provider instances, one for each Medusa actor. Keep client secrets and the PostgreSQL connection string on the server. The example configuration and required browser middleware are in the [Medusa example](https://github.com/boshetunmai001/ID-Medusa/tree/main/examples/medusa).

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
