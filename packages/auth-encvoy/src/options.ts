export type EncvoyActorType = "customer" | "user"

export type EncvoyAuthProviderOptions = {
  issuer: string
  clientId: string
  clientSecret: string
  callbackUrl: string
  actorType: EncvoyActorType
  databaseUrl: string
  browserOrigin: string
  employeeGrantLifetimeSeconds?: number
  allowInsecureLocalhost?: boolean
  cookieName?: string
}

export type ValidatedEncvoyAuthProviderOptions = EncvoyAuthProviderOptions & {
  issuer: string
  callbackUrl: string
  browserOrigin: string
  cookieName: string
  employeeGrantLifetimeSeconds: number
}

export function defaultBrowserCookieName(
  actorType: EncvoyActorType,
  secure: boolean,
): string {
  const base = actorType === "customer"
    ? "encvoy_customer_browser"
    : "encvoy_user_browser"
  return secure ? `__Secure-${base}` : base
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const COOKIE_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export function validateOptions(
  options: EncvoyAuthProviderOptions,
): ValidatedEncvoyAuthProviderOptions {
  if (!options || typeof options !== "object") {
    throw new Error("Invalid Encvoy provider options")
  }
  if (options.actorType !== "customer" && options.actorType !== "user") {
    throw new Error("actorType must be customer or user")
  }

  for (const key of ["clientId", "clientSecret", "databaseUrl"] as const) {
    if (typeof options[key] !== "string" || options[key].length === 0) {
      throw new Error(`${key} is required`)
    }
  }

  const issuerUrl = parseUrl(options.issuer, "issuer")
  const callbackUrl = parseUrl(options.callbackUrl, "callbackUrl")
  const browserOriginUrl = parseUrl(options.browserOrigin, "browserOrigin")

  if (issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash) {
    throw new Error("issuer must not contain credentials, query, or fragment")
  }
  if (
    callbackUrl.username ||
    callbackUrl.password ||
    callbackUrl.search ||
    callbackUrl.hash
  ) {
    throw new Error("callbackUrl must not contain credentials, query, or fragment")
  }
  if (
    browserOriginUrl.username ||
    browserOriginUrl.password ||
    browserOriginUrl.pathname !== "/" ||
    browserOriginUrl.search ||
    browserOriginUrl.hash
  ) {
    throw new Error("browserOrigin must be an origin without a path")
  }

  const urls = [issuerUrl, callbackUrl, browserOriginUrl]
  if (options.allowInsecureLocalhost) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("allowInsecureLocalhost is not allowed in production")
    }
    if (urls.some((url) => !LOCAL_HOSTS.has(url.hostname))) {
      throw new Error("allowInsecureLocalhost requires literal localhost URLs")
    }
    if (urls.some((url) => !["http:", "https:"].includes(url.protocol))) {
      throw new Error("URL protocol is not supported")
    }
  } else if (urls.some((url) => url.protocol !== "https:")) {
    throw new Error("issuer, callbackUrl, and browserOrigin must use HTTPS")
  }

  const cookieName = options.cookieName ?? defaultBrowserCookieName(
    options.actorType,
    !options.allowInsecureLocalhost,
  )
  if (typeof cookieName !== "string" || !COOKIE_TOKEN.test(cookieName)) {
    throw new Error("cookieName must be a valid cookie token")
  }
  if (!options.allowInsecureLocalhost && !cookieName.startsWith("__Secure-")) {
    throw new Error("cookieName must use the __Secure- prefix over HTTPS")
  }

  const employeeGrantLifetimeSeconds = options.employeeGrantLifetimeSeconds ?? 30 * 60
  if (!Number.isSafeInteger(employeeGrantLifetimeSeconds) || employeeGrantLifetimeSeconds < 1) {
    throw new Error("employeeGrantLifetimeSeconds must be a positive integer")
  }

  return {
    ...options,
    // Keep the configured identifier and redirect URI byte-for-byte. OIDC
    // issuer and redirect URI comparisons are string comparisons.
    issuer: options.issuer,
    callbackUrl: options.callbackUrl,
    browserOrigin: browserOriginUrl.origin,
    cookieName,
    employeeGrantLifetimeSeconds,
  }
}

function parseUrl(value: unknown, name: string): URL {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`)
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute URL`)
  }

  if (!url.hostname || !["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`)
  }
  return url
}
