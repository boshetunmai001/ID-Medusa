import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { adminSecurityHeadersPlugin } from "../examples/medusa/src/admin/lib/security-headers.js"

function activeNginxDirectives(path: string | URL): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

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
  const directives = activeNginxDirectives(new URL("../infra/medusa-admin-security-headers.nginx.conf", import.meta.url))
  assert.deepEqual(directives, [
    'add_header Content-Security-Policy "frame-ancestors \'none\'" always;',
    'add_header X-Frame-Options "DENY" always;',
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header Referrer-Policy "no-referrer" always;',
  ])
})

test("production access-log example records paths without callback query data", () => {
  const http = activeNginxDirectives(new URL("../infra/medusa-safe-access-log-http.nginx.conf", import.meta.url)).join("\n")
  const location = activeNginxDirectives(new URL("../infra/medusa-safe-access-log-location.nginx.conf", import.meta.url))
  assert.ok(http.includes("log_format medusa_safe escape=json"))
  assert.ok(http.includes('"path":"$uri"'))
  assert.ok(http.includes('"status":$status'))
  for (const sensitiveVariable of ["$request_uri", '"$request"', "$args", "$http_referer", "$http_"]) {
    assert.equal(http.includes(sensitiveVariable), false, `${sensitiveVariable} must not appear in the access log format`)
  }
  assert.deepEqual(location, ["access_log /var/log/nginx/medusa-access.log medusa_safe;"])
})

test("production auth rate-limit directives return 429 and filter warnings", () => {
  const http = activeNginxDirectives(new URL("../infra/medusa-auth-rate-limit-http.nginx.conf", import.meta.url))
  const location = activeNginxDirectives(new URL("../infra/medusa-auth-rate-limit-location.nginx.conf", import.meta.url))
  const errorLog = activeNginxDirectives(new URL("../infra/medusa-auth-rate-limit-error-log-location.nginx.conf", import.meta.url))

  assert.deepEqual(http, ["limit_req_zone $binary_remote_addr zone=medusa_encvoy_auth:10m rate=20r/m;"])
  assert.deepEqual(location, [
    "limit_req zone=medusa_encvoy_auth burst=10 nodelay;",
    "limit_req_status 429;",
    "limit_req_log_level warn;",
  ])
  assert.deepEqual(errorLog, ["error_log /var/log/nginx/error.log error;"])
})

test("sensitive callback error logging is discarded at the location", () => {
  const directives = activeNginxDirectives(new URL("../infra/medusa-sensitive-callback-error-log-location.nginx.conf", import.meta.url))
  assert.deepEqual(directives, ["error_log /dev/null crit;"])
})
