import { defineConfig, loadEnv } from "@medusajs/framework/utils";
import { logger } from "@medusajs/framework/logger";
const { adminSecurityHeadersPlugin } = require("./src/admin/lib/security-headers.ts");

loadEnv(process.env.NODE_ENV || "development", process.cwd());

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const origin = required("MEDUSA_BROWSER_ORIGIN");
const employeeJwtLifetimeSeconds = 30 * 60;
const localHttp = process.env.ENCVOY_ALLOW_INSECURE_LOCALHOST === "true";
if (localHttp && (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(new URL(origin).hostname))) {
  throw new Error("Local HTTP mode is restricted to loopback development.");
}
if (!localHttp && new URL(origin).protocol !== "https:") throw new Error("HTTPS is required.");

// HTTP logs include callback queries and referrers. Disable them before routing.
const safeLogger = Object.create(logger) as typeof logger;
safeLogger.shouldLog = (level: string) => level !== "http" && logger.shouldLog(level);
safeLogger.http = () => {};

const provider = (actorType: "customer" | "user") => ({
  resolve: "medusa-plugin-encvoy-id",
  id: `encvoy-${actorType}`,
  options: {
    actorType,
    issuer: required("ENCVOY_ISSUER"),
    clientId: required(`ENCVOY_${actorType.toUpperCase()}_CLIENT_ID`),
    clientSecret: required(`ENCVOY_${actorType.toUpperCase()}_CLIENT_SECRET`),
    callbackUrl: `${origin}${actorType === "customer" ? "/demo/callback" : "/app/login"}`,
    browserOrigin: origin,
    databaseUrl: required("DATABASE_URL"),
    employeeGrantLifetimeSeconds: employeeJwtLifetimeSeconds,
    allowInsecureLocalhost: localHttp,
  },
});

module.exports = defineConfig({
  logger: safeLogger,
  projectConfig: {
    databaseUrl: required("DATABASE_URL"),
    redisUrl: required("REDIS_URL"),
    cookieOptions: { httpOnly: true, secure: !localHttp, sameSite: "lax", maxAge: 30 * 60 * 1000 },
    sessionOptions: { name: "medusa_encvoy_session", resave: false, saveUninitialized: false },
    http: {
      storeCors: origin,
      adminCors: origin,
      authCors: origin,
      jwtSecret: required("JWT_SECRET"),
      cookieSecret: required("COOKIE_SECRET"),
      jwtExpiresIn: `${employeeJwtLifetimeSeconds}s`,
      authMethodsPerActor: { customer: ["encvoy-customer"], user: ["encvoy-user"] },
    },
  },
  admin: {
    backendUrl: origin,
    vite: () => ({ plugins: [adminSecurityHeadersPlugin] }),
  },
  modules: [{ resolve: "@medusajs/medusa/auth", options: { providers: [provider("customer"), provider("user")] } }],
});
