import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, ".local");
await mkdir(directory, { recursive: true, mode: 0o700 });
const destination = path.join(directory, "infra.env");
try {
  await access(destination);
  console.log("Local configuration already exists; no files changed.");
} catch {
  const secret = () => randomBytes(32).toString("hex");
  const databasePassword = secret();
  const values = {
    LOCAL_DATABASE_PASSWORD: databasePassword,
    DATABASE_URL: `postgresql://medusa:${databasePassword}@127.0.0.1:55432/medusa`,
    ENCVOY_DATABASE_URL: `postgresql://medusa:${databasePassword}@127.0.0.1:55432/encvoy`,
    REDIS_URL: "redis://127.0.0.1:56379/1",
    ENCVOY_ISSUER: "http://localhost:9090",
    CLIENT_ID: randomUUID(),
    ADMIN_LOGIN: "local-owner",
    ADMIN_PASSWORD: secret(),
    OIDC_COOKIE_SECRET: secret(),
    JWT_SECRET: secret(),
    COOKIE_SECRET: secret(),
  };
  await writeFile(destination, Object.entries(values).map(([k,v]) => `${k}=${v}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  console.log("Created private local configuration in .local/infra.env. No secrets were printed.");
}
