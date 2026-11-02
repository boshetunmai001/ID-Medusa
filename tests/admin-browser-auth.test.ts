import assert from "node:assert/strict"
import test from "node:test"
import { postEncvoyUserAuth } from "../examples/medusa/src/admin/lib/encvoy-browser-auth.js"

test("Admin start and callback preserve the browser-proof cookie in JWT mode", async (t) => {
  const calls: { path: unknown; init: RequestInit | undefined }[] = []
  t.mock.method(globalThis, "fetch", async (path: unknown, init?: RequestInit) => {
    calls.push({ path, init })
    return Response.json({ token: "synthetic-medusa-token" })
  })

  for (const path of ["/auth/user/encvoy-user", "/auth/user/encvoy-user/callback"] as const) {
    const body = { code: "synthetic-code", state: "synthetic-state" }
    const result = await postEncvoyUserAuth<{ token: string }>(path, body)
    assert.equal(result.token, "synthetic-medusa-token")
    const call = calls.at(-1)!
    assert.equal(call.path, path)
    assert.equal(call.init?.method, "POST")
    assert.equal(call.init?.credentials, "same-origin")
    assert.equal(call.init?.cache, "no-store")
    assert.ok(call.init?.signal instanceof AbortSignal)
    assert.equal(new Headers(call.init?.headers).get("content-type"), "application/json")
    assert.equal(new Headers(call.init?.headers).get("accept"), "application/json")
    assert.deepEqual(JSON.parse(call.init?.body as string), body)
  }
  assert.equal(calls.length, 2)
})

test("Admin auth failures expose no network, upstream, or parsing details", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch")
  const failures = [
    async () => { throw new Error("private-network-detail") },
    async () => new Response("private-upstream-detail", { status: 401 }),
    async () => new Response("invalid-private-json", { status: 200 }),
  ]
  for (const failure of failures) {
    fetchMock.mock.mockImplementation(failure)
    await assert.rejects(
      postEncvoyUserAuth("/auth/user/encvoy-user/callback", { state: "synthetic-state" }),
      (error: Error) => {
        assert.equal(error.message, "Encvoy sign-in request failed.")
        assert.equal(error.cause, undefined)
        return true
      },
    )
  }
})
