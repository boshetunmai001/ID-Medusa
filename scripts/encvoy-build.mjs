import { copyFile, mkdir, readFile, access, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "research/encvoy-id");
const locksDirectory = path.join(root, "infra/encvoy-locks");
const envPath = path.join(root, ".local/encvoy.env");
const nodePath = path.join(root, ".local/runtime/node_modules/node/bin/node");
const buildStampPath = path.join(root, ".local/encvoy-build-stamp.json");
const expectedSourceCommit = "5579bf5c05464da48585be28a3863c915b9b704f";

function parseEnv(sourceText) {
  const values = new Map();
  for (const line of sourceText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[2].startsWith("#")) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function run(command, args, cwd, env, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    let output = "";
    if (capture) child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${path.basename(command)} ${args.join(" ")} failed (code ${code ?? "none"}, signal ${signal ?? "none"})`));
    });
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function install(packageName, packageDirectory, env, oidc = false) {
  const packagePath = path.join(source, packageDirectory);
  const sourceLock = path.join(packagePath, "package-lock.json");
  const savedLock = path.join(locksDirectory, `${packageName}.package-lock.json`);

  if (await exists(savedLock)) {
    await copyFile(savedLock, sourceLock);
    await run("npm", ["ci", "--legacy-peer-deps", "--no-audit", "--no-fund"], packagePath, env);
  } else {
    const installArgs = ["install", "--legacy-peer-deps", "--no-audit", "--no-fund"];
    if (oidc) installArgs.push("--no-save", "oidc-provider@8.8.1");
    await run("npm", installArgs, packagePath, env);
    if (!(await exists(sourceLock))) {
      throw new Error(`npm did not generate a lockfile for ${packageName}`);
    }
    await mkdir(locksDirectory, { recursive: true, mode: 0o755 });
    await copyFile(sourceLock, savedLock);
    if (oidc) {
      const installed = await run(
        "npm",
        ["ls", "oidc-provider", "--depth=0", "--json"],
        packagePath,
        env,
        { capture: true },
      );
      let tree;
      try {
        tree = JSON.parse(installed);
      } catch {
        throw new Error("Could not verify the installed oidc-provider version");
      }
      const version = tree.dependencies?.["oidc-provider"]?.version;
      if (version !== "8.8.1") {
        throw new Error(`Expected oidc-provider 8.8.1, found ${version || "unknown"}`);
      }
    }
  }

  if (oidc) {
    const installed = await run(
      "npm",
      ["ls", "oidc-provider", "--depth=0", "--json"],
      packagePath,
      env,
      { capture: true },
    );
    let tree;
    try {
      tree = JSON.parse(installed);
    } catch {
      throw new Error("Could not verify the installed oidc-provider version");
    }
    const version = tree.dependencies?.["oidc-provider"]?.version;
    if (version !== "8.8.1") {
      throw new Error(`Expected locked oidc-provider 8.8.1, found ${version || "unknown"}`);
    }
  }
}

async function script(packageDirectory, name, args, env) {
  const packagePath = path.join(source, packageDirectory);
  await run("npm", ["run", name, ...(args || [])], packagePath, env);
}

async function binary(packageDirectory, name, args, env) {
  const packagePath = path.join(source, packageDirectory);
  await run(path.join(packagePath, "node_modules/.bin", name), args, packagePath, env);
}

async function main() {
  try {
    await unlink(buildStampPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (path.resolve(process.execPath) !== path.resolve(nodePath)) {
    throw new Error("Run this script with .local/runtime/node_modules/node/bin/node");
  }
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
  }).trim();
  if (sourceCommit !== expectedSourceCommit) {
    throw new Error(`Expected Encvoy source ${expectedSourceCommit}, found ${sourceCommit}`);
  }
  const config = parseEnv(await readFile(envPath, "utf8"));
  const required = ["DATABASE_URL", "DOMAIN", "CLIENT_ID", "ADMIN_LOGIN", "ADMIN_PASSWORD"];
  const missing = required.filter((key) => !config.get(key));
  if (missing.length) throw new Error(`Missing local Encvoy settings: ${missing.join(", ")}`);
  const env = {
    ...process.env,
    ...Object.fromEntries(config),
    PATH: `${path.dirname(nodePath)}:${process.env.PATH || ""}`,
  };

  console.log("Installing and locking Encvoy dependencies in the isolated pinned checkout…");
  await install("components", "packages/components", env);
  await script("packages/components", "build", [], env);
  await install("dashboard", "packages/dashboard", env);
  await install("backend", "packages/backend", env);
  await install("oidc", "packages/oidc", env, true);
  await install("auth", "packages/auth", env);
  await install("widget-auth", "packages/widget-auth", env);

  console.log("Generating Prisma clients and applying the Encvoy database migrations…");
  await binary("packages/backend", "prisma", ["generate", "--schema", "prisma/schema.prisma"], env);
  await binary("packages/oidc", "prisma", ["generate", "--schema", "prisma/schema.prisma"], env);
  await binary("packages/backend", "prisma", ["migrate", "deploy", "--schema", "prisma/schema.prisma"], env);

  console.log("Building Encvoy backend, OIDC, auth, widget, and dashboard…");
  await script("packages/backend", "build", [], env);
  await script("packages/oidc", "build", [], env);
  await script("packages/auth", "build", [], env);
  await script("packages/widget-auth", "build", [], env);
  await script("packages/dashboard", "build", ["--", "--base=/"], env);

  const oidcLock = JSON.parse(await readFile(path.join(locksDirectory, "oidc.package-lock.json"), "utf8"));
  const pinned = oidcLock.packages?.["node_modules/oidc-provider"]?.version;
  if (pinned !== "8.8.1") throw new Error(`Saved OIDC lockfile resolved oidc-provider ${pinned || "unknown"}, expected 8.8.1`);
  const completedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
  }).trim();
  if (completedCommit !== sourceCommit) {
    throw new Error("Encvoy source changed during the build; refusing to record a build stamp");
  }
  await writeFile(
    buildStampPath,
    `${JSON.stringify(
      {
        successful: true,
        commit: sourceCommit,
        oidcProvider: pinned,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  console.log("Encvoy build complete. Resolved dependency lockfiles are in infra/encvoy-locks/.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Encvoy build failed");
  process.exitCode = 1;
});
