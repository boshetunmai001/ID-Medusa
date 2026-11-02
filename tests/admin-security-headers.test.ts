import assert from "node:assert/strict"
import test from "node:test"
import { adminSecurityHeadersPlugin } from "../examples/medusa/src/admin/lib/security-headers.js"

test("Medusa Admin development responses receive anti-framing and browser security headers", () => {
  let middleware: ((request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => void) | undefined
  adminSecurityHeadersPlugin.configureServer?.({
    middlewares: {
      use(handler) {
        middleware = handler
      },
    },
  } as never)
  assert.ok(middleware)

  const headers = new Map<string, string>()
  let continued = false
  middleware!({}, { setHeader: (name, value) => headers.set(name, value) }, () => { continued = true })

  assert.equal(headers.get("Content-Security-Policy"), "frame-ancestors 'none'")
  assert.equal(headers.get("X-Frame-Options"), "DENY")
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(headers.get("Referrer-Policy"), "no-referrer")
  assert.equal(continued, true)
})
