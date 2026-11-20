import assert from "node:assert/strict"
import test from "node:test"
import {
  findRecoveryCandidate,
  parseClientList,
  recoveredClientMatches,
} from "../scripts/lib/encvoy-client-recovery.mjs"

const expected = {
  name: "Medusa customer local demo",
  domain: "http://localhost:9000",
  redirect_uris: ["http://localhost:9000/demo/callback"],
  grant_types: ["authorization_code"],
  response_types: ["code"],
  token_endpoint_auth_method: "client_secret_basic",
  introspection_endpoint_auth_method: "client_secret_basic",
  revocation_endpoint_auth_method: "client_secret_basic",
  id_token_signed_response_alg: "RS256",
  subject_type: "public",
}

function client(overrides: Record<string, unknown> = {}) {
  return { ...expected, client_id: "client-1", client_secret: "secret-1", ...overrides }
}

test("client recovery ignores unrelated clients and selects zero or one matching intent", () => {
  const items = parseClientList({
    items: [
      { name: "Seeded unrelated client", client_id: "seeded-1" },
      { name: expected.name, client_id: "client-1" },
    ],
    totalCount: 2,
  })

  assert.equal(findRecoveryCandidate(items, [expected.name, "legacy intent"] )?.client_id, "client-1")
  assert.equal(findRecoveryCandidate(items, ["another intent"]), undefined)
})

test("client recovery rejects duplicate intent matches", () => {
  assert.throws(
    () => findRecoveryCandidate([
      { name: expected.name, client_id: "client-1" },
      { name: expected.name, client_id: "client-2" },
    ], [expected.name]),
    /Several applications match/,
  )
})

test("recovered client detail must have the complete configuration and a secret", () => {
  const candidate = { name: expected.name, client_id: "client-1" }
  const detail = client()

  assert.equal(recoveredClientMatches(candidate, detail, expected), true)
  assert.equal(recoveredClientMatches(candidate, client({ redirect_uris: [] }), expected), false)
  assert.equal(recoveredClientMatches(candidate, client({ client_secret: "" }), expected), false)
})

test("client recovery rejects ambiguous or capped client lists as incomplete", () => {
  assert.throws(
    () => parseClientList({ items: [{ name: expected.name, client_id: "client-1" }], totalCount: 2 }),
    /client list was incomplete/,
  )
  assert.throws(
    () => parseClientList({ items: Array.from({ length: 100 }, (_, index) => ({ client_id: `client-${index}` })) }),
    /client list may be incomplete/,
  )
})

test("recovered client detail ID must match the list candidate ID", () => {
  const candidate = { name: expected.name, client_id: "client-1" }
  assert.equal(recoveredClientMatches(candidate, client({ client_id: "different-client" }), expected), false)
})
