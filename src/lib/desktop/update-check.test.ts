import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { APP_VERSION } from "./version.ts";
import {
  compareSemver,
  dataDirSurvivesInstall,
  decideRelease,
  readLatestYmlVersion,
} from "./update-check.ts";

test("semver order ignores a leading v and treats a higher release as newer", () => {
  assert.equal(compareSemver("0.1.0", "0.1.0"), 0);
  assert.equal(compareSemver("v0.1.0", "0.2.0"), -1);
  assert.equal(compareSemver("0.2.0", "0.1.9"), 1);
  assert.equal(compareSemver("1.0.0", "0.9.9"), 1);
});

test("a latest.yml feed says an update is available, and a matching feed does not", () => {
  const yml = ["version: 0.2.0", "files:", "  - url: RippleRadar-Setup-0.2.0.exe", "path: RippleRadar-Setup-0.2.0.exe", "sha512: abc", "releaseDate: '2026-10-03T00:00:00.000Z'", ""].join("\n");
  const latest = readLatestYmlVersion(yml);
  assert.equal(latest, "0.2.0");
  const available = decideRelease("0.1.0", latest);
  assert.equal(available.state, "available");
  assert.match(available.message, /0\.2\.0/);
  const same = decideRelease("0.2.0", latest);
  assert.equal(same.state, "current");
  const none = decideRelease("0.1.0", null);
  assert.equal(none.state, "none");
  const broken = decideRelease("0.1.0", null, "GitHub answered 503");
  assert.equal(broken.state, "error");
  assert.match(broken.message, /503/);
});

test("an update does not land inside the data directory", () => {
  const data = "C:\\Users\\JOSHD\\AppData\\Roaming\\Ripple Radar";
  const install = "C:\\Users\\JOSHD\\AppData\\Local\\Programs\\Ripple Radar";
  assert.equal(dataDirSurvivesInstall(data, install), true);
  assert.equal(dataDirSurvivesInstall(`${install}\\resources\\pglite`, install), false);
  assert.equal(dataDirSurvivesInstall(install, install), false);
  assert.equal(dataDirSurvivesInstall("", install), false);
});

test("the packaged version matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(APP_VERSION, pkg.version);
});
