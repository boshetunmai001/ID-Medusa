import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveMedusaProject } from "../scripts/lib/medusa-project.mjs";

test("live acceptance resolves the workspace app and an independent consumer", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "medusa-project-resolution-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));

  const workspaceRoot = path.join(fixture, "workspace");
  const exampleProject = path.join(workspaceRoot, "examples", "medusa");
  const workspaceCli = path.join(workspaceRoot, "node_modules", "@medusajs", "cli", "cli.js");
  const consumerProject = path.join(fixture, "consumer");
  const consumerCli = path.join(consumerProject, "node_modules", "@medusajs", "cli", "cli.js");
  await Promise.all([
    mkdir(path.dirname(workspaceCli), { recursive: true }),
    mkdir(path.dirname(consumerCli), { recursive: true }),
  ]);
  await Promise.all([writeFile(workspaceCli, ""), writeFile(consumerCli, "")]);

  for (const project of [exampleProject, consumerProject]) {
    await mkdir(path.join(project, "src/scripts"), { recursive: true });
    await writeFile(path.join(project, "medusa-config.ts"), "");
    await writeFile(path.join(project, "src/scripts/revoke-employee.ts"), "");
  }

  assert.throws(() => resolveMedusaProject({ cwd: fixture, workspaceRoot }));
  assert.deepEqual(resolveMedusaProject({ cwd: workspaceRoot, workspaceRoot }), {
    projectDirectory: exampleProject,
    cliPath: workspaceCli,
  });
  assert.deepEqual(resolveMedusaProject({ cwd: exampleProject, workspaceRoot }), {
    projectDirectory: exampleProject,
    cliPath: workspaceCli,
  });
  assert.deepEqual(resolveMedusaProject({ cwd: consumerProject, workspaceRoot }), {
    projectDirectory: consumerProject,
    cliPath: consumerCli,
  });

  await rm(consumerCli);
  assert.throws(() => resolveMedusaProject({ cwd: consumerProject, workspaceRoot }), /CLI is missing/);

  const exampleCli = path.join(exampleProject, "node_modules", "@medusajs", "cli", "cli.js");
  await mkdir(path.dirname(exampleCli), { recursive: true });
  await writeFile(exampleCli, "");
  assert.equal(resolveMedusaProject({ cwd: workspaceRoot, workspaceRoot }).cliPath, exampleCli);
});
