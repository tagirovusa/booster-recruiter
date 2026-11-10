// Interface language. English is the default; Russian can be chosen in
// Settings. Source strings in the code stay Russian and act as keys: t("…")
// returns the English text from the catalog when English is active.
//
// Two helpers:
//   t(ru, vars)  — a fixed interface string; {name} placeholders are filled
//                  from vars in both languages.
//   tr(text)     — a message that came from the service, the desktop shell or
//                  an error. Exact catalog entries win; otherwise templates
//                  with placeholders are matched, and the captured parts are
//                  translated recursively.
import { en, enTemplates } from "./i18n/en";

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
];
const STORAGE_KEY = "booster.language";

function readStored() {
  // The desktop shell passes the saved language to the window; the browser
  // copy is only a fallback for the plain web preview.
  const desktop = typeof window !== "undefined" ? window.booster?.language : "";
  if (desktop === "ru" || desktop === "en") return desktop;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "ru" || value === "en" ? value : "en";
  } catch {
    return "en";
  }
}

let current = readStored();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLang() {
  return current;
}

export const isEnglish = () => current === "en";

// Switching reloads the window so every screen, including memoized parts,
// is drawn again in the new language. The desktop shell is told first so
// menus, tray and system dialogs follow.
export async function setLang(lang) {
  if (lang !== "en" && lang !== "ru") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {}
  try {
    await window.booster?.setLanguage?.(lang);
  } catch {}
  try {
    window.sessionStorage.setItem("booster.returnPage", "settings");
  } catch {}
  current = lang;
  window.location.reload();
}

export function locale() {
  return current === "en" ? "en-US" : "ru-RU";
}

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : whole,
  );
}

const CYRILLIC = /[А-Яа-яЁё]/;

export function t(ru, vars) {
  if (current !== "en") return fill(ru, vars);
  const english = Object.hasOwn(en, ru) ? en[ru] : translateDynamic(ru);
  return fill(english ?? ru, vars);
}

// Templates are compiled once: "Сохранено {count} из {max}." becomes a
// regular expression with one capture group per placeholder.
let compiled = null;
// A strict placeholder never crosses a sentence end, so a template such as
// "Профилей сохранено: {count}." cannot swallow the sentences after it.
const STRICT = "((?:(?![.!?…](?:\\s|$))[\\s\\S])*?)";
const LOOSE = "([\\s\\S]*?)";
function compile() {
  if (compiled) return compiled;
  compiled = [];
  for (const [ru, english] of Object.entries(enTemplates)) {
    const names = [];
    const pieces = ru.split(/(\{\w+\})/).map((part) => {
      const m = part.match(/^\{(\w+)\}$/);
      if (m) {
        names.push(m[1]);
        return null;
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
    const build = (slot) =>
      new RegExp(`^${pieces.map((p) => p ?? slot).join("")}$`);
    // Specificity is the fixed text only: placeholders must not make a
    // generic template like "{head}: {tail}" outrank "Проверяем: {name}".
    const fixed = ru.replace(/\{\w+\}/g, "").length;
    compiled.push({
      strict: build(STRICT),
      loose: build(LOOSE),
      names,
      english,
      fixed,
    });
  }
  // Longer, more specific templates first.
  compiled.sort((a, b) => b.fixed - a.fixed);
  return compiled;
}

function byTemplate(text, depth, mode) {
  for (const entry of compile()) {
    const m = text.match(entry[mode]);
    if (!m) continue;
    const vars = {};
    entry.names.forEach((name, i) => {
      const part = m[i + 1];
      vars[name] = CYRILLIC.test(part) ? translateText(part, depth + 1) : part;
    });
    return fill(entry.english, vars);
  }
  return undefined;
}

function translateDynamic(text, depth = 0) {
  if (typeof text !== "string" || !CYRILLIC.test(text) || depth > 4)
    return undefined;
  return byTemplate(text, depth, "strict") ?? byTemplate(text, depth, "loose");
}

function exact(text) {
  if (Object.hasOwn(en, text)) return en[text];
  const trimmed = text.trim();
  if (trimmed !== text && Object.hasOwn(en, trimmed))
    return text.replace(trimmed, en[trimmed]);
  return undefined;
}

// Order: exact entry, strict template, sentence by sentence, loose template.
function translateText(text, depth) {
  if (!CYRILLIC.test(text) || depth > 4) return text;
  const known = exact(text) ?? byTemplate(text, depth, "strict");
  if (known !== undefined) return known;
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g);
  let split;
  if (sentences && sentences.length > 1) {
    split = sentences
      .map((s) => {
        const lead = s.match(/^\s*/)[0];
        const tail = s.match(/\s*$/)[0];
        return lead + translateText(s.trim(), depth + 1) + tail;
      })
      .join("");
    if (!CYRILLIC.test(split)) return split;
  }
  const loose = byTemplate(text, depth, "loose");
  if (loose !== undefined && !CYRILLIC.test(loose)) return loose;
  return split ?? loose ?? text;
}

// Messages from the service, errors and stored progress lines. Text written
// by the recruiter or taken from LinkedIn must not be passed here.
export function tr(text) {
  if (current !== "en" || typeof text !== "string" || !text) return text;
  return translateText(text, 0);
}

// plural(3, ["кандидат", "кандидата", "кандидатов"], ["candidate", "candidates"])
const ruRules = new Intl.PluralRules("ru");
export function plural(count, [one, few, many], english) {
  if (current === "en" && english) {
    return Math.abs(count) === 1 ? english[0] : (english[1] ?? english[0]);
  }
  const form = ruRules.select(count);
  return form === "one"
    ? one
    : form === "few"
      ? few
      : form === "many"
        ? many
        : few;
}

export function formatDateTime(value, options) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(
    locale(),
    options ?? (current === "en" ? { hour12: true } : undefined),
  );
}

export function formatNumber(value, options) {
  return Number(value).toLocaleString(locale(), options);
}

// Working hours are always shown in the US 12-hour format: 0 → 12:00 AM,
// 13 → 1:00 PM, 24 (end of day) → 12:00 AM (midnight).
export function hourLabel(hour) {
  const n = Number(hour);
  if (n === 24)
    return current === "en" ? "12:00 AM (midnight)" : "12:00 AM (полночь)";
  const h = ((n % 24) + 24) % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:00 ${suffix}`;
}
