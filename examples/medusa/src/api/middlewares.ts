import { randomBytes } from "node:crypto";
import { authenticate, defineMiddlewares, MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

const origin = () => process.env.MEDUSA_BROWSER_ORIGIN!;

function browserPost(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  res.setHeader("Cache-Control", "no-store");
  if (req.headers.origin !== origin()) return res.status(403).json({ message: "invalid_origin" });
  next();
}

function authBrowser(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  if (req.method !== "POST") return res.status(405).json({ message: "use_post" });
  if (req.headers.origin !== origin()) return res.status(403).json({ message: "invalid_origin" });
  const path = req.originalUrl.split("?")[0];
  const match = /^\/auth\/(customer|user)\/encvoy-(customer|user)(\/callback)?$/.exec(path);
  if (!match || match[1] !== match[2]) return res.status(403).json({ message: "invalid_actor" });
  res.setHeader("Cache-Control", "no-store");
  if (!match[3]) {
    const name = `encvoy_${match[1]}_browser`;
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

const denyProvisioning = (_req: MedusaRequest, res: MedusaResponse) => res.status(403).json({ message: "Use the Encvoy account completion endpoint. Automatic account linking is disabled." });

export default defineMiddlewares({
  routes: [
    { matcher: "/auth/:actor/encvoy-:provider", middlewares: [authBrowser] },
    { matcher: "/auth/:actor/encvoy-:provider/callback", middlewares: [authBrowser] },
    { matcher: "/auth/:actor/encvoy-:provider/register", middlewares: [denyProvisioning] },
    { matcher: "/auth/:provider/user", middlewares: [denyProvisioning] },
    { matcher: "/store/customers", methods: ["POST"], middlewares: [denyProvisioning] },
    { matcher: "/auth/session", methods: ["POST", "DELETE"], middlewares: [browserPost] },
    { matcher: "/auth/session", methods: ["POST"], middlewares: [authenticate("customer", "bearer"), regenerateSession] },
    // Override the native session-first context with the explicitly supplied token.
    { matcher: "/auth/token/refresh", methods: ["POST"], middlewares: [browserPost, authenticate("*", "bearer", { allowUnregistered: true, requireMfa: false })] },
    { matcher: "/encvoy/customer/complete", methods: ["POST"], middlewares: [browserPost, authenticate("customer", "bearer", { allowUnregistered: true })] },
    { matcher: "/encvoy/profile", methods: ["GET"], middlewares: [authenticate("customer", "session")] },
    { matcher: "/demo/profile", methods: ["GET"], middlewares: [authenticate("customer", "session")] },
    { matcher: /^\/demo(?:\/.*)?$/, middlewares: [headers] },
    { matcher: /^\/app(?:\/.*)?$/, middlewares: [headers] },
  ],
});
