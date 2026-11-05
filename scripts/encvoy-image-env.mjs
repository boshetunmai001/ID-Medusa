import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { fixturePassword } from "./lib/fixture-password.mjs";
import { restrictFileMode, setPrivateUmask } from "./lib/platform.mjs";

setPrivateUmask();

const root = fileURLToPath(new URL("../", import.meta.url));
const localDirectory = path.join(root, ".local");
const serviceEnvPath = path.join(localDirectory, "encvoy-image.env");
const fixtureEnvPath = path.join(localDirectory, "encvoy-image-fixtures.env");
const frontEnvPath = path.join(localDirectory, "encvoy-image-front.env");
const frontConfigPath = path.join(localDirectory, "encvoy-image-runtime-config.js");

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function renderEnv(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function renderFrontConfig(clientId, domain) {
  return `window.ENV_CONFIG = ${JSON.stringify({
    CLIENT_ID: clientId,
    DOMAIN: domain,
    BACKEND_URL: "",
    CUSTOM_STYLES: "",
    MANUAL_URL: "",
    COPYRIGHT: "",
    YANDEX_METRICA_ID: "",
    GOOGLE_METRICA_ID: "",
  }, null, 2)};\n`;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  await mkdir(localDirectory, { recursive: true, mode: 0o700 });
  const corePresent = await Promise.all([exists(serviceEnvPath), exists(fixtureEnvPath)]);
  if (corePresent.some(Boolean)) {
    if (!corePresent.every(Boolean)) {
      throw new Error("A partial private image environment exists; preserve it and restore the missing file before retrying");
    }
    const serviceEnv = parseEnv(await readFile(serviceEnvPath, "utf8"));
    const frontEnv = { ID_HOST: serviceEnv.ID_HOST, DOMAIN: serviceEnv.DOMAIN, CLIENT_ID: serviceEnv.CLIENT_ID };
    await Promise.all([
      writeFile(frontEnvPath, renderEnv(frontEnv), { mode: 0o600 }),
      writeFile(frontConfigPath, renderFrontConfig(serviceEnv.CLIENT_ID, serviceEnv.DOMAIN), { mode: 0o600 }),
      restrictFileMode(serviceEnvPath, 0o600),
      restrictFileMode(fixtureEnvPath, 0o600),
    ]);
    await Promise.all([restrictFileMode(frontEnvPath, 0o600), restrictFileMode(frontConfigPath, 0o600)]);
    console.log("Private Encvoy image environments exist; frontend receives only the public client ID and local domain.");
    return;
  }

  const postgresUser = "encvoy_image";
  const postgresDatabase = "encvoy_image";
  const postgresPassword = randomSecret(32);
  const adminLogin = "local-root";
  const adminPassword = randomSecret();
  const serviceEnv = {
    ID_HOST: "localhost",
    DOMAIN: "http://localhost:9090",
    ADMIN_LOGIN: adminLogin,
    ADMIN_PASSWORD: adminPassword,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDatabase,
    ADMIN_MAIL: "encvoy-admin@medusa-encvoy.invalid",
    REDIS_HOST: "id-redis",
    REDIS_PORT: "6379",
    DATABASE_URL: `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(postgresPassword)}@id-db:5432/${postgresDatabase}`,
    CLIENT_ID: randomUUID(),
    CLIENT_SECRET: randomSecret(),
  };

  const fixtureEnv = {
    ENCVOY_IMAGE_INITIAL_ADMIN_LOGIN: adminLogin,
    ENCVOY_IMAGE_INITIAL_ADMIN_PASSWORD: adminPassword,
    ENCVOY_IMAGE_ADMIN_PASSWORD: adminPassword,
    ENCVOY_IMAGE_INITIAL_EDITOR_LOGIN: "admin",
    ENCVOY_IMAGE_INITIAL_EDITOR_PASSWORD: "",
    ENCVOY_IMAGE_EDITOR_PASSWORD: fixturePassword(),
    ENCVOY_CUSTOMER_LOGIN: "customer.medusa-encvoy.invalid",
    ENCVOY_CUSTOMER_EMAIL: "customer@medusa-encvoy.invalid",
    ENCVOY_CUSTOMER_PASSWORD: fixturePassword(),
    ENCVOY_EMPLOYEE_LOGIN: "employee.medusa-encvoy.invalid",
    ENCVOY_EMPLOYEE_EMAIL: "employee@medusa-encvoy.invalid",
    ENCVOY_EMPLOYEE_PASSWORD: fixturePassword(),
    ENCVOY_OUTSIDER_LOGIN: "outsider.medusa-encvoy.invalid",
    ENCVOY_OUTSIDER_EMAIL: "outsider@medusa-encvoy.invalid",
    ENCVOY_OUTSIDER_PASSWORD: fixturePassword(),
  };
  const frontEnv = {
    ID_HOST: "localhost",
    DOMAIN: "http://localhost:9090",
    CLIENT_ID: serviceEnv.CLIENT_ID,
  };

  await writeFile(serviceEnvPath, renderEnv(serviceEnv), { flag: "wx", mode: 0o600 });
  try {
    await writeFile(fixtureEnvPath, renderEnv(fixtureEnv), { flag: "wx", mode: 0o600 });
    await writeFile(frontEnvPath, renderEnv(frontEnv), { flag: "wx", mode: 0o600 });
    await writeFile(frontConfigPath, renderFrontConfig(serviceEnv.CLIENT_ID, serviceEnv.DOMAIN), { flag: "wx", mode: 0o600 });
  } catch (error) {
    throw new Error("Could not create every private image environment; preserve existing values and inspect local setup");
  }
  await Promise.all([restrictFileMode(serviceEnvPath, 0o600), restrictFileMode(fixtureEnvPath, 0o600), restrictFileMode(frontEnvPath, 0o600), restrictFileMode(frontConfigPath, 0o600)]);
  console.log("Created private Encvoy image service, frontend, and synthetic fixture environments.");
}

main().catch(() => {
  console.error("Could not prepare private Encvoy image environments.");
  process.exitCode = 1;
});
