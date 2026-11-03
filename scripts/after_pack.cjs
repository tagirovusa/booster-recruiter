const { execFileSync, spawnSync } = require("node:child_process");
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
    const clearFinderMetadata = () => {
      // Finder can add these attributes to copied frameworks. Restrict cleanup
      // to the generated bundle; strict signature verification still follows.
      for (const attribute of [
        "com.apple.ResourceFork",
        "com.apple.FinderInfo",
      ]) {
        const cleanup = spawnSync(
          "/usr/bin/xattr",
          ["-dr", attribute, bundle],
          {
            stdio: "ignore",
          },
        );
        if (cleanup.error) throw cleanup.error;
      }
    };
    clearFinderMetadata();
    execFileSync(
      "/usr/bin/codesign",
      ["--force", "--deep", "--sign", "-", bundle],
      { stdio: "inherit" },
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      clearFinderMetadata();
      const verification = spawnSync(
        "/usr/bin/codesign",
        ["--verify", "--deep", "--strict", bundle],
        { encoding: "utf8" },
      );
      if (verification.status === 0) return;
      const reason =
        verification.stderr ||
        verification.error?.message ||
        "Signature verification failed";
      if (
        !reason.includes("resource fork, Finder information") ||
        attempt === 3
      ) {
        throw new Error(reason);
      }
      // LaunchServices may finish annotating a newly copied .app while the
      // first verification runs. Retry only this metadata issue, never an
      // invalid/missing signature or changed signed resources.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
};
