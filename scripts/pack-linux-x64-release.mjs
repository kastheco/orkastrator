import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local Linux release only: nested file tarballs are not resolved by npm pack consumers.
assert.equal(process.platform, "linux", "This release bundles Linux esbuild");
assert.equal(process.arch, "x64", "This release bundles x64 esbuild");
assert.ok(process.argv[2], "Usage: npm run pack:linux-x64-release -- OUTPUT_DIRECTORY");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const archive = "vendor/osolmaz-pi-workflows-0.16.0-kas.769.3.tgz";
const sha256 = "1517d6fb98342627cc2bc0a64f56bbe6f78c9fee1b693eb4dec4d2ee281668a4";
assert.equal(manifest.dependencies["@osolmaz/pi-workflows"], `file:${archive}`);
assert.equal(createHash("sha256").update(readFileSync(join(root, archive))).digest("hex"), sha256);
const stage = mkdtempSync(join(tmpdir(), "orkastrator-linux-release-"));
const run = (args) => execFileSync("npm", args, { cwd: stage, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
try {
  for (const file of ["package.json", "package-lock.json", ...manifest.files]) {
    cpSync(join(root, file), join(stage, file), { recursive: true });
  }
  // A fresh install, never copied or symlinked live dependencies. Preserve the source lock.
  process.stderr.write(run(["ci", "--omit=dev", "--no-audit", "--no-fund"]));
  // npm's consumer extraction drops tar hardlinks. Materialize only esbuild's
  // internal executable alias in this disposable stage, without changing bytes.
  const executable = join(stage, "node_modules/esbuild/bin/esbuild");
  const original = readFileSync(executable);
  const mode = statSync(executable).mode;
  writeFileSync(executable + ".regular", original, { mode });
  renameSync(executable + ".regular", executable);
  assert.deepEqual(readFileSync(executable), original);
  assert.equal(statSync(executable).mode, mode);
  assert.equal(statSync(executable).nlink, 1);
  manifest.bundledDependencies = ["@osolmaz/pi-workflows"];
  writeFileSync(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  const [receipt] = JSON.parse(run(["pack", "--ignore-scripts", "--json"]));
  const expected = ["@osolmaz/pi-workflows", "better-sqlite3", "node-addon-api", "jiti", "tsx", "esbuild", "@esbuild/linux-x64"];
  assert.deepEqual(receipt.bundled.sort(), expected.sort(), "Unexpected bundled dependency");
  for (const { path } of receipt.files) {
    assert.ok(!/(^|\/)(\.env(?:\.|$)|\.git|\.npmrc|\.pi\/(?!workflows\/))|\.(sqlite|db)(-|$)/.test(path), `Unexpected runtime/credential path: ${path}`);
    assert.ok(path === "package.json" || path === "README.md" || path === "LICENSE" || manifest.files.some(file => path === file || path.startsWith(file + "/")) || expected.some(name => path.startsWith(`node_modules/${name}/`)), `Unexpected packed path: ${path}`);
  }
  const entries = execFileSync("tar", ["-tvzf", join(stage, receipt.filename)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.ok(entries.split("\n").every(line => !line || line[0] === "-" || line[0] === "d"), "Packed links are prohibited");
  mkdirSync(output, { recursive: true });
  cpSync(join(stage, receipt.filename), join(output, receipt.filename));
  writeFileSync(join(output, "linux-x64-release-receipt.json"), JSON.stringify({ platform: "linux-x64", hostSha256: sha256, ...receipt }, null, 2) + "\n");
  console.log(JSON.stringify([receipt]));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
