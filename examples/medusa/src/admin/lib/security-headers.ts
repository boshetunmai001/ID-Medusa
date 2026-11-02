import type { Plugin } from "vite"

export const adminSecurityHeadersPlugin: Plugin = {
  name: "medusa-encvoy-admin-security-headers",
  configureServer(server) {
    server.middlewares.use((_request, response, next) => {
      response.setHeader("Content-Security-Policy", "frame-ancestors 'none'")
      response.setHeader("X-Frame-Options", "DENY")
      response.setHeader("X-Content-Type-Options", "nosniff")
      response.setHeader("Referrer-Policy", "no-referrer")
      next()
    })
  },
}
