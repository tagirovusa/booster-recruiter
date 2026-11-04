const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const {
  patchElectronStartup,
  ORIGINAL,
  FIXED,
  VERSION,
} = require("./patchright_test_driver.cjs");
const installed = fs.readFileSync(
  path.join(
    path.dirname(require.resolve("patchright-core/package.json")),
    "lib",
    "coreBundle.js",
  ),
  "utf8",
);
const original = installed.replace(FIXED, ORIGINAL);

test("Electron compatibility change preserves every other byte of the pinned driver", () => {
  const result = patchElectronStartup(original, VERSION);
  assert.equal(result, original.replace(ORIGINAL, FIXED));
  assert.equal(result.replace(FIXED, ORIGINAL), original);
});

test("Electron compatibility preparation is idempotent", () => {
  const result = patchElectronStartup(original, VERSION);
  assert.equal(patchElectronStartup(result, VERSION), result);
});

test("a driver version change requires an explicit adapter review", () => {
  assert.throws(
    () => patchElectronStartup(original, "1.65.0"),
    /Review the Electron test adapter/,
  );
});

test("unexpected original or modified driver contents fail closed", () => {
  assert.throws(
    () => patchElectronStartup(`${original}\n`, VERSION),
    /Unrecognized Patchright driver/,
  );
  assert.throws(
    () => patchElectronStartup(`${original}\n${ORIGINAL}`, VERSION),
    /Unrecognized Patchright driver/,
  );
  assert.throws(
    () =>
      patchElectronStartup(
        `${patchElectronStartup(original, VERSION)}\n`,
        VERSION,
      ),
    /Unrecognized Patchright driver/,
  );
});

test("the installed test stack has no stock browser automation packages", () => {
  for (const dependency of [
    "playwright",
    "playwright-core",
    "@playwright/test",
  ])
    assert.throws(() => require.resolve(dependency), {
      code: "MODULE_NOT_FOUND",
    });
});
