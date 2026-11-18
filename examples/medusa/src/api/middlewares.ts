import { randomBytes } from "node:crypto";
import { authenticate, defineMiddlewares, MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { defaultBrowserCookieName, type EncvoyStateStore } from "medusa-plugin-encvoy-id";
import { requireActiveEncvoyEmployeeGrant, revokeEncvoyEmployeeGrantOnLogout } from "../lib/employee-auth";
import { stateStore } from "../lib/state-store";

const origin = () => process.env.MEDUSA_BROWSER_ORIGIN!;

function browserPost(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.origin !== origin()) return res.status(403).json({ message: "invalid_origin" });
  next();
}

function redirectProfileNavigation(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const acceptedTypes = (req.headers.accept || "").split(",").map((value) => {
    const [type, ...parameters] = value.trim().toLowerCase().split(";");
    const quality = parameters.find((parameter) => /^\s*q\s*=/.test(parameter));
    return { type, quality: quality ? Number(quality.split("=")[1]) : 1 };
  });
  const qualityFor = (type: string) => acceptedTypes.find((accepted) => accepted.type === type)?.quality || 0;
  const htmlQuality = Math.max(qualityFor("text/html"), qualityFor("application/xhtml+xml"));
  if (htmlQuality > 0 && htmlQuality >= qualityFor("application/json")) return res.redirect(302, "/demo/profile");
  next();
}

export function authBrowser(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  if (req.method !== "POST") return res.status(405).json({ message: "use_post" });
  if (req.headers.origin !== origin()) return res.status(403).json({ message: "invalid_origin" });
  const path = req.originalUrl.split("?")[0];
  const match = /^\/auth\/(customer|user)\/encvoy-(customer|user)(\/callback)?$/.exec(path);
  if (!match || match[1] !== match[2]) return res.status(403).json({ message: "invalid_actor" });
  res.setHeader("Cache-Control", "no-store");
  if (!match[3]) {
    const name = defaultBrowserCookieName(
      match[1] as "customer" | "user",
      process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST !== "true",
    );
    const cookie = req.headers.cookie || "";
    const values = cookie.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
    if (values.length > 1) return res.status(400).json({ message: "invalid_browser_cookie" });
    const proof = values.length && new RegExp(`^${name}=[A-Za-z0-9_-]{43}$`).test(values[0])
      ? values[0].slice(name.length + 1)
      : randomBytes(32).toString("base64url");
    // Extend the lifetime of the same proof so pending parallel flows stay valid.
    res.cookie(name, proof, { httpOnly: true, secure: process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST !== "true", sameSite: "lax", path: "/auth", maxAge: 600_000 });
    req.headers.cookie = [...cookie.split(";").filter((part) => !part.trim().startsWith(`${name}=`)), `${name}=${proof}`].filter(Boolean).join("; ");
  }
  next();
}

function headers(_req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
}

function regenerateSession(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  req.session.regenerate((error: Error | null) => next(error || undefined));
}

export async function hydrateCompletedCustomer(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const auth = (req as unknown as { auth_context?: {
    actor_id?: string;
    actor_type?: string;
    auth_identity_id?: string;
    auth_provider?: string;
    app_metadata?: Record<string, unknown>;
  } }).auth_context;
  if (auth?.auth_provider !== "encvoy-customer") return next();
  if (!auth.auth_identity_id) return res.status(401).json({ message: "invalid_customer_identity" });

  try {
    const identity = await req.scope.resolve(Modules.AUTH).retrieveAuthIdentity(auth.auth_identity_id);
    const customerId = identity.app_metadata?.customer_id;
    if (typeof customerId !== "string" || !customerId || identity.app_metadata?.user_id) {
      return res.status(401).json({ message: "customer_account_not_completed" });
    }
    // The callback JWT predates account completion. Resolve the persisted link
    // before creating a session, so Medusa receives a registered customer actor.
    auth.actor_id = customerId;
    auth.actor_type = "customer";
    auth.app_metadata = identity.app_metadata;
    next();
  } catch {
    res.status(503).json({ message: "customer_identity_check_unavailable" });
  }
}

export async function consumeEncvoyJwt(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
  store: Pick<EncvoyStateStore, "initialize" | "consumeMedusaJwt"> = stateStore(),
) {
  const authContext = (req as unknown as { auth_context?: Record<string, unknown> }).auth_context;
  if (authContext?.auth_provider !== "encvoy-customer") return next();

  const authorization = req.headers.authorization || "";
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
  const expiresAt = authContext.exp;
  if (!token || typeof expiresAt !== "number") {
    return res.status(401).json({ message: "invalid_token" });
  }

  try {
    await store.initialize();
    const firstUse = await store.consumeMedusaJwt(token, expiresAt);
    if (!firstUse) return res.status(401).json({ message: "token_already_used" });
    next();
  } catch (error) {
    next(error);
  }
}

function denyEncvoyRefresh(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const provider = (req as unknown as { auth_context?: { auth_provider?: string } }).auth_context?.auth_provider;
  if (provider === "encvoy-customer" || provider === "encvoy-user") {
    return res.status(401).json({ message: "reauthentication_required" });
  }
  next();
}

const denyProvisioning = (_req: MedusaRequest, res: MedusaResponse) => res.status(403).json({ message: "Use the Encvoy account completion endpoint. Automatic account linking is disabled." });

export default defineMiddlewares({
  routes: [
    { matcher: "/auth/:actor/encvoy-:provider", middlewares: [authBrowser] },
    { matcher: "/auth/:actor/encvoy-:provider/callback", middlewares: [authBrowser] },
    { matcher: "/auth/:actor/encvoy-:provider/register", middlewares: [denyProvisioning] },
    { matcher: "/auth/:provider/user", middlewares: [denyProvisioning] },
    { matcher: "/store/customers", methods: ["POST"], middlewares: [denyProvisioning] },
    { matcher: "/auth/session", methods: ["POST", "DELETE"], middlewares: [browserPost] },
    { matcher: "/auth/session", methods: ["POST"], middlewares: [authenticate("*", "bearer", { allowUnregistered: true, requireMfa: false }), hydrateCompletedCustomer, consumeEncvoyJwt, requireActiveEncvoyEmployeeGrant, regenerateSession] },
    { matcher: "/auth/session", methods: ["DELETE"], middlewares: [authenticate("*", "session", { allowUnauthenticated: true, requireMfa: false }), revokeEncvoyEmployeeGrantOnLogout] },
    // Override the native session-first context with the explicitly supplied token.
    { matcher: "/auth/token/refresh", methods: ["POST"], middlewares: [browserPost, authenticate("*", "bearer", { allowUnregistered: true, requireMfa: false }), denyEncvoyRefresh] },
    // Resolve a supplied JWT before enforcing employee-grant revocation. Native
    // route authentication still enforces authorization for all other requests.
    { matcher: /^\/admin(?:\/.*)?$/, middlewares: [authenticate("user", ["session", "bearer", "api-key"], { allowUnauthenticated: true }), requireActiveEncvoyEmployeeGrant] },
    { matcher: "/encvoy/customer/complete", methods: ["POST"], middlewares: [browserPost, authenticate("customer", "bearer", { allowUnregistered: true })] },
    { matcher: "/encvoy/profile", methods: ["GET"], middlewares: [redirectProfileNavigation, authenticate("customer", "session")] },
    { matcher: /^\/demo(?:\/.*)?$/, middlewares: [headers] },
  ],
});
