import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.umask(0o077);

const root = fileURLToPath(new URL("../", import.meta.url));
const local = path.join(root, ".local");
const cranePath = path.join(local, "bin/crane");
const craneArchivePath = path.join(local, "crane-0.22.1.tar.gz");
const craneArchiveSha256 = "2231fc8df8806d20d680ff1225db44e095a55dd6ac1ae8eced4faf4b278b78fb";
const services = [
  {
    service: "id-db",
    archiveName: "postgres",
    reference: "postgres:14.4@sha256:9ceb24f8c5f15c053d973a3610866f473690875dc13eb3282b45302189321040",
    manifest: "sha256:cf3b0cf1dde2a82542e4b9de7f3ad058fdc819dea6499007035b838542b0bd5e",
    config: "sha256:e09e90144645e02137d087f0dc059f4d2e3c6356ef8f9e40eeb15d1c901dbc73",
  },
  {
    service: "id-redis",
    archiveName: "redis",
    reference: "redis:7-alpine@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499",
    manifest: "sha256:ca0acbb137c1dc3339c8b147a58fd6f42775d4599327b50e7b116c23de501af2",
    config: "sha256:f84b0c4678011602b9b98c227a4dcd5468bf8b088b02fdd4165cb7758bad8058",
  },
  {
    service: "id-back",
    archiveName: "backend",
    reference: "registry.digtlab.ru/trusted/id@sha256:ebb2bc0732550692f6126bf4a46871c2f054fe72d54a885d4f9e5eaa56b06069",
    manifest: "sha256:ebb2bc0732550692f6126bf4a46871c2f054fe72d54a885d4f9e5eaa56b06069",
    config: "sha256:54314f79ece087309f1b2da18cb93e5e315a432240d298c9bd659da39cf6de9c",
  },
  {
    service: "id-oidc",
    archiveName: "oidc",
    reference: "registry.digtlab.ru/trusted/id@sha256:ce8fcf7751ac5d4f6fca780921454062b9b13ca3ecdb91134183eb0fecdf9138",
    manifest: "sha256:ce8fcf7751ac5d4f6fca780921454062b9b13ca3ecdb91134183eb0fecdf9138",
    config: "sha256:c7a411354c9f3876bd74fe254523b692422388c7c8b6c0196747b6522b134277",
  },
  {
    service: "id-auth",
    archiveName: "auth",
    reference: "registry.digtlab.ru/trusted/id@sha256:11b365e5235b5feb6f5167eb7872283d6e4a4fb660294bd9ea3add84ba2e47a9",
    manifest: "sha256:11b365e5235b5feb6f5167eb7872283d6e4a4fb660294bd9ea3add84ba2e47a9",
    config: "sha256:4fb8c462b0dc81ebfccaba0a8edeec691f0eddfe659239a29a3840baaee6a700",
  },
  {
    service: "id-front",
    archiveName: "front",
    reference: "registry.digtlab.ru/trusted/id@sha256:0a7561599cca99402f4291844a14a3ab79201677c734f142cd04b2fef55d0120",
    manifest: "sha256:0a7561599cca99402f4291844a14a3ab79201677c734f142cd04b2fef55d0120",
    config: "sha256:fc28c5900e3a013bca34d2363ee06e785a0a49db8caba85998705dffb1a83b7f",
  },
];
let stage = "verify local crane installation";

function requireCheck(condition) {
  if (!condition) throw new Error();
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "ignore"] : "ignore",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error();
  return result.stdout || "";
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

async function ensureLayout(service, layoutPath) {
  try {
    const metadata = await stat(layoutPath);
    requireCheck(metadata.isDirectory());
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  run(cranePath, ["pull", "--platform", "linux/amd64", "--format", "oci", service.reference, layoutPath]);
}

async function verifyLayout(service, layoutPath) {
  const index = JSON.parse(await readFile(path.join(layoutPath, "index.json"), "utf8"));
  const descriptor = index.manifests.find((entry) => entry.digest === service.manifest);
  requireCheck(descriptor);
  requireCheck(!descriptor.platform || (descriptor.platform.os === "linux" && descriptor.platform.architecture === "amd64"));
  const manifestPath = path.join(layoutPath, "blobs/sha256", service.manifest.slice(7));
  requireCheck(await hashFile(manifestPath) === service.manifest);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  requireCheck(manifest.config.digest === service.config);
  const configPath = path.join(layoutPath, "blobs/sha256", service.config.slice(7));
  requireCheck(await hashFile(configPath) === service.config);
  const imageConfig = JSON.parse(await readFile(configPath, "utf8"));
  requireCheck(imageConfig.os === "linux" && imageConfig.architecture === "amd64");
  requireCheck(Array.isArray(imageConfig.rootfs?.diff_ids) && imageConfig.rootfs.diff_ids.length === manifest.layers.length);

  for (const layer of manifest.layers) {
    const digest = layer.digest;
    const layerPath = path.join(layoutPath, "blobs/sha256", digest.slice(7));
    requireCheck(await hashFile(layerPath) === digest);
  }
  return { manifest, imageConfig };
}

function inspectImported(digest) {
  const formatted = run("docker", [
    "image", "inspect", digest, "--format",
    "{{.Id}}|{{.Os}}|{{.Architecture}}|{{json .RootFS.Layers}}",
  ], true).trim();
  const [imageId, os, architecture, layers] = formatted.split("|");
  return { imageId, os, architecture, diffIds: JSON.parse(layers) };
}

async function importIfMissing(service, layoutPath, archivePath) {
  try {
    return inspectImported(service.manifest);
  } catch {
    run("tar", ["-C", layoutPath, "-cf", archivePath, "."]);
    await chmod(archivePath, 0o600);
    run("docker", ["image", "load", "--quiet", "--input", archivePath]);
    return inspectImported(service.manifest);
  }
}

async function main() {
  await mkdir(local, { recursive: true, mode: 0o700 });
  stage = "verify official crane release archive";
  requireCheck(await hashFile(craneArchivePath) === `sha256:${craneArchiveSha256}`);
  const extractedCrane = spawnSync("tar", ["-xOzf", craneArchivePath, "crane"], {
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 32 * 1024 * 1024,
  });
  requireCheck(!extractedCrane.error && extractedCrane.status === 0 && extractedCrane.stdout);
  requireCheck(createHash("sha256").update(extractedCrane.stdout).digest("hex") === (await hashFile(cranePath)).slice(7));
  const craneVersion = run(cranePath, ["version"], true);
  requireCheck(/\b0\.22\.1\b/.test(craneVersion));

  const compose = await readFile(path.join(root, "infra/encvoy-image.compose.yaml"), "utf8");
  const imported = [];
  for (const service of services) {
    stage = `verify OCI data for ${service.service}`;
    requireCheck(compose.includes(service.reference));
    const layoutPath = path.join(local, `encvoy-image-oci-${service.archiveName}${service.archiveName === "backend" ? ".tar" : ""}`);
    const archivePath = path.join(local, `encvoy-image-${service.archiveName}.oci.tar`);
    await ensureLayout(service, layoutPath);
    const { manifest, imageConfig } = await verifyLayout(service, layoutPath);
    stage = `verify local Docker image for ${service.service}`;
    const dockerImage = await importIfMissing(service, layoutPath, archivePath);
    const importedDiffIdsMatch = JSON.stringify(dockerImage.diffIds) === JSON.stringify(imageConfig.rootfs.diff_ids);
    requireCheck(dockerImage.os === "linux" && dockerImage.architecture === "amd64" && importedDiffIdsMatch);
    imported.push({
      service: service.service,
      sourceReference: service.reference,
      platformManifestDigest: service.manifest,
      configDigest: service.config,
      dockerImageId: dockerImage.imageId,
      platform: `${dockerImage.os}/${dockerImage.architecture}`,
      layerCount: manifest.layers.length,
      importedDiffIdsMatch,
    });
  }

  const override = ["services:", ...imported.flatMap(({ service, dockerImageId }) => [
    `  ${service}:`,
    `    image: ${dockerImageId}`,
    "    pull_policy: never",
  ]), ""].join("\n");
  await Promise.all([
    writeFile(path.join(local, "encvoy-image-local.override.yaml"), override, { mode: 0o600 }),
    writeFile(path.join(local, "encvoy-image-import-verification.json"), `${JSON.stringify({ verifiedAt: new Date().toISOString(), images: imported }, null, 2)}\n`, { mode: 0o600 }),
  ]);
  await Promise.all([
    chmod(path.join(local, "encvoy-image-local.override.yaml"), 0o600),
    chmod(path.join(local, "encvoy-image-import-verification.json"), 0o600),
  ]);
  for (const image of imported) {
    console.log(`Verified ${image.service}: ${image.platform}, ${image.layerCount} layers, imported rootfs matches.`);
  }
  console.log("Wrote the private Compose image-ID override; use node scripts/encvoy-image.mjs validate before starting services.");
}

main().catch(() => {
  console.error(`Image import or digest verification failed during ${stage}; command output was suppressed.`);
  process.exitCode = 1;
});
