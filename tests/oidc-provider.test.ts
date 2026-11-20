import assert from "node:assert/strict"
import {
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from "node:crypto"
import { createServer, type Server } from "node:http"
import test from "node:test"
import { MedusaError } from "@medusajs/framework/utils"
import * as oidc from "openid-client"
import { EncvoyAuthProvider } from "../packages/auth-encvoy/src/services/encvoy-auth.js"
import { EncvoyStateStore } from "../packages/auth-encvoy/src/store.js"

type State = { codeVerifier: string; nonce: string; browserProof: string; context: string }
type TokenMode =
  | "valid"
  | "signature"
  | "issuer"
  | "audience"
  | "nonce"
  | "expired"
  | "unverified-email"
  | "userinfo"
  | "userinfo-subject"

const states = new WeakMap<EncvoyStateStore, Map<string, State>>()
let stateStoreCalls: string[] = []
let employeeGrantCalls: Array<{ loginId: string; userId: string; lifetimeSeconds: number }> = []
const originalMethods = {
  initialize: EncvoyStateStore.prototype.initialize,
  saveState: EncvoyStateStore.prototype.saveState,
  consumeState: EncvoyStateStore.prototype.consumeState,
  createEmployeeGrant: EncvoyStateStore.prototype.createEmployeeGrant,
  withLock: EncvoyStateStore.prototype.withLock,
}

class InspectingAuthProvider extends EncvoyAuthProvider {
  readonly authorizationChecks: oidc.AuthorizationCodeGrantChecks[] = []

  protected override authorizationCodeGrant(
    configuration: oidc.Configuration,
    responseUrl: URL,
    checks: oidc.AuthorizationCodeGrantChecks,
  ) {
    this.authorizationChecks.push(checks)
    return super.authorizationCodeGrant(configuration, responseUrl, checks)
  }
}

EncvoyStateStore.prototype.initialize = async function () {
  stateStoreCalls.push("initialize")
}
EncvoyStateStore.prototype.saveState = async function (
  state,
  browserProof,
  codeVerifier,
  nonce,
  context = "",
) {
  stateStoreCalls.push("save")
  let records = states.get(this)
  if (!records) {
    records = new Map()
    states.set(this, records)
  }
  records.set(state, { codeVerifier, nonce, browserProof, context })
}

EncvoyStateStore.prototype.consumeState = async function (state, browserProof, context = "") {
  stateStoreCalls.push("consume")
  const records = states.get(this)
  const stored = records?.get(state)
  if (
    !stored ||
    stored.browserProof !== browserProof ||
    stored.context !== context
  ) {
    return null
  }
  records?.delete(state)
  return { codeVerifier: stored.codeVerifier, nonce: stored.nonce }
}

EncvoyStateStore.prototype.withLock = async function (_key, action) {
  return action()
}
EncvoyStateStore.prototype.createEmployeeGrant = async function (loginId, userId, lifetimeSeconds) {
  employeeGrantCalls.push({ loginId, userId, lifetimeSeconds })
}

const primaryKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
const primaryJwk = primaryKey.publicKey.export({ format: "jwk" })
primaryJwk.kid = "primary"
primaryJwk.use = "sig"
primaryJwk.alg = "RS256"

let mode: TokenMode = "valid"
let authorizationEndpoint = ""
let observedVerifier = ""
let advertisedIssuer: string | undefined
let advertisedAlgorithms: string[] = ["RS256"]
let advertisedPkceMethods: string[] = ["S256"]
let advertisedAuthMethods: string[] = ["client_secret_basic"]
let discoveryRequests = 0
let server: Server
let issuer = ""

test("OIDC code flow validates signatures, issuer, audience, nonce, expiry, and one-time state", async (t) => {
  const listening = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuer)
    if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      discoveryRequests++
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        issuer: advertisedIssuer ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        userinfo_endpoint: `${issuer}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: advertisedAlgorithms,
        token_endpoint_auth_methods_supported: advertisedAuthMethods,
        code_challenge_methods_supported: advertisedPkceMethods,
      }))
      return
    }
    if (request.method === "GET" && url.pathname === "/jwks") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ keys: [primaryJwk] }))
      return
    }
    if (request.method === "GET" && url.pathname === "/userinfo") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        sub: mode === "userinfo-subject" ? "different-subject" : "encvoy-subject-42",
        email: "person@example.test",
        email_verified: true,
        name: "Encvoy Person",
      }))
      return
    }
    if (request.method === "POST" && url.pathname === "/token") {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk))
      }
      const params = new URLSearchParams(Buffer.concat(chunks).toString("utf8"))
      assert.equal(
        request.headers.authorization,
        `Basic ${Buffer.from("encvoy%2Dtest%2Dclient:encvoy%2Dtest%2Dsecret").toString("base64")}`,
      )
      observedVerifier = params.get("code_verifier") ?? ""
      const loginNonce = authorizationEndpoint
        ? new URL(authorizationEndpoint).searchParams.get("nonce") ?? ""
        : ""
      const claims: Record<string, unknown> = {
        iss: mode === "issuer" ? `${issuer}/wrong` : issuer,
        sub: "encvoy-subject-42",
        aud: mode === "audience" ? "wrong-client" : "encvoy-test-client",
        exp: mode === "expired" ? Math.floor(Date.now() / 1000) - 60 : Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        nonce: mode === "nonce" ? "wrong-nonce" : loginNonce,
        name: "Encvoy Person",
      }
      if (mode === "userinfo" || mode === "userinfo-subject") {
        // UserInfo is permitted only when the verified ID token omits email.
      } else {
        claims.email = "person@example.test"
        claims.email_verified = mode !== "unverified-email"
      }
      const token = signedIdToken(
        claims,
        mode === "signature" ? wrongKey.privateKey : primaryKey.privateKey,
      )
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 300,
        id_token: token,
      }))
      return
    }
    response.writeHead(404)
    response.end()
  })
  server = listening
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  assert.ok(address && typeof address !== "string")
  issuer = `http://127.0.0.1:${address.port}`
  const options = {
    issuer,
    clientId: "encvoy-test-client",
    clientSecret: "encvoy-test-secret",
    callbackUrl: "http://127.0.0.1:3000/auth/customer/encvoy-customer/callback",
    actorType: "customer" as const,
    databaseUrl: "postgres://localhost/test",
    browserOrigin: "http://127.0.0.1:3000",
    allowInsecureLocalhost: true,
  }
  const browserProof = randomBytes(32).toString("base64url")
  const provider = new InspectingAuthProvider({}, options)
  const startInput = {
    actor_type: "customer",
    url: "/auth/customer/encvoy-customer",
    headers: {
      origin: options.browserOrigin,
      cookie: `encvoy_customer_browser=${browserProof}`,
    },
    query: {},
    body: {},
  }

  await t.test("successful verified token creates a customer identity and uses PKCE", async () => {
    mode = "valid"
    stateStoreCalls = []
    const started = await provider.authenticate(startInput, {} as never)
    assert.equal(started.success, true)
    assert.deepEqual(stateStoreCalls, ["initialize", "save"])
    assert.ok(started.location)
    authorizationEndpoint = started.location!
    const authorization = new URL(started.location!)
    const state = authorization.searchParams.get("state")!
    const challenge = authorization.searchParams.get("code_challenge")!
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256")
    assert.equal(authorization.searchParams.get("redirect_uri"), options.callbackUrl)

    let created: Record<string, unknown> | undefined
    const authService = {
      retrieve: async () => {
        throw new MedusaError(MedusaError.Types.NOT_FOUND, "missing")
      },
      create: async (data: Record<string, unknown>) => {
        created = data
        return {
          id: "auth_1",
          provider_identities: [{ provider: "encvoy-customer", ...data }],
        }
      },
      update: async () => {
        throw new Error("unexpected update")
      },
    }
    const callback = await provider.validateCallback({
      url: "/auth/customer/encvoy-customer/callback",
      headers: startInput.headers,
      query: { code: "mock-code", state },
      body: {},
    }, authService as never)
    assert.equal(callback.success, true)
    assert.equal(provider.authorizationChecks[0]?.expectedState, state)
    assert.notEqual(provider.authorizationChecks[0]?.expectedState, oidc.skipStateCheck)
    assert.deepEqual(stateStoreCalls, ["initialize", "save", "initialize", "consume"])
    assert.equal(callback.authIdentity?.id, "auth_1")
    assert.equal(observedVerifier.length > 40, true)
    assert.equal(await oidc.calculatePKCECodeChallenge(observedVerifier), challenge)
    assert.deepEqual(created?.provider_metadata, {
      issuer,
      subject: "encvoy-subject-42",
      client_id: options.clientId,
      actor_type: "customer",
    })
    assert.deepEqual(created?.user_metadata, {
      email: "person@example.test",
      email_verified: true,
      name: "Encvoy Person",
    })
    assert.equal(discoveryRequests, 1, "login start and callback must share cached discovery metadata")
  })

  await t.test("repeat customer login reuses the configured provider instance identity", async () => {
    mode = "valid"
    let identity: Record<string, unknown> | undefined
    let creates = 0
    let updates = 0
    const service = {
      retrieve: async () => {
        if (!identity) throw new MedusaError(MedusaError.Types.NOT_FOUND, "missing")
        return identity
      },
      create: async (data: Record<string, unknown>) => {
        creates++
        identity = {
          id: "auth_repeat",
          app_metadata: { customer_id: "cus_repeat" },
          provider_identities: [{ provider: "encvoy-customer", ...data }],
        }
        return identity
      },
      update: async () => { updates++; return identity },
    }
    const loginIds: unknown[] = []
    for (let attempt = 0; attempt < 2; attempt++) {
      const start = await provider.authenticate(startInput, {} as never)
      assert.equal(start.success, true)
      authorizationEndpoint = start.location!
      const state = new URL(start.location!).searchParams.get("state")!
      const result = await provider.validateCallback({
        url: "/auth/customer/encvoy-customer/callback",
        headers: startInput.headers,
        query: {},
        body: { code: "mock-code", state },
      }, service as never)
      assert.equal(result.success, true)
      assert.equal(result.authIdentity?.id, "auth_repeat")
      loginIds.push(result.authIdentity?.app_metadata?.encvoy_login_id)
    }
    assert.equal(creates, 1)
    assert.equal(updates, 1)
    assert.equal(typeof loginIds[0], "string")
    assert.notEqual(loginIds[0], loginIds[1])
    assert.equal(identity?.app_metadata?.encvoy_login_id, undefined)
    assert.equal(discoveryRequests, 1, "repeat logins must reuse discovery metadata within the TTL")
  })

  await t.test("coalesces concurrent discovery and refreshes metadata after five minutes", async () => {
    const concurrentProvider = new EncvoyAuthProvider({}, options)
    const beforeConcurrent = discoveryRequests
    const concurrentStarts = await Promise.all([
      concurrentProvider.authenticate(startInput, {} as never),
      concurrentProvider.authenticate(startInput, {} as never),
    ])
    assert.equal(concurrentStarts.every((result) => result.success), true)
    assert.equal(discoveryRequests - beforeConcurrent, 1,
      "simultaneous login starts must share one in-flight discovery request")

    const ttlProvider = new EncvoyAuthProvider({}, options)
    const actualNow = Date.now
    let fakeNow = 1_000_000
    Date.now = () => fakeNow
    try {
      const beforeTtl = discoveryRequests
      assert.equal((await ttlProvider.authenticate(startInput, {} as never)).success, true)
      assert.equal((await ttlProvider.authenticate(startInput, {} as never)).success, true)
      assert.equal(discoveryRequests - beforeTtl, 1, "cached metadata must be reused before expiry")
      fakeNow += 5 * 60 * 1000 + 1
      assert.equal((await ttlProvider.authenticate(startInput, {} as never)).success, true)
      assert.equal(discoveryRequests - beforeTtl, 2, "expired metadata must be rediscovered")
    } finally {
      Date.now = actualNow
    }
  })

  for (const invalidMode of [
    "signature",
    "issuer",
    "audience",
    "nonce",
    "expired",
    "unverified-email",
    "userinfo-subject",
  ] as const) {
    await t.test(`rejects invalid ${invalidMode} in ID token`, async () => {
      mode = invalidMode
      const metadataProvider = new EncvoyAuthProvider({}, options)
      const started = await metadataProvider.authenticate(startInput, {} as never)
      assert.equal(started.success, true)
      authorizationEndpoint = started.location!
      const state = new URL(started.location!).searchParams.get("state")!
      const result = await metadataProvider.validateCallback({
        url: "/auth/customer/encvoy-customer/callback",
        headers: startInput.headers,
        query: { code: "mock-code", state },
        body: {},
      }, {
        retrieve: async () => { throw new Error("must not retrieve an invalid identity") },
        create: async () => { throw new Error("must not create an invalid identity") },
        update: async () => { throw new Error("must not update an invalid identity") },
      } as never)
      assert.equal(result.success, false)
      assert.equal(result.error, "invalid_response")
    })
  }

  await t.test("uses UserInfo only when the ID token omits email and verifies the subject", async () => {
    mode = "userinfo"
    const started = await provider.authenticate(startInput, {} as never)
    authorizationEndpoint = started.location!
    const state = new URL(started.location!).searchParams.get("state")!
    let created: Record<string, unknown> | undefined
    const result = await provider.validateCallback({
      url: "/auth/customer/encvoy-customer/callback",
      headers: startInput.headers,
      query: { code: "mock-code", state },
      body: {},
    }, {
      retrieve: async () => { throw new MedusaError(MedusaError.Types.NOT_FOUND, "missing") },
      create: async (data: Record<string, unknown>) => {
        created = data
        return { id: "userinfo_identity" }
      },
      update: async () => { throw new Error("unexpected update") },
    } as never)
    assert.equal(result.success, true)
    assert.deepEqual(created?.user_metadata, {
      email: "person@example.test",
      email_verified: true,
      name: "Encvoy Person",
    })
  })

  await t.test("consumes callback state once and binds it to the initiating browser", async () => {
    mode = "valid"
    const started = await provider.authenticate(startInput, {} as never)
    authorizationEndpoint = started.location!
    const state = new URL(started.location!).searchParams.get("state")!
    const authService = {
      retrieve: async () => { throw new MedusaError(MedusaError.Types.NOT_FOUND, "missing") },
      create: async () => ({ id: "auth_2" }),
      update: async () => ({ id: "auth_2" }),
    }
    const wrongBrowser = await provider.validateCallback({
      url: "/auth/customer/encvoy-customer/callback",
      headers: {
        origin: options.browserOrigin,
        cookie: `encvoy_customer_browser=${randomBytes(32).toString("base64url")}`,
      },
      query: { code: "mock-code", state },
      body: {},
    }, authService as never)
    assert.equal(wrongBrowser.error, "login_expired")

    const validCallback = {
      url: "/auth/customer/encvoy-customer/callback",
      headers: startInput.headers,
      query: { code: "mock-code", state },
      body: {},
    }
    const malformedState = await provider.validateCallback({
      ...validCallback,
      query: { code: "mock-code", state: [state] },
    } as never, authService as never)
    assert.equal(malformedState.error, "login_expired")
    assert.equal((await provider.validateCallback(validCallback, authService as never)).success, true)
    assert.equal((await provider.validateCallback(validCallback, authService as never)).error, "login_expired")
  })

  await t.test("rejects a conflicting callback issuer", async () => {
    mode = "valid"
    const started = await provider.authenticate(startInput, {} as never)
    authorizationEndpoint = started.location!
    const state = new URL(started.location!).searchParams.get("state")!
    const result = await provider.validateCallback({
      url: "/auth/customer/encvoy-customer/callback",
      headers: startInput.headers,
      query: { code: "mock-code", state, iss: "https://wrong-issuer.test" },
      body: {},
    }, {
      retrieve: async () => { throw new Error("must not retrieve an invalid identity") },
      create: async () => { throw new Error("must not create an invalid identity") },
      update: async () => { throw new Error("must not update an invalid identity") },
    } as never)
    assert.equal(result.error, "invalid_response")
  })

  await t.test("consumes state on cancellation and rejects callback URL overrides", async () => {
    const cancelled = await provider.authenticate(startInput, {} as never)
    const cancelState = new URL(cancelled.location!).searchParams.get("state")!
    const cancelResult = await provider.validateCallback({
      url: "/auth/customer/encvoy-customer/callback",
      headers: startInput.headers,
      query: { error: "access_denied", state: cancelState },
      body: {},
    }, {} as never)
    assert.equal(cancelResult.error, "cancellation")
    const replay = await provider.validateCallback({
      url: "/auth/customer/encvoy-customer/callback",
      headers: startInput.headers,
      query: { error: "access_denied", state: cancelState },
      body: {},
    }, {} as never)
    assert.equal(replay.error, "login_expired")

    const overridden = await provider.authenticate({
      ...startInput,
      body: { callback_url: "https://attacker.test/callback" },
    }, {} as never)
    assert.equal(overridden.error, "invalid_response")
  })

  await t.test("rejects discovery metadata without exact issuer, RS256, S256, or Basic auth", async () => {
    const cases: Array<() => void> = [
      () => { advertisedIssuer = `${issuer}/wrong` },
      () => { advertisedAlgorithms = ["ES256"] },
      () => { advertisedPkceMethods = ["plain"] },
      () => { advertisedAuthMethods = ["client_secret_post"] },
    ]

    try {
      for (const alterMetadata of cases) {
        alterMetadata()
        const metadataProvider = new EncvoyAuthProvider({}, options)
        const result = await metadataProvider.authenticate(startInput, {} as never)
        assert.equal(result.success, false)
        assert.equal(result.error, "invalid_response")
        advertisedIssuer = undefined
        advertisedAlgorithms = ["RS256"]
        advertisedPkceMethods = ["S256"]
        advertisedAuthMethods = ["client_secret_basic"]
      }
    } finally {
      advertisedIssuer = undefined
      advertisedAlgorithms = ["RS256"]
      advertisedPkceMethods = ["S256"]
      advertisedAuthMethods = ["client_secret_basic"]
    }
  })

  await t.test("user callbacks require a provisioned, user-only identity", async () => {
    mode = "valid"
    employeeGrantCalls = []
    const userOptions = {
      ...options,
      actorType: "user" as const,
      callbackUrl: "http://127.0.0.1:3000/auth/user/encvoy-user/callback",
    }
    const userProof = randomBytes(32).toString("base64url")
    const userProvider = new EncvoyAuthProvider({}, userOptions)
    const userStart = {
      actor_type: "user",
      url: "/auth/user/encvoy-user",
      headers: {
        origin: options.browserOrigin,
        cookie: `encvoy_user_browser=${userProof}`,
      },
      query: {},
      body: {},
    }
    const started = await userProvider.authenticate(userStart, {} as never)
    assert.equal(started.success, true)
    authorizationEndpoint = started.location!
    const state = new URL(started.location!).searchParams.get("state")!
    const callbackInput = {
      url: "/auth/user/encvoy-user/callback",
      headers: userStart.headers,
      query: { code: "mock-code", state },
      body: {},
    }
    const missingIdentity = await userProvider.validateCallback(callbackInput, {
      retrieve: async () => { throw new MedusaError(MedusaError.Types.NOT_FOUND, "missing") },
      create: async () => { throw new Error("user identities must not be created") },
      update: async () => { throw new Error("unexpected update") },
    } as never)
    assert.equal(missingIdentity.error, "not_authorized")
    assert.equal(employeeGrantCalls.length, 0, "a denied identity must not create a session grant")

    const existing = {
      id: "auth_user_1",
      app_metadata: { user_id: "usr_1" },
      provider_identities: [{
        provider: "encvoy-user",
        provider_metadata: {
          issuer,
          subject: "encvoy-subject-42",
          client_id: options.clientId,
          actor_type: "user",
        },
      }],
    }
    const secondStart = await userProvider.authenticate(userStart, {} as never)
    authorizationEndpoint = secondStart.location!
    const secondState = new URL(secondStart.location!).searchParams.get("state")!
    const authorized = await userProvider.validateCallback({
      ...callbackInput,
      query: { code: "mock-code", state: secondState },
    }, {
      retrieve: async () => existing,
      create: async () => { throw new Error("user identities must not be created") },
      update: async (_id: string, data: Record<string, unknown>) => ({ ...existing, updated: data }),
    } as never)
    assert.equal(authorized.success, true)
    assert.equal((authorized.authIdentity as { id?: string }).id, "auth_user_1")
    const authorizedMetadata = (authorized.authIdentity as { app_metadata?: Record<string, unknown> }).app_metadata
    assert.equal(employeeGrantCalls.length, 1)
    assert.equal(employeeGrantCalls[0].userId, "usr_1")
    assert.equal(employeeGrantCalls[0].lifetimeSeconds, 30 * 60)
    assert.equal(employeeGrantCalls[0].loginId, authorizedMetadata?.encvoy_login_id)
    assert.match(employeeGrantCalls[0].loginId, /^[a-f0-9]{32}$/)

    const thirdStart = await userProvider.authenticate(userStart, {} as never)
    authorizationEndpoint = thirdStart.location!
    const thirdState = new URL(thirdStart.location!).searchParams.get("state")!
    const linkedCustomer = await userProvider.validateCallback({
      ...callbackInput,
      query: { code: "mock-code", state: thirdState },
    }, {
      retrieve: async () => ({
        ...existing,
        app_metadata: { user_id: "usr_1", customer_id: "cus_1" },
      }),
      create: async () => { throw new Error("user identities must not be created") },
      update: async () => { throw new Error("customer-linked identity must be denied") },
    } as never)
    assert.equal(linkedCustomer.error, "not_authorized")
    assert.equal(employeeGrantCalls.length, 1, "a customer-linked identity must not create a session grant")
  })

  await t.test("unavailable discovery fails safely without returning a redirect or upstream details", async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    const diagnostics: string[] = []
    const diagnosticOptions = { ...options, clientSecret: "secret-sentinel-value" }
    const unavailableProvider = new EncvoyAuthProvider({
      logger: { warn: (line: string) => diagnostics.push(line) } as never,
    }, diagnosticOptions)
    const result = await unavailableProvider.authenticate(startInput, {} as never)
    assert.deepEqual(result, { success: false, error: "provider_unavailable" })
    assert.equal(diagnostics.length, 1, "discovery failures should emit one diagnostic line")
    const diagnostic = JSON.parse(diagnostics[0]) as Record<string, unknown>
    assert.deepEqual(diagnostic, {
      event: "encvoy_auth_failure",
      stage: "discovery",
      actor_type: "customer",
      public_error: "provider_unavailable",
      cause: diagnostic.cause,
    })
    assert.equal(typeof diagnostic.cause, "string")
    assert.match(diagnostic.cause as string, /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT)$/)
    assert.doesNotMatch(diagnostics[0], /secret-sentinel-value|encvoy-test-secret|127\.0\.0\.1|mock-code/)
  })

  t.after(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})

test.after(() => {
  EncvoyStateStore.prototype.initialize = originalMethods.initialize
  EncvoyStateStore.prototype.saveState = originalMethods.saveState
  EncvoyStateStore.prototype.consumeState = originalMethods.consumeState
  EncvoyStateStore.prototype.createEmployeeGrant = originalMethods.createEmployeeGrant
  EncvoyStateStore.prototype.withLock = originalMethods.withLock
})

function signedIdToken(claims: Record<string, unknown>, privateKey: KeyObject): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "primary", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const signingInput = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(signingInput)
  signer.end()
  return `${signingInput}.${signer.sign(privateKey).toString("base64url")}`
}
