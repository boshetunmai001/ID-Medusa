import assert from "node:assert/strict"
import test from "node:test"
import { requireActiveEncvoyEmployeeGrant } from "../examples/medusa/src/api/middlewares.js"

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
