import { existsSync } from "node:fs";
import path from "node:path";

export function resolveMedusaProject({ cwd, workspaceRoot }) {
  const root = path.resolve(workspaceRoot);
  const current = path.resolve(cwd);
  const example = path.join(root, "examples", "medusa");
  const projectDirectory = current === root ? example : current;
  const hasConfig = ["ts", "js"].some((ext) => existsSync(path.join(projectDirectory, `medusa-config.${ext}`)));
  if (!hasConfig || !existsSync(path.join(projectDirectory, "src/scripts/revoke-employee.ts"))) {
    throw new Error("Expected the Medusa project containing the employee revocation script.");
  }

  // Only the workspace example can use dependencies hoisted to this repository.
  const installRoots = projectDirectory === example ? [example, root] : [projectDirectory];
  const cliPath = installRoots.map((dir) => path.join(dir, "node_modules/@medusajs/cli/cli.js")).find(existsSync);
  if (!cliPath) throw new Error("Medusa CLI is missing from the selected project's installation.");
  return { projectDirectory, cliPath };
}
