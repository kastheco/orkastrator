import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const consumer = realpathSync(process.argv[2]);
const rootRequire = createRequire(join(consumer, "package.json"));
const orkManifest = rootRequire.resolve("orkastrator-pi/package.json");
const orkRequire = createRequire(orkManifest);
const host = realpathSync(resolve(dirname(orkRequire.resolve("@osolmaz/pi-workflows")), "../.."));
assert.ok(host.startsWith(consumer + "/"), "Host escaped the clean consumer");
const hostRequire = createRequire(join(host, "package.json"));
const rpivPatch = join(dirname(orkManifest), "patches/@juicesharp+rpiv-ask-user-question+2.9.0.patch");
assert.equal(createHash("sha256").update(readFileSync(rpivPatch)).digest("hex"), "a2a800c428bf149cda45e0740e7c225d8fdba6ffed393f537da16268d3386917");
assert.match(readFileSync(join(dirname(orkRequire.resolve("@juicesharp/rpiv-ask-user-question")), "ask-user-question.ts"), "utf8"), /export async function presentQuestionnaire/);
const archive = join(dirname(orkManifest), "vendor/osolmaz-pi-workflows-0.16.0-kas.769.3.tgz");
assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), "1517d6fb98342627cc2bc0a64f56bbe6f78c9fee1b693eb4dec4d2ee281668a4");
const temp = mkdtempSync(join(tmpdir(), "orkastrator-host-identity-"));
try {
  execFileSync("tar", ["-xzf", archive, "-C", temp]);
  for (const directory of ["src", "dist"]) execFileSync("diff", ["-qr", join(temp, "package", directory), join(host, directory)]);
  assert.equal(JSON.parse(readFileSync(join(host, "package.json"))).version, "0.16.0-kas.769.3");
  const Database = hostRequire("better-sqlite3");
  const db = new Database(":memory:");
  assert.equal(db.prepare("PRAGMA integrity_check").pluck().get(), "ok");
  db.close();
  const { WorkflowClient } = await import(pathToFileURL(orkRequire.resolve("@osolmaz/pi-workflows/client")));
  const { registerWorkflowHumanDecisionPresenter } = await import(pathToFileURL(orkRequire.resolve("@osolmaz/pi-workflows/extension")));
  assert.equal(typeof WorkflowClient, "function");
  assert.equal(typeof registerWorkflowHumanDecisionPresenter, "function");
  console.log(JSON.stringify({ node: process.version, host, exactArchiveSourceDist: true, nativeSqlite: "passed" }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
