import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const composeFile = path.join(root, "infra/encvoy-image.compose.yaml");
const envFile = path.join(root, ".local/encvoy-image.env");
const localOverrideFile = path.join(root, ".local/encvoy-image-local.override.yaml");
const project = "medusa-encvoy-image";
const command = process.argv[2] || "status";

const commands = {
  validate: ["config", "-q"],
  pull: ["pull"],
  "up-core": ["up", "-d", "id-front", "id-db", "id-redis", "id-back", "id-oidc", "id-auth"],
  "up-web": ["up", "-d", "id-front", "id-db", "id-redis", "id-back", "id-oidc", "id-auth"],
  down: ["down"],
};

function baseArgs(includeLocalOverride = true) {
  const args = ["compose", "--project-name", project, "--file", composeFile, "--env-file", envFile];
  if (includeLocalOverride && existsSync(localOverrideFile)) args.push("--file", localOverrideFile);
  return args;
}

function run(args, capture = false, includeLocalOverride = true) {
  const result = spawnSync("docker", [...baseArgs(includeLocalOverride), ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "ignore"] : ["ignore", "ignore", "ignore"],
  });
  if (result.error || result.status !== 0) return { ok: false };
  return { ok: true, output: result.stdout || "" };
}

function reportStatus() {
  const result = run(["ps", "--all", "--format", "json"], true);
  if (!result.ok) {
    console.log("Could not read Encvoy image container status.");
    process.exitCode = 1;
    return;
  }

  let rows;
  try {
    const raw = result.output.trim();
    rows = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    console.log("Could not parse Encvoy image container status.");
    process.exitCode = 1;
    return;
  }

  if (!rows.length) {
    console.log("Encvoy image stand is stopped.");
    return;
  }
  for (const row of rows) {
    const name = String(row.Service || row.Name || "container").replace(/[^a-zA-Z0-9_.-]/g, "");
    const state = String(row.State || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "");
    const health = String(row.Health || "").replace(/[^a-zA-Z0-9_.-]/g, "");
    console.log(`Encvoy image ${name}: ${state}${health ? ` (${health})` : ""}`);
  }
}

if (!existsSync(envFile) && command !== "validate") {
  console.error("Private Encvoy image environment is missing; run node scripts/encvoy-image-env.mjs first.");
  process.exitCode = 1;
} else if (command === "status") {
  reportStatus();
} else if (!commands[command]) {
  console.error("Usage: node scripts/encvoy-image.mjs {validate|pull|up-core|up-web|status|down}");
  process.exitCode = 2;
} else {
  const result = run(commands[command], false, command !== "pull");
  if (!result.ok) {
    console.error(`Encvoy image ${command} failed; detailed Docker output is suppressed.`);
    process.exitCode = 1;
  } else {
    console.log(`Encvoy image ${command} completed.`);
    if (command === "up-core" || command === "up-web" || command === "down") reportStatus();
  }
}
