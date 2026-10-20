# Medusa Encvoy ID auth provider

Unpublished local package for Medusa **2.21.2**, Node **22.23.3**, and `openid-client` **6.8.8**. Its real OIDC flow and customer/user provider separation passed local HTTP acceptance against the pinned vendor Encvoy ID **3.6.19** images. The image digests are not linked to the separate GitHub source snapshot; results apply only to this tested local setup. See the [verification record](../../docs/verification.md).

The default export is a native `ModuleProvider(Modules.AUTH, ...)`. Configure two instances with IDs `encvoy-customer` and `encvoy-user`; set `http.authMethodsPerActor` so each actor can use only its own instance. The example configuration is the reference integration.

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

Call `new EncvoyStateStore(databaseUrl).initialize()` from an application loader. It creates the small state table idempotently. The runtime DB user needs the relevant DDL permission during this initialization. State has a five-minute lifetime and is atomically consumed with browser and client/actor context binding.

The package intentionally requires application middleware. For native `/auth/{actor}/encvoy-{actor}` and its `/callback` endpoint, require POST and the configured Origin. Before initiating login, create an unpredictable 32-byte base64url browser proof cookie with HttpOnly, SameSite=Lax, Path=/auth, and Secure outside explicit local HTTP development. Pass that cookie to the provider through native request headers. Never synthesize the proof from user-controlled request data. See `examples/medusa/src/api/middlewares.ts` for the working contract.

The browser callback removes the query string immediately and submits code/state/issuer or cancellation to the native callback using POST. Only the server performs discovery, token exchange, signature and claims verification. Disable request/referrer logging on all callback paths and proxies.

The provider creates customer AuthIdentities, not customer records. Complete registration with the native Medusa workflow and an explicit collision policy such as `examples/medusa/src/lib/customer-account.ts`; block alternative registration endpoints that could bypass that policy. Employees require an existing identity with a server-authorized `user_id`; use the example binding script after verifying ownership.

Named exports: `EncvoyAuthProvider`, `EncvoyStateStore`, `entityId`, and provider option types. The external identity key is the hash of `[issuer, subject, clientId, actorType]`. The provider never uses email as the identity key or stores OIDC tokens.

This is a PostgreSQL-backed prototype, not a production-certified drop-in login package. The app's middleware, customer policy, browser callback, and employee binding are required parts of the integration. See the workspace documentation for tests and known limitations.
