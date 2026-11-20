import { createHash, randomBytes } from "node:crypto"
import type {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
  Logger,
} from "@medusajs/framework/types"
import {
  AbstractAuthModuleProvider,
  MedusaError,
} from "@medusajs/framework/utils"
import * as oidc from "openid-client"
import type { IDToken } from "openid-client"
import {
  type EncvoyActorType,
  type EncvoyAuthProviderOptions,
  type ValidatedEncvoyAuthProviderOptions,
  validateOptions,
} from "../options.js"
import { EncvoyStateStore } from "../store.js"

type InjectedDependencies = { logger?: Logger }
type RuntimeAuthInput = AuthenticationInput & {
  actor_type?: string
}

type VerifiedClaims = {
  issuer: string
  subject: string
  clientId: string
  actorType: EncvoyActorType
  email: string
  name?: string
  given_name?: string
  family_name?: string
}

const LOGIN_EXPIRED = "login_expired"
const INVALID_RESPONSE = "invalid_response"
const PROVIDER_UNAVAILABLE = "provider_unavailable"
const NOT_AUTHORIZED = "not_authorized"
const IDENTITY_CONFLICT = "identity_conflict"
const CANCELLATION = "cancellation"
const LOCAL_OIDC_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000

type DiagnosticStage =
  | "discovery"
  | "state_initialize"
  | "state_save"
  | "state_consume"
  | "token_exchange"
  | "claims"
  | "identity"
  | "grant"

export class EncvoyAuthProvider extends AbstractAuthModuleProvider {
  static identifier = "encvoy"
  static DISPLAY_NAME = "Encvoy ID"

  protected readonly config_: ValidatedEncvoyAuthProviderOptions
  protected readonly logger_?: Logger
  private readonly stateStore_: EncvoyStateStore
  private discoveryCache?: {
    configuration: oidc.Configuration
    expiresAt: number
  }
  private discoveryInFlight?: Promise<oidc.Configuration>

  static validateOptions(options: EncvoyAuthProviderOptions): void {
    validateOptions(options)
  }

  constructor(
    dependencies: InjectedDependencies,
    options: EncvoyAuthProviderOptions,
  ) {
    super()
    this.config_ = validateOptions(options)
    this.logger_ = dependencies.logger
    this.stateStore_ = new EncvoyStateStore(this.config_.databaseUrl)
  }

  async authenticate(
    input: AuthenticationInput,
    _authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    let stage: DiagnosticStage = "discovery"
    try {
      const request = input as RuntimeAuthInput
      if (request.actor_type !== this.config_.actorType) {
        return failure(INVALID_RESPONSE)
      }
      if (!this.routeMatches(request, false)) {
        return failure(INVALID_RESPONSE)
      }
      if (!this.hasExpectedOrigin(request)) {
        return failure(INVALID_RESPONSE)
      }
      const browserProof = readBrowserProof(request.headers, this.config_.cookieName)
      if (!browserProof) {
        return failure(INVALID_RESPONSE)
      }
      if (!this.hasFixedCallbackOverrides(request.body)) {
        return failure(INVALID_RESPONSE)
      }

      const configuration = await this.discover()
      const state = randomBytes(32).toString("base64url")
      const nonce = oidc.randomNonce()
      const codeVerifier = oidc.randomPKCECodeVerifier()
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)

      stage = "state_initialize"
      await this.stateStore_.initialize()
      stage = "state_save"
      await this.stateStore_.saveState(
        state,
        browserProof,
        codeVerifier,
        nonce,
        this.stateBinding(),
      )

      const location = oidc.buildAuthorizationUrl(configuration, {
        client_id: this.config_.clientId,
        redirect_uri: this.config_.callbackUrl,
        response_type: "code",
        response_mode: "query",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      })

      return { success: true, location: location.href }
    } catch (error) {
      return failure(this.reportFailure(error, stage, "provider"))
    }
  }

  async validateCallback(
    input: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    const request = input as RuntimeAuthInput
    if (!this.routeMatches(request, true)) {
      return failure(INVALID_RESPONSE)
    }
    if (!this.hasExpectedOrigin(request)) {
      return failure(INVALID_RESPONSE)
    }

    const browserProof = readBrowserProof(request.headers, this.config_.cookieName)
    const state = readParameter(request, "state")
    if (!browserProof || !state.ok || !state.value) {
      return failure(LOGIN_EXPIRED)
    }

    let stored: Awaited<ReturnType<EncvoyStateStore["consumeState"]>>
    let stateStage: DiagnosticStage = "state_initialize"
    try {
      await this.stateStore_.initialize()
      stateStage = "state_consume"
      stored = await this.stateStore_.consumeState(
        state.value,
        browserProof,
        this.stateBinding(),
      )
    } catch (error) {
      return failure(this.reportFailure(error, stateStage, "provider"))
    }
    if (!stored) {
      return failure(LOGIN_EXPIRED)
    }

    // The matching browser-bound state is consumed before cancellation handling,
    // callback validation, discovery, or token exchange.
    const providerError = readParameter(request, "error")
    const code = readParameter(request, "code")
    const issuer = readParameter(request, "iss")
    if (!providerError.ok || !code.ok || !issuer.ok) {
      return failure(INVALID_RESPONSE)
    }
    if (providerError.value && code.value) {
      return failure(INVALID_RESPONSE)
    }
    if (providerError.value) {
      return failure(
        providerError.value === "access_denied" ? CANCELLATION : INVALID_RESPONSE,
      )
    }
    if (!code.value) {
      return failure(INVALID_RESPONSE)
    }
    if (!this.hasFixedCallbackOverrides(request.body)) {
      return failure(INVALID_RESPONSE)
    }

    let stage: DiagnosticStage = "discovery"
    try {
      const configuration = await this.discover()
      const responseUrl = new URL(this.config_.callbackUrl)
      responseUrl.searchParams.set("code", code.value)
      responseUrl.searchParams.set("state", state.value)
      if (issuer.value) {
        responseUrl.searchParams.set("iss", issuer.value)
      }

      stage = "token_exchange"
      const tokens = await this.authorizationCodeGrant(
        configuration,
        responseUrl,
        {
          expectedNonce: stored.nonce,
          expectedState: state.value,
          pkceCodeVerifier: stored.codeVerifier,
          idTokenExpected: true,
        },
      )
      stage = "claims"
      const idToken = tokens.claims()
      if (!idToken) {
        return failure(INVALID_RESPONSE)
      }
      const claims = await this.verifiedClaims(
        configuration,
        idToken,
        tokens.access_token,
      )
      stage = "identity"
      const authIdentity = await this.resolveIdentity(authIdentityService, claims)
      if (!authIdentity) {
        return failure(NOT_AUTHORIZED)
      }
      const loginId = randomBytes(16).toString("hex")
      if (this.config_.actorType === "user") {
        const userId = authIdentity.app_metadata?.user_id
        if (typeof userId !== "string" || userId.length === 0) {
          return failure(NOT_AUTHORIZED)
        }
        stage = "grant"
        await this.stateStore_.createEmployeeGrant(
          loginId,
          userId,
          this.config_.employeeGrantLifetimeSeconds,
        )
      }
      // Medusa signs app_metadata into its JWT. Add a per-callback claim to the
      // returned identity (without persisting it) so a fresh OIDC login always
      // produces a distinct one-time session token, even within the same second.
      return {
        success: true,
        authIdentity: {
          ...authIdentity,
          app_metadata: {
            ...(authIdentity.app_metadata ?? {}),
            encvoy_login_id: loginId,
          },
        },
      }
    } catch (error) {
      return failure(this.reportFailure(error, stage, "callback"))
    }
  }

  /** Keep the state check visible at the provider boundary for defense in depth. */
  protected authorizationCodeGrant(
    configuration: oidc.Configuration,
    responseUrl: URL,
    checks: oidc.AuthorizationCodeGrantChecks,
  ): ReturnType<typeof oidc.authorizationCodeGrant> {
    return oidc.authorizationCodeGrant(configuration, responseUrl, checks)
  }

  async register(
    _input: AuthenticationInput,
    _authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    return failure(NOT_AUTHORIZED)
  }

  async update(
    _input: Record<string, unknown>,
    _authIdentityService: AuthIdentityProviderService,
  ): Promise<AuthenticationResponse> {
    return failure(NOT_AUTHORIZED)
  }

  private async discover(): Promise<oidc.Configuration> {
    const cached = this.discoveryCache
    if (cached && cached.expiresAt > Date.now()) {
      return cached.configuration
    }
    if (this.discoveryInFlight) {
      return this.discoveryInFlight
    }

    const inFlight = this.loadConfiguration()
    this.discoveryInFlight = inFlight
    try {
      const configuration = await inFlight
      this.discoveryCache = {
        configuration,
        expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
      }
      return configuration
    } finally {
      if (this.discoveryInFlight === inFlight) {
        this.discoveryInFlight = undefined
      }
    }
  }

  private async loadConfiguration(): Promise<oidc.Configuration> {
    let configuration: oidc.Configuration
    try {
      configuration = await oidc.discovery(
        new URL(this.config_.issuer),
        this.config_.clientId,
        {
          client_secret: this.config_.clientSecret,
          id_token_signed_response_alg: "RS256",
        },
        oidc.ClientSecretBasic(),
        {
          timeout: 10,
          ...(this.config_.allowInsecureLocalhost
            ? { execute: [oidc.allowInsecureRequests] }
            : {}),
        },
      )
    } catch (error) {
      throw new ProviderFailure(
        error instanceof oidc.ClientError
          ? INVALID_RESPONSE
          : this.publicError(error, "provider"),
        error,
      )
    }

    const metadata = configuration.serverMetadata()
    if (
      metadata.issuer !== this.config_.issuer ||
      !metadata.response_types_supported?.includes("code") ||
      !metadata.id_token_signing_alg_values_supported?.includes("RS256") ||
      !metadata.token_endpoint_auth_methods_supported?.includes("client_secret_basic") ||
      !metadata.code_challenge_methods_supported?.includes("S256") ||
      !this.isAllowedEndpoint(metadata.authorization_endpoint) ||
      !this.isAllowedEndpoint(metadata.token_endpoint) ||
      !this.isAllowedEndpoint(metadata.jwks_uri) ||
      (metadata.userinfo_endpoint !== undefined &&
        !this.isAllowedEndpoint(metadata.userinfo_endpoint))
    ) {
      throw new ProviderFailure(INVALID_RESPONSE)
    }

    // Pin the algorithm set accepted by openid-client before enabling its full
    // ID-token signature verification. No hand-parsed or unverified JWT claims
    // are used for identity decisions.
    const pinnedMetadata = {
      ...metadata,
      id_token_signing_alg_values_supported: ["RS256"],
    } as unknown as oidc.ServerMetadata
    const pinned = new oidc.Configuration(
      pinnedMetadata,
      this.config_.clientId,
      {
        client_secret: this.config_.clientSecret,
        id_token_signed_response_alg: "RS256",
      },
      oidc.ClientSecretBasic(),
    )
    pinned.timeout = 10
    if (this.config_.allowInsecureLocalhost) {
      oidc.allowInsecureRequests(pinned)
    }
    oidc.enableNonRepudiationChecks(pinned)
    return pinned
  }

  private async verifiedClaims(
    configuration: oidc.Configuration,
    idToken: IDToken,
    accessToken: string | undefined,
  ): Promise<VerifiedClaims> {
    const claims = idToken as IDToken & Record<string, unknown>
    const currentTime = Math.floor(Date.now() / 1000)
    if (
      claims.iss !== this.config_.issuer ||
      typeof claims.sub !== "string" ||
      claims.sub.length === 0 ||
      !audienceContains(claims.aud, this.config_.clientId) ||
      typeof claims.exp !== "number" ||
      claims.exp <= currentTime ||
      typeof claims.iat !== "number" ||
      claims.iat > currentTime + 30
    ) {
      throw new ProviderFailure(INVALID_RESPONSE)
    }

    let identityClaims: Record<string, unknown> = claims
    if (claims.email === undefined) {
      if (!accessToken) {
        throw new ProviderFailure(INVALID_RESPONSE)
      }
      let userInfo: oidc.UserInfoResponse
      try {
        userInfo = await oidc.fetchUserInfo(
          configuration,
          accessToken,
          claims.sub,
        )
      } catch (error) {
        throw new ProviderFailure(this.publicError(error, "callback"), error)
      }
      if (userInfo.sub !== claims.sub) {
        throw new ProviderFailure(INVALID_RESPONSE)
      }
      identityClaims = userInfo as Record<string, unknown>
    }

    if (
      typeof identityClaims.email !== "string" ||
      identityClaims.email.length === 0 ||
      identityClaims.email_verified !== true
    ) {
      throw new ProviderFailure(INVALID_RESPONSE)
    }

    return {
      issuer: this.config_.issuer,
      subject: claims.sub,
      clientId: this.config_.clientId,
      actorType: this.config_.actorType,
      email: identityClaims.email,
      ...(stringClaim(identityClaims.name)
        ? { name: stringClaim(identityClaims.name) }
        : {}),
      ...(stringClaim(identityClaims.given_name)
        ? { given_name: stringClaim(identityClaims.given_name) }
        : {}),
      ...(stringClaim(identityClaims.family_name)
        ? { family_name: stringClaim(identityClaims.family_name) }
        : {}),
    }
  }

  private async resolveIdentity(
    authIdentityService: AuthIdentityProviderService,
    claims: VerifiedClaims,
  ) {
    const id = entityId(
      claims.issuer,
      claims.subject,
      claims.clientId,
      claims.actorType,
    )
    const providerMetadata = {
      issuer: claims.issuer,
      subject: claims.subject,
      client_id: claims.clientId,
      actor_type: claims.actorType,
    }
    const userMetadata = {
      email: claims.email,
      email_verified: true,
      ...(claims.name ? { name: claims.name } : {}),
      ...(claims.given_name ? { given_name: claims.given_name } : {}),
      ...(claims.family_name ? { family_name: claims.family_name } : {}),
    }

    return this.stateStore_.withLock(id, async () => {
      let existing
      try {
        existing = await authIdentityService.retrieve({ entity_id: id })
      } catch (error) {
        if (!isNotFound(error)) {
          throw new ProviderFailure(PROVIDER_UNAVAILABLE, error)
        }
      }

      if (!existing) {
        if (claims.actorType === "user") {
          throw new ProviderFailure(NOT_AUTHORIZED)
        }
        try {
          return await authIdentityService.create({
            entity_id: id,
            provider_metadata: providerMetadata,
            user_metadata: userMetadata,
          })
        } catch (error) {
          throw new ProviderFailure(PROVIDER_UNAVAILABLE, error)
        }
      }

      const identity = existing.provider_identities?.find(
        // Medusa persists the configured provider instance ID, not the class identifier.
        (candidate) => candidate.provider === `encvoy-${this.config_.actorType}`,
      )
      const existingMetadata = identity?.provider_metadata
      if (
        existingMetadata?.issuer !== providerMetadata.issuer ||
        existingMetadata?.subject !== providerMetadata.subject ||
        existingMetadata?.client_id !== providerMetadata.client_id ||
        existingMetadata?.actor_type !== providerMetadata.actor_type
      ) {
        throw new ProviderFailure(IDENTITY_CONFLICT)
      }

      if (claims.actorType === "user") {
        const appMetadata = existing.app_metadata ?? {}
        if (
          typeof appMetadata.user_id !== "string" ||
          appMetadata.user_id.length === 0 ||
          Object.prototype.hasOwnProperty.call(appMetadata, "customer_id")
        ) {
          throw new ProviderFailure(NOT_AUTHORIZED)
        }
      }

      try {
        return await authIdentityService.update(id, {
          provider_metadata: providerMetadata,
          user_metadata: userMetadata,
        })
      } catch (error) {
        throw new ProviderFailure(PROVIDER_UNAVAILABLE, error)
      }
    })
  }

  private hasExpectedOrigin(input: RuntimeAuthInput): boolean {
    const origin = readHeader(input.headers, "origin")
    return origin === this.config_.browserOrigin
  }

  private isAllowedEndpoint(value: unknown): boolean {
    if (typeof value !== "string") {
      return false
    }
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return false
    }
    if (!url.hostname || url.username || url.password || url.hash) {
      return false
    }
    if (url.protocol === "https:") {
      return true
    }
    return Boolean(
      this.config_.allowInsecureLocalhost &&
      url.protocol === "http:" &&
      LOCAL_OIDC_HOSTS.has(url.hostname),
    )
  }

  private stateBinding(): string {
    return JSON.stringify([
      this.config_.issuer,
      this.config_.clientId,
      this.config_.actorType,
      this.config_.callbackUrl,
      this.config_.browserOrigin,
      this.config_.cookieName,
    ])
  }

  private hasFixedCallbackOverrides(
    body: Record<string, string> | undefined,
  ): boolean {
    if (!body) {
      return true
    }

    for (const key of ["callback_url", "callbackUrl", "return_to", "returnTo"]) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        if (typeof body[key] !== "string" || body[key] !== this.config_.callbackUrl) {
          return false
        }
      }
    }
    return true
  }

  private routeMatches(input: RuntimeAuthInput, callback: boolean): boolean {
    const route = authRoute(input.url)
    if (!route) {
      return false
    }
    return (
      route.actorType === this.config_.actorType &&
      route.providerId === `encvoy-${this.config_.actorType}` &&
      route.callback === callback
    )
  }

  private publicError(
    error: unknown,
    context: "provider" | "callback",
  ): string {
    if (error instanceof ProviderFailure) {
      return error.code
    }

    const name = error instanceof Error ? error.name : ""
    if (["AbortError", "TimeoutError", "TypeError", "NetworkError"].includes(name)) {
      return PROVIDER_UNAVAILABLE
    }
    return context === "provider" ? PROVIDER_UNAVAILABLE : INVALID_RESPONSE
  }

  private reportFailure(
    error: unknown,
    stage: DiagnosticStage,
    context: "provider" | "callback",
  ): string {
    const publicError = this.publicError(error, context)
    try {
      this.logger_?.warn(JSON.stringify({
        event: "encvoy_auth_failure",
        stage,
        actor_type: this.config_.actorType,
        public_error: publicError,
        cause: diagnosticCause(error),
      }))
    } catch {
      // Diagnostics must never change authentication behavior.
    }
    return publicError
  }
}

export function entityId(
  issuer: string,
  subject: string,
  clientId: string,
  actorType: EncvoyActorType,
): string {
  return createHash("sha256")
    .update(JSON.stringify([issuer, subject, clientId, actorType]), "utf8")
    .digest("hex")
}

class ProviderFailure extends Error {
  constructor(readonly code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause })
    this.name = "ProviderFailure"
  }
}

const NETWORK_CAUSE_CLASSES = new Map<string, string>([
  ["ECONNREFUSED", "ECONNREFUSED"],
  ["ETIMEDOUT", "ETIMEDOUT"],
  ["ECONNRESET", "ECONNRESET"],
  ["UND_ERR_SOCKET", "UND_ERR_SOCKET"],
  ["EHOSTUNREACH", "EHOSTUNREACH"],
  ["ENETUNREACH", "ENETUNREACH"],
  ["EAI_AGAIN", "DNS_RETRY"],
  ["ENOTFOUND", "DNS_NOT_FOUND"],
])

const OIDC_CAUSE_CODES = new Map<string, string>([
  ["OAUTH_RESPONSE_BODY_ERROR", "OAUTH_RESPONSE_BODY_ERROR"],
  ["OAUTH_AUTHORIZATION_RESPONSE_ERROR", "OAUTH_AUTHORIZATION_RESPONSE_ERROR"],
  ["OAUTH_WWW_AUTHENTICATE_CHALLENGE", "OAUTH_WWW_AUTHENTICATE_CHALLENGE"],
  ["OAUTH_UNSUPPORTED_OPERATION", "OAUTH_UNSUPPORTED_OPERATION"],
  ["OAUTH_PARSE_ERROR", "OAUTH_PARSE_ERROR"],
  ["OAUTH_INVALID_RESPONSE", "OAUTH_INVALID_RESPONSE"],
  ["OAUTH_INVALID_REQUEST", "OAUTH_INVALID_REQUEST"],
  ["OAUTH_RESPONSE_IS_NOT_JSON", "OAUTH_RESPONSE_IS_NOT_JSON"],
  ["OAUTH_RESPONSE_IS_NOT_CONFORM", "OAUTH_RESPONSE_IS_NOT_CONFORM"],
  ["OAUTH_HTTP_REQUEST_FORBIDDEN", "OAUTH_HTTP_REQUEST_FORBIDDEN"],
  ["OAUTH_REQUEST_PROTOCOL_FORBIDDEN", "OAUTH_REQUEST_PROTOCOL_FORBIDDEN"],
  ["OAUTH_JWT_TIMESTAMP_CHECK_FAILED", "OAUTH_JWT_TIMESTAMP_CHECK_FAILED"],
  ["OAUTH_JWT_CLAIM_COMPARISON_FAILED", "OAUTH_JWT_CLAIM_COMPARISON_FAILED"],
  ["OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED", "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED"],
  ["OAUTH_KEY_SELECTION_FAILED", "OAUTH_KEY_SELECTION_FAILED"],
  ["OAUTH_MISSING_SERVER_METADATA", "OAUTH_MISSING_SERVER_METADATA"],
  ["OAUTH_INVALID_SERVER_METADATA", "OAUTH_INVALID_SERVER_METADATA"],
])

const OIDC_ERROR_CLASSES = new Map<string, string>([
  ["invalid_client", "OIDC_INVALID_CLIENT"],
  ["invalid_grant", "OIDC_INVALID_GRANT"],
  ["invalid_request", "OIDC_INVALID_REQUEST"],
  ["unauthorized_client", "OIDC_UNAUTHORIZED_CLIENT"],
  ["unsupported_grant_type", "OIDC_UNSUPPORTED_GRANT_TYPE"],
  ["invalid_scope", "OIDC_INVALID_SCOPE"],
  ["access_denied", "OIDC_ACCESS_DENIED"],
  ["server_error", "OIDC_SERVER_ERROR"],
  ["temporarily_unavailable", "OIDC_TEMPORARILY_UNAVAILABLE"],
])

const POSTGRES_CAUSE_CLASSES = new Map<string, string>([
  ["08", "POSTGRES_CONNECTION"],
  ["28", "POSTGRES_AUTHENTICATION"],
  ["40", "POSTGRES_TRANSACTION"],
  ["53", "POSTGRES_RESOURCE"],
  ["55", "POSTGRES_LOCK"],
  ["57", "POSTGRES_SERVER"],
  ["XX", "POSTGRES_INTERNAL"],
])

function diagnosticCause(error: unknown): string {
  const visited = new Set<unknown>()
  const pending: unknown[] = [error]
  for (let depth = 0; depth < 16 && pending.length > 0; depth++) {
    const current = pending.shift()
    if (current === null || current === undefined) {
      continue
    }
    if (visited.has(current)) {
      continue
    }
    visited.add(current)

    if (typeof current !== "object" && typeof current !== "function") {
      continue
    }

    let code: unknown
    let oauthError: unknown
    let cause: unknown
    let errors: unknown
    let message: unknown
    try {
      code = (current as { code?: unknown }).code
      oauthError = (current as { error?: unknown }).error
      cause = (current as { cause?: unknown }).cause
      errors = (current as { errors?: unknown }).errors
      message = (current as { message?: unknown }).message
    } catch {
      continue
    }

    if (typeof oauthError === "string") {
      const oidcClass = OIDC_ERROR_CLASSES.get(oauthError)
      if (oidcClass) {
        return oidcClass
      }
    }
    if (typeof code === "string") {
      const networkClass = NETWORK_CAUSE_CLASSES.get(code)
      if (networkClass) {
        return networkClass
      }
      const oidcClass = OIDC_CAUSE_CODES.get(code)
      if (oidcClass) {
        return oidcClass
      }
      if (/^[0-9A-Z]{5}$/.test(code)) {
        const postgresClass = POSTGRES_CAUSE_CLASSES.get(code.slice(0, 2))
        if (postgresClass) {
          return postgresClass
        }
      }
    }
    if (message === "timeout exceeded when trying to connect") {
      return "POOL_CONNECTION_TIMEOUT"
    }

    if (cause !== undefined) {
      pending.push(cause)
    }
    if (Array.isArray(errors)) {
      pending.push(...errors.slice(0, 16))
    }
  }
  return "UNKNOWN"
}

function failure(error: string): AuthenticationResponse {
  return { success: false, error }
}

function readBrowserProof(
  headers: Record<string, string> | undefined,
  cookieName: string,
): string | null {
  const cookieHeader = readHeader(headers, "cookie")
  if (typeof cookieHeader !== "string") {
    return null
  }

  let proof: string | null = null
  for (const segment of cookieHeader.split(";")) {
    const separator = segment.indexOf("=")
    if (separator < 0) {
      continue
    }
    if (segment.slice(0, separator).trim() !== cookieName) {
      continue
    }
    if (proof !== null) {
      return null
    }
    const value = segment.slice(separator + 1).trim()
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
      return null
    }
    proof = value
  }
  return proof
}

function readHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined
  }
  const values = Object.entries(headers).filter(
    ([key]) => key.toLowerCase() === name,
  )
  if (values.length !== 1 || typeof values[0][1] !== "string") {
    return undefined
  }
  return values[0][1]
}

function readParameter(
  input: RuntimeAuthInput,
  key: string,
): { ok: true; value?: string } | { ok: false } {
  const values: unknown[] = []
  for (const source of [input.query, input.body]) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) {
      values.push((source as Record<string, unknown>)[key])
    }
  }
  if (values.length === 0) {
    return { ok: true }
  }
  if (values.some((value) => typeof value !== "string")) {
    return { ok: false }
  }
  const strings = values as string[]
  if (strings.some((value) => value !== strings[0])) {
    return { ok: false }
  }
  return { ok: true, value: strings[0] }
}

function authRoute(
  requestUrl: string | undefined,
): { actorType: string; providerId: string; callback: boolean } | null {
  if (typeof requestUrl !== "string") {
    return null
  }
  let pathname: string
  try {
    pathname = new URL(requestUrl, "https://encvoy.invalid").pathname
  } catch {
    return null
  }
  const segments = pathname.split("/").filter(Boolean)
  const authIndex = segments.lastIndexOf("auth")
  if (authIndex < 0 || segments.length < authIndex + 3) {
    return null
  }
  const callback = segments[authIndex + 3] === "callback"
  if (segments.length !== authIndex + (callback ? 4 : 3)) {
    return null
  }
  return {
    actorType: segments[authIndex + 1],
    providerId: segments[authIndex + 2],
    callback,
  }
}

function audienceContains(audience: unknown, clientId: string): boolean {
  return (
    audience === clientId ||
    (Array.isArray(audience) && audience.includes(clientId))
  )
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof MedusaError && error.type === MedusaError.Types.NOT_FOUND ||
    typeof error === "object" &&
      error !== null &&
      "type" in error &&
      (error as { type?: unknown }).type === MedusaError.Types.NOT_FOUND
  )
}
