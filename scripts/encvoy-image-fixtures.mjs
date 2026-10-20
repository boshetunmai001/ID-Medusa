import { createHash } from "node:crypto";
import { chmod, readFile, writeFile, rename } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { fixturePassword } from "./lib/fixture-password.mjs";

process.umask(0o077);

const root = fileURLToPath(new URL("../", import.meta.url));
const local = path.join(root, ".local");
const fixturePath = path.join(local, "encvoy-image-fixtures.env");
const layout = path.join(local, "encvoy-image-oci-backend.tar");
const backendManifest = "sha256:ebb2bc0732550692f6126bf4a46871c2f054fe72d54a885d4f9e5eaa56b06069";
const seedLayer = "sha256:43b38d570a3c180ab2d45b57b6faaa86d7c65a54f43d6d4284e0afde5a2fe840";
const seedSourceHash = "f6150dad15e7a036000d5ef62eb8dd32c13abb97bbb250f13a32ce34ac2c1327";

function requireCheck(condition) {
  if (!condition) throw new Error();
}

async function main() {
  const index = JSON.parse(await readFile(path.join(layout, "index.json"), "utf8"));
  const descriptor = index.manifests.find((entry) => entry.digest === backendManifest);
  requireCheck(descriptor);
  const manifest = JSON.parse(await readFile(path.join(layout, "blobs/sha256", backendManifest.slice(7)), "utf8"));
  requireCheck(manifest.layers.some((layer) => layer.digest === seedLayer));
  const sourceLayerPath = path.join(layout, "blobs/sha256", seedLayer.slice(7));
  const extracted = spawnSync("tar", ["-xOzf", sourceLayerPath, "app/dist/modules/prisma/prisma.service.js"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  requireCheck(!extracted.error && extracted.status === 0 && extracted.stdout);
  const source = extracted.stdout;
  requireCheck(createHash("sha256").update(source).digest("hex") === seedSourceHash);
  const passwordMatches = [...source.matchAll(/bcrypt\.hash\s*\(\s*(["\x27])([^\\\r\n]+?)\1\s*,\s*10\s*\)/g)];
  requireCheck(passwordMatches.length === 1);

  const fixtures = parseEnv(await readFile(fixturePath, "utf8"));
  fixtures.ENCVOY_IMAGE_INITIAL_EDITOR_LOGIN = "admin";
  fixtures.ENCVOY_IMAGE_INITIAL_EDITOR_PASSWORD = passwordMatches[0][2];
  fixtures.ENCVOY_IMAGE_EDITOR_PASSWORD ||= fixturePassword();
  const temporary = `${fixturePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${Object.entries(fixtures).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, fixturePath);
  console.log("Prepared private Editor fixtures from the pinned Encvoy backend image; credential values are suppressed.");
}

main().catch(() => {
  console.error("Could not prepare the private Encvoy Editor fixtures from the pinned image.");
  process.exitCode = 1;
});
