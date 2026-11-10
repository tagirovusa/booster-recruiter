// Writes the English catalog of service messages (src/i18n/en/backend.js) as
// JSON for the parts that cannot import the window's code: the Python
// service (English exports) and the desktop shell (tray messages).
//   node scripts/export_i18n_catalog.mjs          write both copies
//   node scripts/export_i18n_catalog.mjs --check  fail if a copy is stale
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { strings, templates } = await import(
  pathToFileURL(path.join(root, "src/i18n/en/backend.js")).href
);
const sorted = (o) =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const json =
  JSON.stringify(
    { strings: sorted(strings), templates: sorted(templates) },
    null,
    1,
  ) + "\n";
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
