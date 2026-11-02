import assert from "node:assert/strict"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { demoScript } from "../examples/medusa/src/lib/demo-html.js"

function element() {
  return {
    textContent: "",
    hidden: false,
    disabled: false,
    children: [] as unknown[],
    onclick: undefined as (() => Promise<void>) | undefined,
    replaceChildren(...children: unknown[]) { this.children = children },
    append(...children: unknown[]) { this.children.push(...children) },
  }
}

async function makeDemo(deleteResponse: { status: number; body: unknown }, profileAfterLogout: { status: number; body: unknown }) {
  const elements = new Map(["status", "login", "logout", "profile"].map((id) => [id, element()]))
  let profileRequests = 0
  const fetch = async (path: string, options: { method?: string } = {}) => {
    let result: { status: number; body: unknown }
    if (path === "/auth/session" && options.method === "DELETE") result = deleteResponse
    else if (path === "/encvoy/profile") {
      result = profileRequests++ === 0
        ? { status: 200, body: { customer: { id: "cus_test", email: "customer@example.invalid" } } }
        : profileAfterLogout
    } else throw new Error(`Unexpected request: ${path}`)
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      async text() { return JSON.stringify(result.body) },
    }
  }
  runInNewContext(demoScript, {
    document: {
      getElementById: (id: string) => elements.get(id)!,
      createElement: () => element(),
    },
    location: { pathname: "/demo/profile", search: "", assign() {}, replace() {} },
    fetch,
    AbortSignal,
    URL,
    URLSearchParams,
  })
  for (let attempt = 0; attempt < 20 && elements.get("logout")!.hidden; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { elements, fetchLogout: () => elements.get("logout")!.onclick!() }
}

test("logout verifies session state after an ambiguous delete response", async () => {
  const demo = await makeDemo(
    { status: 500, body: { message: "session store error" } },
    { status: 401, body: { message: "unauthorized" } },
  )

  await demo.fetchLogout()

  assert.equal(demo.elements.get("status")!.textContent, "You are signed out. Sign in to view your account.")
  assert.equal(demo.elements.get("login")!.hidden, false)
  assert.equal(demo.elements.get("logout")!.hidden, true)
})

test("logout reports failure when the protected session is still active", async () => {
  const demo = await makeDemo(
    { status: 403, body: { message: "invalid_origin" } },
    { status: 200, body: { customer: { id: "cus_test", email: "customer@example.invalid" } } },
  )

  await demo.fetchLogout()

  assert.equal(demo.elements.get("status")!.textContent, "Could not end the session. Please retry.")
  assert.equal(demo.elements.get("login")!.hidden, true)
  assert.equal(demo.elements.get("logout")!.hidden, false)
})
