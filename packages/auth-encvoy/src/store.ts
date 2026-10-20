import { createHash } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import { Pool } from "pg"
import type { PoolClient } from "pg"

const STATE_TTL_SECONDS = 300
const CONNECTION_TIMEOUT_MS = 3_000
const LOCK_TIMEOUT_MS = 3_000

type LockContext = {
  databaseUrl: string
  connection: PoolClient
  keys: Set<string>
}

const activeLocks = new AsyncLocalStorage<LockContext>()
const pools = new Map<string, Pool>()
const poolEndPromises = new WeakMap<Pool, Promise<void>>()

export type EncvoyLoginState = {
  codeVerifier: string
  nonce: string
}

/** PostgreSQL-backed, one-time state storage shared by Encvoy provider instances. */
export class EncvoyStateStore {
  private readonly pool: Pool
  private readonly databaseUrl: string

  constructor(databaseUrl: string) {
    if (!databaseUrl) {
      throw new Error("databaseUrl is required")
    }

    this.databaseUrl = databaseUrl
    let pool = pools.get(databaseUrl)
    if (!pool) {
      pool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
        idleTimeoutMillis: 30_000,
        statement_timeout: 15_000,
      })
      pools.set(databaseUrl, pool)
    }
    this.pool = pool
  }

  /** Create the state table when the application starts. Safe to call repeatedly. */
  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS encvoy_oidc_state (
        state_hash char(64) PRIMARY KEY,
        browser_hash char(64) NOT NULL,
        context_hash char(64),
        code_verifier text NOT NULL,
        nonce text NOT NULL,
        expires_at timestamptz NOT NULL
      )
    `)
    await this.pool.query(`
      ALTER TABLE encvoy_oidc_state
      ADD COLUMN IF NOT EXISTS context_hash char(64)
    `)
    await this.pool.query(`
      UPDATE encvoy_oidc_state
      SET context_hash = repeat('0', 64)
      WHERE context_hash IS NULL
    `)
    await this.pool.query(`
      ALTER TABLE encvoy_oidc_state
      ALTER COLUMN context_hash SET NOT NULL
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS encvoy_oidc_state_expiry_idx
      ON encvoy_oidc_state (expires_at)
    `)
  }

  /** Store only hashes of the public state and browser proof. */
  async saveState(
    state: string,
    browserProof: string,
    codeVerifier: string,
    nonce: string,
    context = "",
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM encvoy_oidc_state WHERE expires_at <= now()`,
    )
    await this.pool.query(
      `INSERT INTO encvoy_oidc_state
         (state_hash, browser_hash, code_verifier, nonce, context_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 second'))`,
      [
        hash(state),
        hash(browserProof),
        codeVerifier,
        nonce,
        hash(context),
        STATE_TTL_SECONDS,
      ],
    )
  }

  /** Atomically consume a matching, unexpired state record. */
  async consumeState(
    state: string,
    browserProof: string,
    context = "",
  ): Promise<EncvoyLoginState | null> {
    const result = await this.pool.query<EncvoyLoginState>(
      `DELETE FROM encvoy_oidc_state
       WHERE state_hash = $1 AND browser_hash = $2 AND expires_at > now()
         AND context_hash = $3
       RETURNING code_verifier AS "codeVerifier", nonce`,
      [hash(state), hash(browserProof), hash(context)],
    )

    return result.rows[0] ?? null
  }

  /** Serialize work sharing a key across app processes using a transaction lock. */
  async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const inherited = activeLocks.getStore()
    if (inherited?.databaseUrl === this.databaseUrl) {
      if (!inherited.keys.has(key)) {
        await inherited.connection.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [key],
        )
        inherited.keys.add(key)
      }
      return action()
    }

    const connection = await this.pool.connect()

    try {
      await connection.query("BEGIN")
      await connection.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`)
      await connection.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [key],
      )

      const context: LockContext = {
        databaseUrl: this.databaseUrl,
        connection,
        keys: new Set([key]),
      }
      const result = await activeLocks.run(context, action)
      await connection.query("COMMIT")
      return result
    } catch (error) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the original failure if rollback also fails.
      }
      throw error
    } finally {
      connection.release()
    }
  }

  async close(): Promise<void> {
    if (pools.get(this.databaseUrl) === this.pool) {
      pools.delete(this.databaseUrl)
    }
    let closing = poolEndPromises.get(this.pool)
    if (!closing) {
      closing = this.pool.end()
      poolEndPromises.set(this.pool, closing)
    }
    await closing
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
