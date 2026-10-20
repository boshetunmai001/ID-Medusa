import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { entityId } from "../packages/auth-encvoy/src/services/encvoy-auth.js"
import { EncvoyAuthProvider } from "../packages/auth-encvoy/src/services/encvoy-auth.js"
import { validateOptions } from "../packages/auth-encvoy/src/options.js"

const localOptions = {
  issuer: "http://127.0.0.1:4444",
  clientId: "client-id",
  clientSecret: "client-secret",
  callbackUrl: "http://127.0.0.1:3000/auth/customer/encvoy-customer/callback",
  actorType: "customer" as const,
  databaseUrl: "postgres://localhost/test",
  browserOrigin: "http://127.0.0.1:3000",
  allowInsecureLocalhost: true,
}

test("provider options require local hosts and non-production for insecure HTTP", () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = "test"
  try {
    assert.equal(validateOptions(localOptions).cookieName, "encvoy_customer_browser")
    assert.throws(
      () => validateOptions({ ...localOptions, browserOrigin: "http://localhost.attacker.test" }),
      /literal localhost URLs/,
    )
    assert.throws(
      () => validateOptions({ ...localOptions, actorType: "admin" as "customer" }),
      /actorType/,
    )
    assert.throws(
      () => validateOptions({ ...localOptions, callbackUrl: "https://example.test/callback" }),
      /literal localhost URLs/,
    )

    process.env.NODE_ENV = "production"
    assert.throws(() => validateOptions(localOptions), /not allowed in production/)
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = original
    }
  }
})

test("provider options use actor-specific cookie defaults and preserve fixed URLs", () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = "test"
  try {
    const user = validateOptions({
      ...localOptions,
      actorType: "user",
      cookieName: undefined,
    })
    assert.equal(user.cookieName, "encvoy_user_browser")
    assert.equal(user.callbackUrl, localOptions.callbackUrl)
    assert.equal(user.issuer, localOptions.issuer)
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = original
    }
  }
})

test("entity IDs use the full issuer, subject, client, and actor tuple", () => {
  const inputs = ["https://issuer.test/", "sub-1", "client-1", "customer"] as const
  const expected = createHash("sha256")
    .update(JSON.stringify(inputs), "utf8")
    .digest("hex")

  assert.equal(entityId(...inputs), expected)
  assert.match(entityId(...inputs), /^[0-9a-f]{64}$/)
  assert.notEqual(entityId(...inputs), entityId(inputs[0], "sub-2", inputs[2], inputs[3]))
  assert.notEqual(entityId(...inputs), entityId(inputs[0], inputs[1], inputs[2], "user"))
})

test("standard registration and credential updates fail closed", async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = "test"
  try {
    const provider = new EncvoyAuthProvider({}, localOptions)
    assert.deepEqual(await provider.register({}, {} as never), {
      success: false,
      error: "not_authorized",
    })
    assert.deepEqual(await provider.update({}, {} as never), {
      success: false,
      error: "not_authorized",
    })
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = original
    }
  }
})
