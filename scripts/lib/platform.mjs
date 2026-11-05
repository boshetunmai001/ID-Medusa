import { chmod } from "node:fs/promises";
import path from "node:path";

export const isWindows = process.platform === "win32";

export function pinnedNodePath(root) {
  const binDirectory = path.join(root, ".local", "runtime", "node_modules", "node", "bin");
  return path.join(binDirectory, isWindows ? "node.exe" : "node");
}

export function withPathDirectories(env, directories) {
  const prefix = directories.filter(Boolean).join(path.delimiter);
  return {
    ...env,
    PATH: `${prefix}${prefix ? path.delimiter : ""}${env.PATH || ""}`,
  };
}

export function setPrivateUmask() {
  if (!isWindows) process.umask(0o077);
}

export async function restrictFileMode(filePath, mode) {
  // Windows uses inherited NTFS ACLs; POSIX mode bits are not an access-control boundary there.
  if (!isWindows) await chmod(filePath, mode);
}
