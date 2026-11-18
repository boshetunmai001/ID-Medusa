import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { adminSecurityHeadersPlugin } from "../examples/medusa/src/admin/lib/security-headers.js"

test("Admin development responses receive anti-framing and browser security headers", () => {
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

test("production reverse-proxy snippet applies security headers to Admin", () => {
  const nginx = readFileSync(new URL("../infra/medusa-admin-security-headers.nginx.conf", import.meta.url), "utf8")
  for (const header of ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]) {
    assert.match(nginx, new RegExp(`add_header ${header} .* always;`))
  }
  assert.match(nginx, /Include inside both the `location = \/app` and `location \^~ \/app\//)
})

test("production access-log example records paths without callback query data", () => {
  const http = readFileSync(new URL("../infra/medusa-safe-access-log-http.nginx.conf", import.meta.url), "utf8")
  const location = readFileSync(new URL("../infra/medusa-safe-access-log-location.nginx.conf", import.meta.url), "utf8")
  const directives = http.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n")
  assert.match(directives, /log_format medusa_safe escape=json/)
  assert.match(directives, /"path":"\$uri"/)
  assert.doesNotMatch(directives, /\$request_uri|\$request\b|\$args|\$http_referer|authorization/i)
  assert.match(location, /access_log \/var\/log\/nginx\/medusa-access\.log medusa_safe;/)
})
