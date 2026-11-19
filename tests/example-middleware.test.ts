import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import test from "node:test"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import config, {
  authBrowser,
  consumeEncvoyJwt,
  hydrateCompletedCustomer,
} from "../examples/medusa/src/api/middlewares.js"
import { requireActiveEncvoyEmployeeGrant, requireEmployeeWriteOrigin } from "../examples/medusa/src/lib/employee-auth.js"

function mockResponse() {
  const result: {
    statusCode?: number
    body?: unknown
    cookies: Array<{ name: string; value: string; options: Record<string, unknown> }>
    headers: Map<string, string>
  } = { cookies: [], headers: new Map() }
  return {
    result,
    status(code: number) {
      result.statusCode = code
      return this
    },
    json(body: unknown) {
      result.body = body
      return this
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      result.cookies.push({ name, value, options })
      return this
    },
    setHeader(name: string, value: string) {
      result.headers.set(name, value)
    },
    redirect(code: number, location: string) {
      result.statusCode = code
      result.body = location
      return this
    },
  }
}

test("authBrowser requires same-origin POST and creates an actor-specific proof cookie", () => {
  const previousOrigin = process.env.MEDUSA_BROWSER_ORIGIN
  const previousLocalMode = process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST
  process.env.MEDUSA_BROWSER_ORIGIN = "http://localhost:9000"
  process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST = "true"
  try {
    const req = {
      method: "POST",
      originalUrl: "/auth/customer/encvoy-customer",
      headers: { origin: "http://localhost:9000" },
    }
    const res = mockResponse()
    let nextCalls = 0
    authBrowser(req as never, res as never, (() => { nextCalls += 1 }) as never)

    assert.equal(nextCalls, 1)
    assert.equal(res.result.statusCode, undefined)
    assert.equal(res.result.headers.get("Cache-Control"), "no-store")
    assert.equal(res.result.cookies.length, 1)
    assert.equal(res.result.cookies[0].name, "encvoy_customer_browser")
    assert.match(res.result.cookies[0].value, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(res.result.cookies[0].options.httpOnly, true)
    assert.equal(res.result.cookies[0].options.sameSite, "lax")
    assert.equal(res.result.cookies[0].options.path, "/auth")
    assert.equal((req as never as { headers: { cookie: string } }).headers.cookie.includes(res.result.cookies[0].value), true)

    const wrongOriginResponse = mockResponse()
    let wrongOriginNext = 0
    authBrowser({
      method: "POST",
      originalUrl: "/auth/customer/encvoy-customer",
      headers: { origin: "https://attacker.test" },
    } as never, wrongOriginResponse as never, (() => { wrongOriginNext += 1 }) as never)
    assert.equal(wrongOriginResponse.result.statusCode, 403)
    assert.deepEqual(wrongOriginResponse.result.body, { message: "invalid_origin" })
    assert.equal(wrongOriginNext, 0)

    const wrongMethodResponse = mockResponse()
    authBrowser({
      method: "GET",
      originalUrl: "/auth/customer/encvoy-customer",
      headers: { origin: "http://localhost:9000" },
    } as never, wrongMethodResponse as never, (() => {}) as never)
    assert.equal(wrongMethodResponse.result.statusCode, 405)

    const wrongActorResponse = mockResponse()
    authBrowser({
      method: "POST",
      originalUrl: "/auth/user/encvoy-customer",
      headers: { origin: "http://localhost:9000" },
    } as never, wrongActorResponse as never, (() => {}) as never)
    assert.equal(wrongActorResponse.result.statusCode, 403)
    assert.deepEqual(wrongActorResponse.result.body, { message: "invalid_actor" })
  } finally {
    if (previousOrigin === undefined) delete process.env.MEDUSA_BROWSER_ORIGIN
    else process.env.MEDUSA_BROWSER_ORIGIN = previousOrigin
    if (previousLocalMode === undefined) delete process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST
    else process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST = previousLocalMode
  }
})

test("authBrowser uses Secure-prefixed cookies outside local HTTP development", () => {
  const previousOrigin = process.env.MEDUSA_BROWSER_ORIGIN
  const previousLocalMode = process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST
  process.env.MEDUSA_BROWSER_ORIGIN = "https://medusa.example.test"
  delete process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST
  try {
    const res = mockResponse()
    authBrowser({
      method: "POST",
      originalUrl: "/auth/user/encvoy-user",
      headers: { origin: "https://medusa.example.test" },
    } as never, res as never, (() => {}) as never)
    assert.equal(res.result.cookies[0].name, "__Secure-encvoy_user_browser")
    assert.equal(res.result.cookies[0].options.secure, true)
  } finally {
    if (previousOrigin === undefined) delete process.env.MEDUSA_BROWSER_ORIGIN
    else process.env.MEDUSA_BROWSER_ORIGIN = previousOrigin
    if (previousLocalMode === undefined) delete process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST
    else process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST = previousLocalMode
  }
})

test("consumeEncvoyJwt stores only a valid Encvoy customer token once", async () => {
  const token = randomBytes(24).toString("base64url")
  const expiresAt = Math.floor(Date.now() / 1000) + 300
  const calls: Array<[string, number]> = []
  let tokenIsNew = true
  const store = {
    async initialize() {},
    async consumeMedusaJwt(actualToken: string, actualExpiry: number) {
      calls.push([actualToken, actualExpiry])
      const wasNew = tokenIsNew
      tokenIsNew = false
      return wasNew
    },
  }
  const req = {
    headers: { authorization: "Bearer " + token },
    auth_context: { auth_provider: "encvoy-customer", exp: expiresAt },
  }
  const firstResponse = mockResponse()
  let nextCalls = 0
  await consumeEncvoyJwt(req as never, firstResponse as never, (() => { nextCalls += 1 }) as never, store as never)
  assert.equal(nextCalls, 1)
  assert.deepEqual(calls, [[token, expiresAt]])

  const replayResponse = mockResponse()
  await consumeEncvoyJwt(req as never, replayResponse as never, (() => { nextCalls += 1 }) as never, store as never)
  assert.equal(nextCalls, 1)
  assert.equal(replayResponse.result.statusCode, 401)
  assert.deepEqual(replayResponse.result.body, { message: "token_already_used" })
})

test("hydrateCompletedCustomer requires the persisted customer link and hydrates actor context", async () => {
  const authContext: Record<string, unknown> = {
    auth_provider: "encvoy-customer",
    auth_identity_id: "auth_synthetic",
    actor_type: "customer_pending",
  }
  const req = {
    auth_context: authContext,
    scope: {
      resolve(module: string) {
        assert.equal(module, Modules.AUTH)
        return {
          async retrieveAuthIdentity(id: string) {
            assert.equal(id, "auth_synthetic")
            return { app_metadata: { customer_id: "cus_synthetic" } }
          },
        }
      },
    },
  }
  const res = mockResponse()
  let nextCalls = 0
  await hydrateCompletedCustomer(req as never, res as never, (() => { nextCalls += 1 }) as never)
  assert.equal(nextCalls, 1)
  assert.equal(authContext.actor_type, "customer")
  assert.equal(authContext.actor_id, "cus_synthetic")
  assert.deepEqual(authContext.app_metadata, { customer_id: "cus_synthetic" })
})

test("Admin grant middleware receives only staff session identities", async () => {
  const route = config.routes.find(({ matcher }) => matcher instanceof RegExp && matcher.test("/admin/users/me"))
  assert.ok(route)
  const grantIndex = route.middlewares.indexOf(requireActiveEncvoyEmployeeGrant)
  assert.ok(grantIndex > 0)
  assert.ok(route.middlewares.slice(0, grantIndex).includes(requireEmployeeWriteOrigin))
  for (const actor of ["customer", "user"]) {
    const req = {
      method: "GET", headers: {}, session: { auth_context: { actor_type: actor, actor_id: "fixture" } },
      scope: { resolve: (key: string) => key === ContainerRegistrationKeys.CONFIG_MODULE
        ? { projectConfig: { http: {} } } : {} },
      auth_context: undefined as { actor_type: string } | undefined,
    }
    for (const middleware of route.middlewares.slice(0, grantIndex)) {
      let advanced = false
      await middleware(req as never, mockResponse() as never, () => { advanced = true })
      assert.equal(advanced, true)
    }
    assert.equal(req.auth_context?.actor_type, actor === "user" ? "user" : undefined)
  }
})

test("Admin cookie writes require an exact Origin and machine requests can omit it", () => {
  const previous = process.env.MEDUSA_BROWSER_ORIGIN
  const origin = "https://admin.example.test"
  process.env.MEDUSA_BROWSER_ORIGIN = origin
  try {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const value of [undefined, "null", "https://store.example.test", origin]) {
        const res = mockResponse()
        let passed = false
        requireEmployeeWriteOrigin({
          method, session: { auth_context: { actor_type: "user" } }, headers: { origin: value },
        } as never, res as never, () => { passed = true })
        assert.equal(passed, value === origin)
        if (!passed) assert.equal(res.result.statusCode, 403)
      }
    }
    let passed = false
    requireEmployeeWriteOrigin({ method: "POST", headers: {} } as never,
      mockResponse() as never, () => { passed = true })
    assert.equal(passed, true)
  } finally {
    if (previous === undefined) delete process.env.MEDUSA_BROWSER_ORIGIN
    else process.env.MEDUSA_BROWSER_ORIGIN = previous
  }
})
