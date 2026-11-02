import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import test from "node:test"
import { Pool } from "pg"
import { EncvoyStateStore } from "../packages/auth-encvoy/src/store.js"

const databaseUrl = process.env.DATABASE_URL
const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1" && Boolean(databaseUrl)

test("PostgreSQL state is bound to browser, client context, expiry, and one-time use", {
  skip: !enabled,
}, async () => {
  const store = new EncvoyStateStore(databaseUrl!)
  const sql = new Pool({ connectionString: databaseUrl, max: 1 })
  const suffix = randomBytes(16).toString("hex")
  const state = `state-${suffix}`
  const browser = `browser-${suffix}`
  const context = `customer:${suffix}`
  const stateHash = createHash("sha256").update(state, "utf8").digest("hex")
  const jwt = `synthetic-jwt-${suffix}`
  const jwtHash = createHash("sha256").update(jwt, "utf8").digest("hex")

  try {
    await store.initialize()
    await store.saveState(state, browser, "synthetic-verifier", "synthetic-nonce", context)

    assert.equal(await store.consumeState(state, `${browser}-wrong`, context), null)
    assert.equal(await store.consumeState(state, browser, `${context}-wrong`), null)
    assert.deepEqual(await store.consumeState(state, browser, context), {
      codeVerifier: "synthetic-verifier",
      nonce: "synthetic-nonce",
    })
    assert.equal(await store.consumeState(state, browser, context), null)

    const tokenUses = await Promise.all(
      Array.from({ length: 12 }, () => store.consumeMedusaJwt(jwt, Math.floor(Date.now() / 1000) + 60)),
    )
    assert.equal(tokenUses.filter(Boolean).length, 1, "a JWT must have one atomic refresh/session use")
    const storedToken = await sql.query(
      "SELECT token_hash FROM encvoy_consumed_medusa_jwt WHERE token_hash = $1",
      [jwtHash],
    )
    assert.deepEqual(storedToken.rows, [{ token_hash: jwtHash }], "only the JWT hash may be stored")

    const expiredState = `expired-${suffix}`
    const expiredHash = createHash("sha256").update(expiredState, "utf8").digest("hex")
    await store.saveState(expiredState, browser, "expired-verifier", "expired-nonce", context)
    await sql.query(
      "UPDATE encvoy_oidc_state SET expires_at = now() - interval '1 second' WHERE state_hash = $1",
      [expiredHash],
    )
    assert.equal(await store.consumeState(expiredState, browser, context), null)
  } finally {
    await sql.query("DELETE FROM encvoy_oidc_state WHERE state_hash = ANY($1::char(64)[])", [
      [stateHash, createHash("sha256").update(`expired-${suffix}`, "utf8").digest("hex")],
    ])
    await sql.query("DELETE FROM encvoy_consumed_medusa_jwt WHERE token_hash = $1", [jwtHash])
    await sql.end()
    await store.close()
  }
})

test("PostgreSQL state consumption and advisory locks serialize concurrent requests", {
  skip: !enabled,
}, async () => {
  const suffix = randomBytes(16).toString("hex")
  const store = new EncvoyStateStore(databaseUrl!)
  const secondStore = new EncvoyStateStore(databaseUrl!)
  const state = `race-${suffix}`
  const browser = `browser-${suffix}`
  const context = `customer:${suffix}`
  const stateHash = createHash("sha256").update(state, "utf8").digest("hex")
  let active = 0
  let maximumActive = 0

  try {
    await store.initialize()
    await store.saveState(state, browser, "race-verifier", "race-nonce", context)

    const results = await Promise.all(
      Array.from({ length: 12 }, () => store.consumeState(state, browser, context)),
    )
    assert.equal(results.filter(Boolean).length, 1)

    await Promise.all(
      Array.from({ length: 10 }, (_, index) => {
        const currentStore = index % 2 ? store : secondStore
        return currentStore.withLock(`integration:${suffix}`, async () => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          await new Promise((resolve) => setTimeout(resolve, 20))
          active -= 1
        })
      }),
    )
    assert.equal(maximumActive, 1)

    await store.withLock(`integration:nested:${suffix}`, async () => {
      await secondStore.withLock(`integration:nested-child:${suffix}`, async () => undefined)
    })
  } finally {
    const sql = new Pool({ connectionString: databaseUrl, max: 1 })
    await sql.query("DELETE FROM encvoy_oidc_state WHERE state_hash = $1", [stateHash])
    await sql.end()
    await store.close()
  }
})
