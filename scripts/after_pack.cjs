const { execFileSync } = require("node:child_process");
const path = require("node:path");
// Ad hoc signing makes local test bundles internally consistent. It does not
// establish a publisher identity and is not Developer ID/notarization.
module.exports = async function afterPack(context) {
  if (
    context.electronPlatformName === "darwin" &&
    process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false"
  ) {
    const bundle = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
    );
    execFileSync(
      "/usr/bin/codesign",
      ["--force", "--deep", "--sign", "-", bundle],
      { stdio: "inherit" },
    );
    execFileSync(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", bundle],
      { stdio: "inherit" },
    );
  }
};
