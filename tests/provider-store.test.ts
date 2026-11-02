import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { Pool } from "pg"
import { EncvoyStateStore } from "../packages/auth-encvoy/src/store.js"

test("state storage hashes browser bindings and consumes only a live matching state", async () => {
  const originalQuery = Pool.prototype.query
  const statements: Array<{ text: string; values: unknown[] }> = []
  Pool.prototype.query = function (...args: unknown[]) {
    const [text, values] = args as [string, unknown[]?]
    statements.push({ text, values: values ?? [] })
    return Promise.resolve({
      rows: text.includes("RETURNING code_verifier")
        ? [{ codeVerifier: "stored-verifier", nonce: "stored-nonce" }]
        : text.includes("RETURNING token_hash")
          ? [{ token_hash: "stored-token-hash" }]
        : [],
    }) as never
  } as never

  const store = new EncvoyStateStore("postgres://localhost/encvoy-state-test")
  try {
    await store.initialize()
    await store.saveState("raw-state", "raw-browser-proof", "stored-verifier", "stored-nonce")
    const saved = statements.find(({ text }) => text.includes("INSERT INTO encvoy_oidc_state"))
    assert.ok(saved)
    assert.match(saved.text, /now\(\) \+ \(\$6 \* interval '1 second'\)/)
    assert.notEqual(saved.values[0], "raw-state")
    assert.notEqual(saved.values[1], "raw-browser-proof")
    assert.equal(
      saved.values[4],
      createHash("sha256").update("", "utf8").digest("hex"),
    )
    assert.equal(saved.values[5], 300)

    const consumed = await store.consumeState("raw-state", "raw-browser-proof")
    assert.deepEqual(consumed, {
      codeVerifier: "stored-verifier",
      nonce: "stored-nonce",
    })
    const deleteQuery = statements.at(-1)!
    assert.match(deleteQuery.text, /DELETE FROM encvoy_oidc_state/)
    assert.match(deleteQuery.text, /state_hash = \$1 AND browser_hash = \$2 AND expires_at > now\(\)/)
    assert.match(deleteQuery.text, /context_hash = \$3/)
    assert.match(deleteQuery.text, /RETURNING code_verifier AS "codeVerifier", nonce/)
    assert.notEqual(deleteQuery.values[0], "raw-state")
    assert.notEqual(deleteQuery.values[1], "raw-browser-proof")

    assert.equal(await store.consumeMedusaJwt("raw-medusa-jwt", Math.floor(Date.now() / 1000) + 60), true)
    const consumedJwt = statements.at(-1)!
    assert.match(consumedJwt.text, /INSERT INTO encvoy_consumed_medusa_jwt/)
    assert.match(consumedJwt.text, /ON CONFLICT \(token_hash\) DO NOTHING/)
    assert.notEqual(consumedJwt.values[0], "raw-medusa-jwt")
    assert.equal(consumedJwt.values[0], createHash("sha256").update("raw-medusa-jwt", "utf8").digest("hex"))
    assert.equal(await store.consumeMedusaJwt("expired-medusa-jwt", Math.floor(Date.now() / 1000) - 1), false)
  } finally {
    Pool.prototype.query = originalQuery
    await store.close()
  }
})

test("nested state-store locks reuse the transaction connection across instances", async () => {
  const originalConnect = Pool.prototype.connect
  const statements: string[] = []
  let connectionCount = 0
  const fakeClient = {
    query: async (text: string) => {
      statements.push(text)
      return { rows: [] }
    },
    release: () => undefined,
  }
  Pool.prototype.connect = (async function () {
    connectionCount += 1
    return fakeClient
  }) as never

  const databaseUrl = "postgres://localhost/encvoy-lock-test"
  const outerStore = new EncvoyStateStore(databaseUrl)
  const nestedStore = new EncvoyStateStore(databaseUrl)
  try {
    await outerStore.withLock("identity", async () => {
      await nestedStore.withLock("email", async () => undefined)
      await nestedStore.withLock("email", async () => undefined)
    })

    assert.equal(connectionCount, 1)
    assert.equal(statements.filter((query) => query.includes("pg_advisory_xact_lock")).length, 2)
    assert.equal(statements[0], "BEGIN")
    assert.equal(statements.at(-1), "COMMIT")
  } finally {
    Pool.prototype.connect = originalConnect
    await outerStore.close()
  }
})
