import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const serviceEnvFile = new URL(".local/encvoy-image.env", root);
const imageSeedContainer = "medusa-encvoy-image-id-back-1";
const expectedDomain = "http://localhost:9090";
const localDatabases = new Set(["/encvoy_image", "/encvoy_image_secure_seed"]);

const containerCheck = `
const fs = require("node:fs");
(async () => {
  const expected = JSON.parse(fs.readFileSync(0, "utf8"));
  if (process.env.DOMAIN !== expected.domain
    || process.env.DATABASE_URL !== expected.databaseUrl
    || process.env.ADMIN_LOGIN !== expected.adminLogin
    || process.env.ADMIN_PASSWORD !== expected.adminPassword) {
    process.exitCode = 20;
    return;
  }

  const { PrismaClient } = require("@prisma/client");
  const bcrypt = require("bcrypt");
  const prisma = new PrismaClient();
  try {
    const rootUser = await prisma.user.findUnique({
      where: { id: 1 },
      select: { id: true, login: true, hashed_password: true },
    });
    if (rootUser?.id === 1
      && rootUser.login === expected.adminLogin
      && await bcrypt.compare(expected.adminPassword, rootUser.hashed_password)) {
      process.stdout.write("image-seed-verified\\n");
    } else {
      process.exitCode = 21;
    }
  } finally {
    await prisma.$disconnect();
  }
})().catch(() => {
  process.exitCode = 22;
});
`;

function validateEnvironment(environment) {
  if (environment.DOMAIN !== expectedDomain
    || environment.ADMIN_LOGIN !== "local-root"
    || typeof environment.ADMIN_PASSWORD !== "string"
    || Buffer.byteLength(environment.ADMIN_PASSWORD, "utf8") < 32) {
    throw new Error("Image seed configuration is not valid.");
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(environment.DATABASE_URL);
  } catch {
    throw new Error("Image seed configuration is not valid.");
  }
  if (databaseUrl.protocol !== "postgresql:"
    || databaseUrl.hostname !== "id-db"
    || databaseUrl.port !== "5432"
    || !localDatabases.has(databaseUrl.pathname)
    || !databaseUrl.username
    || !databaseUrl.password
    || databaseUrl.search
    || databaseUrl.hash) {
    throw new Error("Image seed configuration is not valid.");
  }
}

export async function verifyImageSeed(environment) {
  try {
    const localEnvironment = environment ?? parseEnv(await readFile(serviceEnvFile, "utf8"));
    validateEnvironment(localEnvironment);

    const result = spawnSync("docker", [
      "exec", "-i", imageSeedContainer, "node", "-e", containerCheck,
    ], {
      input: JSON.stringify({
        domain: localEnvironment.DOMAIN,
        databaseUrl: localEnvironment.DATABASE_URL,
        adminLogin: localEnvironment.ADMIN_LOGIN,
        adminPassword: localEnvironment.ADMIN_PASSWORD,
      }),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 16 * 1024,
      windowsHide: true,
    });

    if (result.error || result.status !== 0 || result.stdout.trim() !== "image-seed-verified") {
      throw new Error("Image seed verification failed.");
    }
    return true;
  } catch {
    throw new Error("Image seed verification failed.");
  }
}

async function main() {
  await verifyImageSeed();
  console.log("Image seed verification passed.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(() => {
    console.error("Image seed verification failed.");
    process.exitCode = 1;
  });
}
