// Writes the window's English catalog (src/i18n/en/*.js, merged in the same
// order as src/i18n/en/index.js) as JSON for the parts that cannot import the
// window's code: the Python
// service (English exports) and the desktop shell (tray messages).
//   node scripts/export_i18n_catalog.mjs          write both copies
//   node scripts/export_i18n_catalog.mjs --check  fail if a copy is stale
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Same parts and order as src/i18n/en/index.js; later parts win.
const parts = [];
for (const name of ["shell", "campaign", "outreach", "backend"])
  parts.push(
    await import(
      pathToFileURL(path.join(root, "src/i18n/en", name + ".js")).href
    ),
  );
const strings = Object.assign({}, ...parts.map((p) => p.strings));
const templates = Object.assign({}, ...parts.map((p) => p.templates));
const sorted = (o) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
// Template order decides between equally specific templates, so it is kept.
const json =
  JSON.stringify({ strings: sorted(strings), templates }, null, 1) + "\n";
const targets = [
  "backend/booster_recruiter/i18n_en.json",
  "desktop/i18n_en.json",
];
let stale = [];
for (const target of targets) {
  const file = path.join(root, target);
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (current !== json) stale.push(target);
  } else fs.writeFileSync(file, json);
}
if (stale.length) {
  console.error(
    `Stale English catalog copies: ${stale.join(", ")}. Run node scripts/export_i18n_catalog.mjs`,
  );
  process.exit(1);
}
