const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const VERSION = "1.64.3";
const ORIGINAL =
  "if (this._isMainFrame() && !this._crPage._opener) await Promise.all(promises2);";
const FIXED =
  'if (this._isMainFrame() && !this._crPage._opener && browserOptions.name !== "electron") await Promise.all(promises2);';
const ORIGINAL_SHA256 =
  "84aacb258ce8bb655f06f066c8e091dad29e2aa5eb68586e2fd747fcabd8f3cc";
const FIXED_SHA256 =
  "92df97f6f042fa79814539460cc10908920b1fa60336f06acbe827172fdef29f";
const hash = (source) => createHash("sha256").update(source).digest("hex");

function patchElectronStartup(source, version) {
  if (version !== VERSION)
    throw Error(
      `Review the Electron test adapter for Patchright ${version}; expected ${VERSION}.`,
    );
  const fingerprint = hash(source);
  if (fingerprint === FIXED_SHA256) return source;
  if (fingerprint !== ORIGINAL_SHA256 || source.split(ORIGINAL).length !== 2)
    throw Error(
      "Unrecognized Patchright driver; refusing to modify the Electron test driver.",
    );
  const fixed = source.replace(ORIGINAL, FIXED);
  if (hash(fixed) !== FIXED_SHA256)
    throw Error("Unexpected Electron test adapter output.");
  return fixed;
}

function loadPatchright() {
  const manifestPath = require.resolve("patchright-core/package.json");
  const version = JSON.parse(fs.readFileSync(manifestPath, "utf8")).version;
  const bundlePath = path.join(
    path.dirname(manifestPath),
    "lib",
    "coreBundle.js",
  );
  const source = fs.readFileSync(bundlePath, "utf8");
  const fixed = patchElectronStartup(source, version);
  if (fixed !== source) {
    if (require.cache[bundlePath])
      throw Error(
        "Load the Electron test adapter before importing Patchright.",
      );
    // Electron starts its renderer paused. Resume it before awaiting setup that
    // needs that renderer; all setup promises are still awaited afterwards.
    // Only the local Node UI test driver changes. Chromium and Python do not.
    // Keep the upstream bundle and all its license notices otherwise intact.
    const temporary = `${bundlePath}.booster-${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, fixed, {
        mode: fs.statSync(bundlePath).mode,
      });
      fs.renameSync(temporary, bundlePath);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return require("patchright/test");
}

module.exports = {
  loadPatchright,
  patchElectronStartup,
  ORIGINAL,
  FIXED,
  VERSION,
};
