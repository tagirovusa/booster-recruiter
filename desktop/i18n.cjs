// Language of the desktop shell: application menu, tray menu, system dialogs
// and notifications. English is the default; Russian is chosen in Settings
// and stored in desktop-preferences.json ("language").
//
// Source strings stay Russian and act as keys. Errors that travel to the
// window keep their Russian text and are translated there (src/i18n.js).
let current = "en";

const en = {
  // Application menu
  "О Booster Recruiter": "About Booster Recruiter",
  Службы: "Services",
  "Скрыть Booster Recruiter": "Hide Booster Recruiter",
  "Скрыть остальные": "Hide Others",
  "Показать все": "Show All",
  "Завершить Booster Recruiter": "Quit Booster Recruiter",
  Выход: "Exit",
  Правка: "Edit",
  Отменить: "Undo",
  Повторить: "Redo",
  Вырезать: "Cut",
  Копировать: "Copy",
  Вставить: "Paste",
  "Выделить всё": "Select All",
  Окно: "Window",
  Свернуть: "Minimize",
  "Изменить размер": "Zoom",
  "Полный экран": "Toggle Full Screen",
  "Закрыть окно": "Close Window",
  Разработка: "Developer",
  Перезагрузить: "Reload",
  "Инструменты разработчика": "Developer Tools",
  // Tray
  "Открыть Booster Recruiter": "Open Booster Recruiter",
  "Приостановить все кампании": "Pause all campaigns",
  "Завершить работу": "Quit",
  Понятно: "OK",
  // Tray: pause all
  "Сервис не вернул список кампаний.":
    "The service did not return the campaign list.",
  "Пауза не подтверждена": "Pause not confirmed",
  "Не удалось получить список кампаний и запросить паузу.":
    "Could not get the campaign list and request a pause.",
  "Работа кампаний могла продолжиться. Проверьте состояние в приложении. Чтобы остановить приложение полностью, выберите «Завершить работу» в меню его значка.\n\nТехнические подробности: {detail}":
    "Campaigns may still be running. Check their status in the app. To stop the app completely, choose “Quit” in its menu bar icon menu.\n\nTechnical details: {detail}",
  "Нет кампаний": "No campaigns",
  "Кампаний для приостановки пока нет.": "There are no campaigns to pause yet.",
  "Сервис не подтвердил запрос паузы.":
    "The service did not confirm the pause request.",
  "Пауза не подтверждена для всех кампаний":
    "Pause not confirmed for all campaigns",
  "Пауза запрошена": "Pause requested",
  "Запрос паузы подтверждён для {requested} из {total} кампаний.":
    "Pause request confirmed for {requested} of {total} campaigns.",
  "Пауза запрошена для всех кампаний: {requested}.":
    "Pause requested for all campaigns: {requested}.",
  "Уже начатое действие LinkedIn может завершиться. Следующие действия в этих кампаниях остановлены до возобновления.":
    "A LinkedIn action that has already started may finish. Further actions in these campaigns are stopped until you resume them.",
  "Работа кампаний могла продолжиться.": "Campaigns may still be running.",
  "Проверьте оставшиеся кампании в приложении. При необходимости полностью остановите приложение через «Завершить работу» в меню его значка.":
    "Check the remaining campaigns in the app. If needed, stop the app completely with “Quit” in its menu bar icon menu.",
  "Статус и результат текущего действия можно проверить в приложении.":
    "You can check the status and result of the current action in the app.",
  "Не удалось подтвердить паузу:": "Could not confirm the pause:",
  // Close confirmation
  "Кампании остановятся": "Campaigns will stop",
  "Кампания «{name}» работает. Если закрыть приложение, она остановится.":
    "Campaign “{name}” is running. If you close the app, it will stop.",
  "Работают кампании: {count}. Если закрыть приложение, они остановятся.":
    "Campaigns running: {count}. If you close the app, they will stop.",
  "Можно оставить приложение работать в фоне — значок останется в строке меню, а окно откроется по щелчку.":
    "You can keep the app running in the background — its icon stays in the menu bar and the window opens with a click.",
  "Работать в фоне": "Keep running in background",
  "Закрыть и остановить": "Close and stop",
  Отмена: "Cancel",
  "Настройки не сохранены": "Settings not saved",
  "Не удалось подтвердить сохранение настроек. Окно оставлено открытым.":
    "Could not confirm that settings were saved. The window stays open.",
  "Закрытие отменено, чтобы работа кампаний не прервалась. Проверьте настройки и попробуйте ещё раз.\n\nТехнические подробности: {detail}":
    "Closing was cancelled so campaigns are not interrupted. Check the settings and try again.\n\nTechnical details: {detail}",
  // Notifications and fatal errors
  "Есть новые ответы. Откройте рабочее пространство.":
    "There are new replies. Open the workspace.",
  "Кампаниям нужна ваша помощь. Откройте рабочее пространство.":
    "Your campaigns need your attention. Open the workspace.",
  "Сервис остановлен": "Service stopped",
  "Перезапустите приложение. Сохранённые кампании останутся; незавершённая отправка потребует проверки.":
    "Restart the app. Saved campaigns are kept; an unfinished send will need to be checked.",
  "Не удалось открыть Booster Recruiter": "Could not open Booster Recruiter",
};

function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : whole,
  );
}

function t(ru, vars) {
  const text = current === "en" && Object.hasOwn(en, ru) ? en[ru] : ru;
  return fill(text, vars);
}

// Messages from the service (errors, stored statuses) are translated with the
// window's catalog (desktop/i18n_en.json, written by
// scripts/export_i18n_catalog.mjs) and the same order as tr() in src/i18n.js:
// exact entry, strict template, sentence by sentence, loose template.
const CYRILLIC = /[А-Яа-яЁё]/;
const STRICT = "((?:(?![.!?…](?:\\s|$))[\\s\\S])*?)";
const LOOSE = "([\\s\\S]*?)";
let catalog = null;
function loadCatalog() {
  if (catalog) return catalog;
  const data = require("./i18n_en.json");
  const templates = Object.entries(data.templates).map(([ru, english]) => {
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
    const fixed = ru.replace(/\{\w+\}/g, "").length;
    return {
      strict: build(STRICT),
      loose: build(LOOSE),
      names,
      english,
      fixed,
    };
  });
  templates.sort((a, b) => b.fixed - a.fixed);
  catalog = { strings: data.strings, templates };
  return catalog;
}
function byTemplate(text, depth, mode) {
  for (const entry of loadCatalog().templates) {
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
function exact(text) {
  const { strings } = loadCatalog();
  if (Object.hasOwn(strings, text)) return strings[text];
  const trimmed = text.trim();
  if (trimmed !== text && Object.hasOwn(strings, trimmed))
    return text.replace(trimmed, strings[trimmed]);
  return undefined;
}
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

// A message that came from the service. Text written by the recruiter or
// taken from LinkedIn must not be passed here.
function tr(text) {
  if (current !== "en" || typeof text !== "string" || !text) return text;
  return translateText(text, 0);
}

function setLanguage(lang) {
  current = lang === "ru" ? "ru" : "en";
}

function getLanguage() {
  return current;
}

module.exports = { t, tr, setLanguage, getLanguage, en };
