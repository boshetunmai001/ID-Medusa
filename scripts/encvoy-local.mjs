import { existsSync } from "node:fs";
import { mkdir, readFile, chmod, access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.umask(0o077);

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "research/encvoy-id");
const localDirectory = path.join(root, ".local");
const runtimeDirectory = path.join(localDirectory, "encvoy-runtime/oidc");
const envPath = process.env.ENCVOY_ENV_FILE || path.join(localDirectory, "encvoy.env");
const nodePath = path.join(root, ".local/runtime/node_modules/node/bin/node");
const buildStampPath = path.join(localDirectory, "encvoy-build-stamp.json");
const expectedSourceCommit = "5579bf5c05464da48585be28a3863c915b9b704f";
const children = [];
let stopping = false;
let exitCode = 0;

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

function assertPinnedRuntime() {
  if (!existsSync(nodePath)) throw new Error("Pinned Node 22 runtime is missing from .local/runtime");
  if (path.resolve(process.execPath) !== path.resolve(nodePath)) {
    throw new Error("Run this script with .local/runtime/node_modules/node/bin/node");
  }
}

async function assertSuccessfulBuild() {
  let stamp;
  try {
    stamp = JSON.parse(await readFile(buildStampPath, "utf8"));
  } catch {
    throw new Error("A successful Encvoy build stamp is missing; run scripts/encvoy-build.mjs to completion first");
  }
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
  }).trim();
  if (
    stamp.successful !== true ||
    stamp.commit !== expectedSourceCommit ||
    stamp.commit !== currentCommit ||
    stamp.oidcProvider !== "8.8.1"
  ) {
    throw new Error("The Encvoy build stamp does not match the pinned source and OIDC runtime");
  }
}

async function assertPortFree(port) {
  const occupied = await new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.setTimeout(250);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
  if (occupied) throw new Error(`Local Encvoy port ${port} is already in use`);
}

function startService(name, args, cwd, env) {
  const child = spawn(nodePath, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.resume();
  child.stderr?.resume();
  children.push({ name, child });
  child.on("error", (error) => {
    if (!stopping) {
      console.error(`Could not start Encvoy ${name}: ${error.code || "process error"}`);
      void shutdown(1);
    }
  });
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`Encvoy ${name} exited unexpectedly (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
      void shutdown(1);
    }
  });
  return child;
}

async function waitFor(url, serviceName, child, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Encvoy ${serviceName} exited before becoming ready`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // Keep waiting while the local service initializes.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Encvoy ${serviceName} readiness`);
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  const exited = Promise.all(
    children.map(
      ({ child }) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          child.once("exit", resolve);
        }),
    ),
  );
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10000))]);
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  process.exit(exitCode);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(0));
}

async function main() {
  assertPinnedRuntime();
  await assertSuccessfulBuild();
  await access(envPath);
  const envValues = parseEnv(await readFile(envPath, "utf8"));
  const missing = ["DATABASE_URL", "DOMAIN", "ADMIN_LOGIN", "ADMIN_PASSWORD", "CLIENT_ID"].filter(
    (key) => !envValues.get(key),
  );
  if (missing.length) throw new Error(`Missing local Encvoy settings: ${missing.join(", ")}`);

  const runtimeEnv = Object.fromEntries(envValues);
  const env = {
    ...process.env,
    ...runtimeEnv,
    PATH: `${path.dirname(nodePath)}:${process.env.PATH || ""}`,
    NODE_OPTIONS: `--require=${path.join(root, "scripts/encvoy-loopback.cjs")}`,
  };

  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  await chmod(runtimeDirectory, 0o700);
  for (const port of [3003, 3005, 3007, Number(env.ENCVOY_PORT || 9090)]) {
    await assertPortFree(port);
  }

  const backend = startService(
    "backend",
    [path.join(source, "packages/backend/dist/main.js")],
    path.join(source, "packages/backend"),
    env,
  );
  console.log("Starting Encvoy backend on loopback :3005…");
  await waitFor("http://127.0.0.1:3005/health", "backend", backend);

  const oidc = startService(
    "oidc",
    [path.join(source, "packages/oidc/dist/main.js")],
    runtimeDirectory,
    env,
  );
  const auth = startService(
    "auth",
    [path.join(source, "packages/auth/dist/main.js")],
    path.join(source, "packages/auth"),
    env,
  );
  console.log("Starting Encvoy OIDC and auth services on loopback :3003 and :3007…");
  await Promise.all([
    waitFor("http://127.0.0.1:3007/health", "auth", auth),
    waitFor("http://127.0.0.1:3003/.well-known/openid-configuration", "OIDC", oidc, 120000),
  ]);

  const proxy = startService(
    "proxy",
    [path.join(root, "scripts/encvoy-proxy.mjs")],
    root,
    env,
  );
  await waitFor(`http://127.0.0.1:${env.ENCVOY_PORT || 9090}/healthz`, "local proxy", proxy);
  await waitFor(`http://localhost:${env.ENCVOY_PORT || 9090}/`, "dashboard proxy", proxy);
  console.log("Local Encvoy is ready at the configured localhost origin.");
  console.log("Local dashboard is served at the issuer root; static auth widget is served by Encvoy.");
  console.log("Raw service stdout and stderr are discarded; only runner lifecycle and readiness statuses are shown.");
  console.log("Press Ctrl-C to stop the local Encvoy services.");
}

main().catch(async () => {
  console.error("Local Encvoy startup failed before readiness.");
  await shutdown(1);
});
