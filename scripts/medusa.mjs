import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pinnedNodePath, withPathDirectories } from "./lib/platform.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const localNode = pinnedNodePath(root);
const runtime = existsSync(localNode) ? localNode : process.execPath;
const child = spawn(runtime, [path.join(root, "node_modules/@medusajs/cli/cli.js"), ...process.argv.slice(2)], {
  cwd: path.join(root, "examples/medusa"),
  env: { ...withPathDirectories(process.env, [path.dirname(runtime)]), MEDUSA_DISABLE_TELEMETRY: "true", TS_NODE_TRANSPILE_ONLY: "true", LOG_LEVEL: "info" },
  stdio: "inherit",
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
