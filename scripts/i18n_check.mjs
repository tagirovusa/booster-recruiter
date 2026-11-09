// Offline check of the English catalog.
//  1. Every literal t("…") key used in src/ has an English entry.
//  2. Russian text left in src/ outside t()/tr() calls and catalogs is listed,
//     so untranslated interface text is visible before a release.
// Usage: node scripts/i18n_check.mjs [--strict]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "src");
const catalogDir = path.join(src, "i18n", "en");

async function loadCatalog() {
  const strings = {};
  const templates = {};
  for (const file of fs.readdirSync(catalogDir)) {
    if (!file.endsWith(".js") || file === "index.js") continue;
    const mod = await import(pathToFileURL(path.join(catalogDir, file)).href);
    Object.assign(strings, mod.strings);
    Object.assign(templates, mod.templates);
  }
  return { strings, templates };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== path.join(src, "i18n")) out.push(...walk(full));
    } else if (/\.(jsx?|mjs)$/.test(entry.name) && entry.name !== "i18n.js") {
      out.push(full);
    }
  }
  return out;
}

// Matches t("…"), t('…') and t(`…`) without ${} — the first argument only.
const CALL = /\bt\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const CYR = /[А-Яа-яЁё]/;

function unescape(raw, quote) {
  if (quote === "`") return raw.replace(/\\`/g, "`").replace(/\\\\/g, "\\");
  try {
    return JSON.parse(`"${raw.replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"')}"`);
  } catch {
    return raw;
  }
}

const { strings } = await loadCatalog();
const missing = [];
const leftovers = [];
for (const file of walk(src)) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  for (const m of text.matchAll(CALL)) {
    const key = unescape(m[2], m[1]);
    if (m[1] === "`" && key.includes("${")) {
      missing.push(`${rel}: template literal with \${} inside t(): ${key.slice(0, 80)}`);
      continue;
    }
    if (CYR.test(key) && !Object.hasOwn(strings, key)) missing.push(`${rel}: ${key}`);
  }
  // Russian outside t()/tr(): strip calls and comments, then look for Cyrillic.
  // Calls may span lines, so they are blanked in the whole text first
  // (newlines kept, so line numbers stay right). Russian plural forms passed
  // to plural() are wording data, not untranslated text.
  const keepLines = (m) => m.replace(/[^\n]/g, " ");
  const blanked = text
    .replace(/\b(?:t|tr)\(\s*(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, keepLines)
    .replace(/\bplural\(\s*[^,]+,\s*\[[^\]]*\]/g, keepLines);
  const lines = text.split("\n");
  const blankLines = blanked.split("\n");
  lines.forEach((line, i) => {
    const code = blankLines[i]
      .replace(/\/\/.*$/, "")
      .replace(/\{\/\*.*?\*\/\}/g, "");
    if (CYR.test(code) && !/^\s*\*/.test(line) && !/i18n-ignore/.test(line))
      leftovers.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (missing.length) {
  console.log(`Missing English entries (${missing.length}):`);
  for (const m of missing) console.log("  " + m);
}
if (leftovers.length) {
  console.log(`\nRussian text outside t()/tr() (${leftovers.length}):`);
  for (const l of leftovers) console.log("  " + l);
}
if (!missing.length && !leftovers.length) console.log("i18n: OK");
if (process.argv.includes("--strict") && (missing.length || leftovers.length))
  process.exit(1);
