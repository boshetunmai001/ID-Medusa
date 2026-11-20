import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { Pool } from "pg"
import { EncvoyStateStore } from "../packages/auth-encvoy/src/store.js"

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

test("state storage hashes browser bindings and consumes only a live matching state", async () => {
  const originalQuery = Pool.prototype.query
  const originalConnect = Pool.prototype.connect
  const statements: Array<{ text: string; values: unknown[] }> = []
  let connectionCount = 0
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
  Pool.prototype.connect = (async function () {
    connectionCount += 1
    return {
      query: async (text: string, values?: unknown[]) => {
        statements.push({ text, values: values ?? [] })
        return { rows: [] }
      },
      release: () => undefined,
    }
  }) as never

  const store = new EncvoyStateStore("postgres://localhost/encvoy-state-test")
  try {
    await store.initialize()
    assert.equal(connectionCount, 1)
    assert.equal(statements[0].text, "BEGIN")
    assert.match(statements[2].text, /pg_advisory_xact_lock/)
    assert.equal(statements.at(-1)?.text, "COMMIT")
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
    Pool.prototype.connect = originalConnect
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
      await nestedStore.withLock("identity", async () => undefined)
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

test("same-key lock waiters do not check out a connection and another key can progress", async () => {
  const originalConnect = Pool.prototype.connect
  let connectionCount = 0
  Pool.prototype.connect = (async function () {
    connectionCount += 1
    return {
      query: async () => ({ rows: [] }),
      release: () => undefined,
    }
  }) as never

  const databaseUrl = "postgres://localhost/encvoy-lock-admission-test"
  const firstStore = new EncvoyStateStore(databaseUrl)
  const secondStore = new EncvoyStateStore(databaseUrl)
  const firstEntered = deferred()
  const releaseFirst = deferred()
  const otherKeyEntered = deferred()
  let sameKeyEntered = false

  try {
    const first = firstStore.withLock("shared", async () => {
      firstEntered.resolve()
      await releaseFirst.promise
    })
    await firstEntered.promise

    const sameKey = secondStore.withLock("shared", async () => {
      sameKeyEntered = true
    })
    await nextTurn()
    assert.equal(connectionCount, 1, "a same-key waiter must remain before pool.connect")

    const otherKey = secondStore.withLock("independent", async () => {
      otherKeyEntered.resolve()
    })
    await otherKeyEntered.promise
    assert.equal(connectionCount, 2, "a different key must be admitted independently")
    assert.equal(sameKeyEntered, false)

    releaseFirst.resolve()
    await Promise.all([first, sameKey, otherKey])
    assert.equal(connectionCount, 3)
    assert.equal(sameKeyEntered, true)
  } finally {
    releaseFirst.resolve()
    Pool.prototype.connect = originalConnect
    await firstStore.close()
  }
})

test("lock admission releases after connect and action failures", async () => {
  const originalConnect = Pool.prototype.connect
  let connectCount = 0
  const firstConnect = deferred<never>()
  Pool.prototype.connect = (async function () {
    connectCount += 1
    if (connectCount === 1) {
      return firstConnect.promise
    }
    return {
      query: async () => ({ rows: [] }),
      release: () => undefined,
    }
  }) as never

  const databaseUrl = "postgres://localhost/encvoy-lock-failure-test"
  const store = new EncvoyStateStore(databaseUrl)
  try {
    const connectFailure = store.withLock("connect-failure", async () => undefined)
    await nextTurn()
    const waitingAfterConnectFailure = store.withLock("connect-failure", async () => "recovered")
    firstConnect.reject(new Error("connect failed"))
    await assert.rejects(connectFailure, /connect failed/)
    assert.equal(await waitingAfterConnectFailure, "recovered")

    await assert.rejects(
      store.withLock("action-failure", async () => { throw new Error("action failed") }),
      /action failed/,
    )
    assert.equal(await store.withLock("action-failure", async () => "recovered"), "recovered")
  } finally {
    Pool.prototype.connect = originalConnect
    await store.close()
  }
})

test("lock admission caps outstanding database operations and times out queued entries", async (t) => {
  const originalConnect = Pool.prototype.connect
  let connectionCount = 0
  const releaseAll = deferred()
  const fakeConnect = (async function () {
    connectionCount += 1
    return {
      query: async () => ({ rows: [] }),
      release: () => undefined,
    }
  }) as never
  Pool.prototype.connect = fakeConnect

  const fullDatabase = "postgres://localhost/encvoy-lock-limit-test"
  const fullStore = new EncvoyStateStore(fullDatabase)
  try {
    const held = Array.from({ length: 256 }, (_, index) =>
      fullStore.withLock(`key-${index}`, async () => releaseAll.promise),
    )
    await nextTurn()
    assert.equal(connectionCount, 256)
    await assert.rejects(
      fullStore.withLock("overflow", async () => undefined),
      (error: unknown) => (error as { code?: unknown }).code === "LOCK_QUEUE_FULL",
    )
    releaseAll.resolve()
    await Promise.all(held)
  } finally {
    releaseAll.resolve()
    Pool.prototype.connect = originalConnect
    await fullStore.close()
  }

  Pool.prototype.connect = fakeConnect
  const timeoutDatabase = "postgres://localhost/encvoy-lock-timeout-test"
  const timeoutStore = new EncvoyStateStore(timeoutDatabase)
  const active = deferred()
  const releaseActive = deferred()
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] })
    const first = timeoutStore.withLock("same", async () => {
      active.resolve()
      await releaseActive.promise
    })
    await active.promise
    const timedOut = timeoutStore.withLock("same", async () => undefined)
    await nextTurn()
    t.mock.timers.tick(30_000)
    await assert.rejects(
      timedOut,
      (error: unknown) => (error as { code?: unknown }).code === "LOCK_QUEUE_TIMEOUT",
    )

    const recovered = timeoutStore.withLock("same", async () => "recovered")
    releaseActive.resolve()
    await first
    assert.equal(await recovered, "recovered")
  } finally {
    releaseActive.resolve()
    t.mock.timers.reset()
    Pool.prototype.connect = originalConnect
    await timeoutStore.close()
  }
})
