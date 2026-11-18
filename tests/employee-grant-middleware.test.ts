import assert from "node:assert/strict"
import test from "node:test"
import { requireActiveEncvoyEmployeeGrant, revokeEncvoyEmployeeGrantOnLogout } from "../examples/medusa/src/lib/employee-auth.js"

test("Admin employee grant middleware allows active grants, denies revoked grants, and fails closed", async () => {
  let active = true
  let unavailable = false
  const store = {
    async initialize() {
      if (unavailable) throw new Error("synthetic store outage")
    },
    async isEmployeeGrantActive(loginId: string, userId: string) {
      assert.equal(loginId, "signed-login-id")
      assert.equal(userId, "usr_synthetic")
      if (unavailable) throw new Error("synthetic store outage")
      return active
    },
  } as never

  function response() {
    const result: { statusCode?: number; body?: unknown } = {}
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
    }
  }

  const employeeRequest = {
    auth_context: {
      actor_type: "user",
      actor_id: "usr_synthetic",
      auth_provider: "encvoy-user",
      app_metadata: { encvoy_login_id: "signed-login-id" },
    },
  } as never

  let nextCalls = 0
  const activeResponse = response()
  await requireActiveEncvoyEmployeeGrant(employeeRequest, activeResponse as never, (() => { nextCalls += 1 }) as never, store)
  assert.equal(nextCalls, 1)
  assert.equal(activeResponse.result.statusCode, undefined)

  active = false
  const revokedResponse = response()
  await requireActiveEncvoyEmployeeGrant(employeeRequest, revokedResponse as never, (() => { nextCalls += 1 }) as never, store)
  assert.equal(nextCalls, 1)
  assert.equal(revokedResponse.result.statusCode, 401)
  assert.deepEqual(revokedResponse.result.body, { message: "employee_session_revoked" })

  unavailable = true
  const failedResponse = response()
  await requireActiveEncvoyEmployeeGrant(employeeRequest, failedResponse as never, (() => { nextCalls += 1 }) as never, store)
  assert.equal(nextCalls, 1)
  assert.equal(failedResponse.result.statusCode, 503)
  assert.deepEqual(failedResponse.result.body, { message: "employee_session_check_unavailable" })

  const otherProvider = response()
  await requireActiveEncvoyEmployeeGrant({ auth_context: { auth_provider: "emailpass" } } as never, otherProvider as never, (() => { nextCalls += 1 }) as never, store)
  assert.equal(nextCalls, 2)
  assert.equal(otherProvider.result.statusCode, undefined)
})

test("employee logout revokes only its signed grant and fails closed on store errors", async () => {
  const revoked: Array<[string, string]> = []
  let unavailable = false
  const store = {
    async initialize() { if (unavailable) throw new Error("synthetic store outage") },
    async revokeEmployeeGrant(loginId: string, userId: string) {
      if (unavailable) throw new Error("synthetic store outage")
      revoked.push([loginId, userId])
      return true
    },
  } as never
  const response = () => {
    const result: { statusCode?: number; body?: unknown } = {}
    return {
      result,
      status(code: number) { result.statusCode = code; return this },
      json(body: unknown) { result.body = body; return this },
    }
  }
  const employeeRequest = { auth_context: {
    actor_type: "user",
    actor_id: "usr_synthetic",
    auth_provider: "encvoy-user",
    app_metadata: { encvoy_login_id: "signed-login-id" },
  } } as never
  let nextCalls = 0
  const activeResponse = response()
  await revokeEncvoyEmployeeGrantOnLogout(employeeRequest, activeResponse as never, (() => { nextCalls += 1 }) as never, store)
  assert.deepEqual(revoked, [["signed-login-id", "usr_synthetic"]])
  assert.equal(nextCalls, 1)

  unavailable = true
  const failedResponse = response()
  await revokeEncvoyEmployeeGrantOnLogout(employeeRequest, failedResponse as never, (() => { nextCalls += 1 }) as never, store)
  assert.equal(nextCalls, 1)
  assert.equal(failedResponse.result.statusCode, 503)
  assert.deepEqual(failedResponse.result.body, { message: "employee_session_revoke_unavailable" })

  const customerResponse = response()
  await revokeEncvoyEmployeeGrantOnLogout(
    { auth_context: { auth_provider: "encvoy-customer" } } as never,
    customerResponse as never,
    (() => { nextCalls += 1 }) as never,
    store,
  )
  assert.equal(nextCalls, 2, "customer logout must not touch employee grants")
})
