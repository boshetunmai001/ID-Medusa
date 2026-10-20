import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";

const root = new URL("../", import.meta.url);
const infrastructure = parseEnv(await readFile(new URL(".local/infra.env", root), "utf8"));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--clients")) {
  throw new Error("Usage: node scripts/configure-medusa.mjs [--clients path/to/private-clients.env]");
}
const clientFile = args.length ? resolve(args[1]) : new URL(".local/encvoy-clients.env", root);
let clients = {};
try {
  clients = parseEnv(await readFile(clientFile, "utf8"));
} catch (error) {
  if (args.length || error.code !== "ENOENT") throw new Error("Could not read the private client configuration.");
}
if (args.length && ["ENCVOY_CUSTOMER_CLIENT_ID", "ENCVOY_CUSTOMER_CLIENT_SECRET", "ENCVOY_USER_CLIENT_ID", "ENCVOY_USER_CLIENT_SECRET"].some((key) => !clients[key])) {
  throw new Error("The private client file must contain both client IDs and secrets.");
}
const config = {
  NODE_ENV: "development", HOST: "127.0.0.1", PORT: "9000",
  DATABASE_URL: infrastructure.DATABASE_URL, REDIS_URL: infrastructure.REDIS_URL,
  JWT_SECRET: infrastructure.JWT_SECRET, COOKIE_SECRET: infrastructure.COOKIE_SECRET,
  MEDUSA_BROWSER_ORIGIN: "http://localhost:9000", ADMIN_AUTH_TYPE: "jwt", MEDUSA_DISABLE_TELEMETRY: "true",
  ENCVOY_ISSUER: infrastructure.ENCVOY_ISSUER, ENCVOY_ALLOW_INSECURE_LOCALHOST: "true",
  ENCVOY_CUSTOMER_CLIENT_ID: clients.ENCVOY_CUSTOMER_CLIENT_ID || "pending-local-registration",
  ENCVOY_CUSTOMER_CLIENT_SECRET: clients.ENCVOY_CUSTOMER_CLIENT_SECRET || "pending-local-registration",
  ENCVOY_USER_CLIENT_ID: clients.ENCVOY_USER_CLIENT_ID || "pending-local-registration",
  ENCVOY_USER_CLIENT_SECRET: clients.ENCVOY_USER_CLIENT_SECRET || "pending-local-registration",
};
await writeFile(new URL("examples/medusa/.env", root), Object.entries(config).map(([key,value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
console.log(clients.ENCVOY_CUSTOMER_CLIENT_ID ? "Wrote private Medusa configuration with registered clients." : "Wrote development configuration. Login remains unavailable until real clients are registered.");
