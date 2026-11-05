import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const username = "medusa_test";
const database = "medusa_test";
let port;
let dataDirectory;
let serverMayBeRunning = false;
let testProcess;
let interruptedBy;

function isolatedPostgresEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (/^PG/i.test(key)) delete env[key];
  }
  return env;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    interruptedBy = signal;
    if (testProcess) testProcess.kill(signal);
  });
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: isolatedPostgresEnvironment(),
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ""} failed with exit code ${result.status}`);
  }
  return capture ? result.stdout.trim() : "";
}

function hasExecutable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

async function main() {
  const required = ["initdb", "postgres", "pg_ctl", "createdb", "pg_isready"];
  const missing = required.filter((command) => !hasExecutable(command));
  if (missing.length) {
    throw new Error(`npm test needs local PostgreSQL server tools: ${missing.join(", ")}. Install PostgreSQL and retry.`);
  }

  port = await unusedLoopbackPort();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), `encvoy-pg-${process.pid}-`));
  dataDirectory = path.join(temporaryDirectory, "data");
  await mkdir(dataDirectory, { mode: 0o700 });
  await writeFile(path.join(temporaryDirectory, "server.log"), "", { mode: 0o600 });

  run("initdb", [
    "--pgdata", dataDirectory,
    "--username", username,
    "--auth-local=trust",
    "--auth-host=trust",
    "--no-instructions",
  ]);

  serverMayBeRunning = true;
  run("pg_ctl", [
    "--pgdata", dataDirectory,
    "--log", path.join(temporaryDirectory, "server.log"),
    "--options", `-h 127.0.0.1 -p ${port}`,
    "--wait", "start",
  ]);
  run("createdb", ["--host", "127.0.0.1", "--port", String(port), "--username", username, database]);

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (interruptedBy) throw new Error(`Test run interrupted by ${interruptedBy}.`);
    try {
      run("pg_isready", ["--host", "127.0.0.1", "--port", String(port), "--username", username, "--dbname", database], { capture: true });
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  if (!ready) throw new Error("The isolated PostgreSQL test database did not become ready.");

  const testFiles = (await readdir(path.join(root, "tests")))
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => path.join(root, "tests", file));
  const databaseUrl = new URL(`postgresql://${username}@127.0.0.1:${port}/${database}`);
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const exitCode = await new Promise((resolve, reject) => {
    testProcess = spawn(process.execPath, [tsx, "--test", ...testFiles], {
      cwd: root,
      env: isolatedPostgresEnvironment({
        DATABASE_URL: databaseUrl.href,
        RUN_POSTGRES_INTEGRATION: "1",
      }),
      stdio: "inherit",
    });
    testProcess.once("error", reject);
    testProcess.once("close", (code, signal) => {
      testProcess = undefined;
      resolve(signal ? (signal === "SIGINT" ? 130 : 143) : (code ?? 1));
    });
  });
  if (interruptedBy || exitCode !== 0) {
    process.exitCode = exitCode;
    throw new Error(interruptedBy ? `Test run interrupted by ${interruptedBy}.` : `Test suite failed with exit code ${exitCode}.`);
  }
}

async function unusedLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("Could not allocate an isolated PostgreSQL port.");
  }
  const { port: selectedPort } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return selectedPort;
}

try {
  await main();
} catch (error) {
  if (!interruptedBy) console.error(error instanceof Error ? error.message : "Test runner failed.");
  process.exitCode = interruptedBy === "SIGINT" ? 130 : interruptedBy === "SIGTERM" ? 143 : 1;
} finally {
  if (serverMayBeRunning) {
    try {
      run("pg_ctl", ["--pgdata", dataDirectory, "--mode", "immediate", "--wait", "stop"], { capture: true });
    } catch {
      console.error(`Could not stop the temporary PostgreSQL server; its data directory is preserved at ${path.dirname(dataDirectory)}.`);
      process.exitCode = 1;
      dataDirectory = undefined;
    }
  }
  if (dataDirectory) {
    try {
      await rm(path.dirname(dataDirectory), { recursive: true, force: true });
    } catch {
      console.error("Could not remove the temporary PostgreSQL test directory.");
      process.exitCode = 1;
    }
  }
}
