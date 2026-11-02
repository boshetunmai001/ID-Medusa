import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const privateDirectory = path.join(root, ".local");
const sourcePath = path.join(privateDirectory, "infra.env");
const targetPath = path.join(privateDirectory, "encvoy.env");

function parseEnv(source) {
  const entries = new Map();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith("#")) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(match[1], value);
  }
  return entries;
}

function randomSecret() {
  return randomBytes(32).toString("hex");
}

await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
try {
  await access(targetPath);
  console.log("Local Encvoy configuration already exists; no files changed.");
  process.exit(0);
} catch {
  // Create an isolated Encvoy configuration from the workspace's private infra config.
}

const infra = parseEnv(await readFile(sourcePath, "utf8"));
const required = [
  "LOCAL_DATABASE_PASSWORD",
  "ADMIN_LOGIN",
  "ADMIN_PASSWORD",
  "CLIENT_ID",
  "OIDC_COOKIE_SECRET",
];
const missing = required.filter((key) => !infra.get(key));
if (missing.length) {
  throw new Error(`Missing required local infrastructure settings: ${missing.join(", ")}`);
}

const sourceDatabaseUrl = new URL("postgresql://medusa@127.0.0.1:55433/encvoy_source");
sourceDatabaseUrl.password = infra.get("LOCAL_DATABASE_PASSWORD");

const values = new Map([
  ["NODE_ENV", "development"],
  ["DOMAIN", "http://localhost:9090"],
  ["VITE_DOMAIN", "http://localhost:9090"],
  ["ID_HOST", "localhost:9090"],
  ["ID_BASE_PATH", ""],
  ["DATABASE_URL", sourceDatabaseUrl.href],
  ["CLIENT_ID", infra.get("CLIENT_ID")],
  ["ADMIN_LOGIN", infra.get("ADMIN_LOGIN")],
  ["ADMIN_PASSWORD", infra.get("ADMIN_PASSWORD")],
  ["OIDC_COOKIE_SECRET", infra.get("OIDC_COOKIE_SECRET")],
  ["REDIS_HOST", "127.0.0.1"],
  ["REDIS_PORT", "56379"],
  ["OIDC_SESSION_TTL", "86400"],
  ["ENCVOY_PORT", "9090"],
  ["ENCVOY_CUSTOMER_LOGIN", "stand-customer"],
  ["ENCVOY_CUSTOMER_PASSWORD", randomSecret()],
  ["ENCVOY_CUSTOMER_EMAIL", "customer@medusa-encvoy.invalid"],
  ["ENCVOY_EMPLOYEE_LOGIN", "stand-employee"],
  ["ENCVOY_EMPLOYEE_PASSWORD", randomSecret()],
  ["ENCVOY_EMPLOYEE_EMAIL", "employee@medusa-encvoy.invalid"],
  ["ENCVOY_OUTSIDER_LOGIN", "stand-outsider"],
  ["ENCVOY_OUTSIDER_PASSWORD", randomSecret()],
  ["ENCVOY_OUTSIDER_EMAIL", "outsider@medusa-encvoy.invalid"],
  ["ENCVOY_ADMIN_DECOY_PASSWORD", randomSecret()],
]);

await writeFile(
  targetPath,
  `${Array.from(values, ([key, value]) => `${key}=${value}`).join("\n")}\n`,
  { flag: "wx", mode: 0o600 },
);
await access(targetPath);
console.log("Created private local Encvoy configuration in .local/encvoy.env; no secrets were printed.");
