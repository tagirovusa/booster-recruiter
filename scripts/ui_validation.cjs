/* Frontend/backend validation parity. Uses local synthetic data; never LinkedIn. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
// Pure outreach rules: the only import is the i18n helper, stubbed here.
const source = fs
  .readFileSync(path.join(root, "src/outreach/rules.js"), "utf8")
  .replace(
    /^import \{[^}]*\} from "\.\.\/i18n";$/m,
    // Russian source text: t() only fills {placeholders}.
    'var t = (s, v) => (v ? s.replace(/\\{(\\w+)\\}/g, (w, k) => (k in v ? String(v[k]) : w)) : s); var locale = () => "ru-RU";',
  )
  .replace(/\bexport\s+(?=(?:function|const))/g, "");
const start = 0;
const end = source.length;
assert(
  source.includes("const TEMPLATE_FIELDS"),
  "Template helpers must be present",
);
// Only tracked application code is evaluated. User text is supplied as data.
const { validateTemplate, describeOutreach, outreachCounts } =
  vm.runInNewContext(
    source.slice(start, end).replaceAll("export function", "function") +
      "\n({ validateTemplate, describeOutreach, outreachCounts })",
  );

const candidate = {
  name: "Alex Morgan",
  headline: "Driver Recruiter",
  company: "Example Logistics",
};
const cases = [];
function add(text, kind = "message", people = [candidate]) {
  cases.push({
    text,
    kind,
    people,
    options: {
      limit: ["invitation", "subject"].includes(kind) ? 200 : 1900,
      required:
        ["message", "subject"].includes(kind) ||
        (kind === "inmail" && Boolean(text)),
      singleLine: kind === "subject",
    },
  });
}
for (const text of [
  "Hi {first_name}",
  "Hi {name:}",
  "{{name}} and {first_name}",
  "{{{name}}}",
  "{company}",
  "{headline}",
  "{role}",
  "{name:>20}",
  "{name!s}",
  "{name",
  "Hi }",
  "Hi [link]",
  "Hi [ссылка]",
  "Hello\t{name}",
  "",
  "   ",
  "🙂".repeat(1900),
  "🙂".repeat(1901),
  "{first_name}\nWelcome",
  "{first_name}\r\nWelcome",
])
  add(text);
for (const kind of ["invitation", "subject"])
  for (const text of [
    "A".repeat(200),
    "A".repeat(201),
    "Hi\nthere",
    "Hi\rthere",
    "Hi {name}",
    "   ",
  ])
    add(text, kind);
add("Hi {company}", "message", [{ name: "Jordan Lee" }]);
add("Hi {first_name}", "message", [{}]);
add("A".repeat(180) + "{name}", "invitation", [
  { name: "Alex" },
  { name: "A".repeat(40) },
]);
add("   ", "inmail");
add("", "inmail");
add("Hello {first_name}", "inmail");
add("🙂".repeat(1901), "inmail");
add("x".repeat(4001));

const python = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const pythonCheck = String.raw`
import json, sys, tempfile
from pathlib import Path
from booster_recruiter.store import Store, AppError

cases = json.loads(sys.stdin.buffer.read().decode('utf-8'))
outcomes = []
with tempfile.TemporaryDirectory(prefix="booster-ui-validation-") as temporary:
    store = Store(Path(temporary))
    try:
        account = store.create_account("Synthetic validation")
        store.set_account(account["id"], "ready", "validation-sender")
        for index, case in enumerate(cases):
            campaign = store.create_campaign({
                "account_id": account["id"], "name": f"Validation {index}",
                "keywords": "synthetic", "max_profiles": 20,
            })
            cid = campaign["id"]
            try:
                text, kind = case["text"], case["kind"]
                store.templates(cid, "Hello.", text if kind == "message" else "Hello.")
                rules = store.outreach.rules(cid)
                if kind == "invitation":
                    rules["invitation"] = text
                if kind in ("subject", "inmail"):
                    rules.update(allow_inmail=True,
                                 subject_open="Hello", subject_neutral="Hello")
                    rules["subject_neutral" if kind == "subject" else "inmail_neutral"] = text
                store.outreach.configure(cid, rules)
                for number, person in enumerate(case["people"]):
                    store.add_candidate(cid, {**person, "url": f"validation-{index}-{number}"})
                for person in store.detail(cid)["candidates"]:
                    store.review(person["id"], "neutral", True)
                # Real authoritative preview validation, with no approval or runtime.
                store.outreach.preview(cid)
                outcomes.append({"accepted": True})
            except AppError as error:
                outcomes.append({"accepted": False, "error": str(error)})
    finally:
        store.db.close()
print(json.dumps(outcomes))
`;

async function main() {
  const outcomes = JSON.parse(
    execFileSync(python, ["-c", pythonCheck], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: path.join(root, "backend") },
      input: JSON.stringify(cases),
      encoding: "utf8",
    }),
  );
  assert.equal(outcomes.length, cases.length);
  for (const [index, item] of cases.entries()) {
    const result = validateTemplate(item.text, item.people, item.options);
    assert.equal(
      !result.error,
      outcomes[index].accepted,
      JSON.stringify({
        kind: item.kind,
        text: item.text.slice(0, 80),
        frontend: result.error,
        backend: outcomes[index].error,
      }),
    );
  }
  assert.equal(
    validateTemplate("🙂".repeat(1900), [candidate], { required: true }).count,
    1900,
  );
  assert.equal(
    validateTemplate("Hi {first_name}", [{ name: "Alex" }, { name: "Jordan" }])
      .count,
    9,
  );
  assert.equal(validateTemplate("{name}", []).rendered, false);
  assert.equal(validateTemplate("", [], { required: true }).error, "");

  const rules = {
    allow_inmail: true,
    allow_invites: true,
    strategy: "fast",
    wait_days: 7,
  };
  const fast = describeOutreach(rules);
  assert(
    fast.indexOf("Платный InMail") <
      fast.indexOf("используем доступное приглашение"),
  );
  assert(
    describeOutreach({
      ...rules,
      strategy: "economy",
      allow_invites: false,
    }).includes("Приглашения выключены"),
  );
  assert(
    describeOutreach({
      ...rules,
      allow_inmail: false,
      allow_invites: false,
    }).includes("отправки не будет"),
  );
  assert(fast.includes("без списания кредита"));

  // A historical confirmation may exist without the later member timestamp;
  // receiving a reply must not erase that recipient from the sent total.
  const historicalReply = outreachCounts({
    status: "paused",
    members: [{ id: "replied", status: "replied", sent_at: null }],
    actions: [{ member_id: "replied", kind: "message", status: "sent" }],
  });
  assert.equal(historicalReply.sent, 1);
  assert.equal(historicalReply.replied, 1);
  const counts = outreachCounts({
    members: [
      { id: "timestamp", status: "sent", sent_at: "2026-11-01T10:00:00Z" },
      { id: "reply", status: "replied" },
      { id: "inmail", status: "sent" },
      { id: "invite", status: "waiting_acceptance" },
      { id: "unknown", status: "needs_review" },
      { id: "submitting", status: "needs_review" },
      { id: "blocked", status: "needs_review" },
      { id: "prior-reply", status: "replied" },
    ],
    actions: [
      { member_id: "timestamp", kind: "message", status: "sent" },
      { member_id: "reply", kind: "message", status: "sent" },
      { member_id: "reply", kind: "inmail", status: "sent" },
      { member_id: "inmail", kind: "inmail", status: "sent" },
      { member_id: "invite", kind: "invite", status: "sent" },
      { member_id: "unknown", kind: "message", status: "unknown" },
      { member_id: "submitting", kind: "inmail", status: "submitting" },
      { member_id: "blocked", kind: "message", status: "blocked" },
      { member_id: "outside-run", kind: "message", status: "sent" },
    ],
  });
  assert.equal(
    counts.sent,
    3,
    "Count confirmed recipients, not actions or replies without send evidence",
  );
  assert.equal(counts.waiting, 1);
  assert.equal(counts.replied, 2);
  assert.equal(outreachCounts({ members: [], actions: [] }).sent, 0);
  assert.equal(outreachCounts(null), null);

  let api, behavior;
  const electron = {
    contextBridge: {
      exposeInMainWorld(_name, value) {
        api = value;
      },
    },
    ipcRenderer: {
      invoke(...args) {
        return behavior(...args);
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "desktop/preload.cjs"), "utf8"),
    {
      require(name) {
        assert.equal(name, "electron");
        return electron;
      },
    },
  );
  for (const [raw, wanted] of [
    [
      "Error invoking remote method 'command': Error: Укажите название.",
      "Укажите название.",
    ],
    [
      "Error invoking remote method 'export': Error: Первая строка.\nПодробности.",
      "Первая строка.\nПодробности.",
    ],
    ["Не удалось сохранить файл.", "Не удалось сохранить файл."],
    ["Error in custom command body", "Error in custom command body"],
    [
      "Error invoking remote method 'command': TypeError: Useful detail",
      "TypeError: Useful detail",
    ],
  ]) {
    behavior = async () => {
      throw new Error(raw);
    };
    await assert.rejects(
      api.command("state"),
      (error) => error.message === wanted,
    );
  }
  behavior = async (...args) => args;
  assert.deepEqual(Array.from(await api.command("state", { id: "demo" })), [
    "command",
    "state",
    { id: "demo" },
  ]);
  assert.deepEqual(Array.from(await api.export("demo", "csv")), [
    "export",
    "demo",
    "csv",
  ]);

  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { transformWithOxc } = await import("vite");
  // Components under test, transformed together with the rules they use.
  const components = ["src/outreach/parts.jsx", "src/DesktopPreferences.jsx"]
    .map((file) =>
      fs
        .readFileSync(path.join(root, file), "utf8")
        .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, ""),
    )
    .join("\n");
  const transformed = await transformWithOxc(
    source + "\n" + components,
    "Outreach.jsx",
    { jsx: { runtime: "classic" } },
  );
  // Shared wording modules are plain constants and functions; inline them so
  // the sandbox sees the same labels the app imports.
  // The i18n helpers are stubbed with the Russian (source-text) behavior.
  const i18nStub = `
    var t = (s, v) => (v ? s.replace(/\\{(\\w+)\\}/g, (w, k) => (k in v ? String(v[k]) : w)) : s);
    var tr = (s) => s;
    var locale = () => "ru-RU";
    var formatDateTime = (v) => (v ? new Date(v).toLocaleString("ru-RU") : "—");
    var formatNumber = (v, o) => Number(v).toLocaleString("ru-RU", o);
    var hourLabel = (h) => { const n = Number(h); if (n === 24) return "12:00 AM (полночь)"; const x = ((n % 24) + 24) % 24; return (x % 12 === 0 ? 12 : x % 12) + ":00 " + (x < 12 ? "AM" : "PM"); };
    var plural = (count, [one, few, many]) => { const f = new Intl.PluralRules("ru").select(count); return f === "one" ? one : f === "few" ? few : f === "many" ? many : few; };
  `;
  const shared =
    i18nStub +
    ["src/labels.js"]
      .map((file) =>
        fs
          .readFileSync(path.join(root, file), "utf8")
          .replace(/^import[\s\S]*?from\s*["'][^"']+["'];?$/gm, "")
          .replace(/^export\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?$/gm, "")
          .replace(/\bexport\s+(?=(?:function|const))/g, ""),
      )
      .join("\n");
  const componentCode =
    shared +
    "\n" +
    transformed.code
      .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "")
      .replace(/export\s*\{[\s\S]*?\};?/g, "")
      .replace(/\bexport\s+(?=(?:function|const))/g, "");
  const { ContactState, DetailMessage, DesktopPreferences } =
    vm.runInNewContext(
      componentCode + "\n({ContactState, DetailMessage, DesktopPreferences})",
      {
        React,
        ...React,
        ...require("lucide-react"),
      },
    );
  const render = (status, run_status) =>
    renderToStaticMarkup(
      React.createElement(ContactState, {
        person: { data: {} },
        member: {
          status,
          run_status,
          relationship: "pending",
          detail: "Ожидаем принятия.",
        },
      }),
    );
  assert(render("waiting_acceptance", "cancelled").includes("План остановлен"));
  assert(
    render("waiting_acceptance", "paused").includes(
      "после возобновления плана",
    ),
  );
  assert(render("replied", "cancelled").includes("Ответ получен"));
  assert(!render("replied", "cancelled").includes("План остановлен"));
  assert(render("needs_review", "cancelled").includes("Требует внимания"));
  const renderDetail = (props) =>
    renderToStaticMarkup(React.createElement(DetailMessage, props));
  const rawUnknown =
    "The message was submitted but LinkedIn did not confirm the message-list transition in time. Check the conversation before retrying; retrying may deliver the message twice.";
  for (const [status, kind, detail, expected] of [
    ["unknown", "message", rawUnknown, "Не повторяйте отправку до проверки"],
    [
      "unknown",
      "invite",
      "Invitation submission could not be confirmed.",
      "Проверьте приглашение в профиле LinkedIn.",
    ],
    [
      "sent",
      "message",
      "Message submitted and confirmed in the conversation UI.",
      "Отправка сообщения подтверждена в LinkedIn.",
    ],
    [
      "sent",
      "invite",
      "Invitation confirmed.",
      "Отправка приглашения подтверждена в LinkedIn.",
    ],
    [
      "blocked",
      "message",
      "Message composer unavailable <dialog>.",
      "Действие остановлено.",
    ],
    [
      "needs_review",
      undefined,
      '{"message":"Ошибка","meta":{"code":"outcome_unknown"}}',
      "Результат требует ручной проверки.",
    ],
  ]) {
    const markup = renderDetail({ detail, status, kind });
    assert(
      markup.includes(expected),
      `${status}/${kind} should give a Russian next step`,
    );
    assert(markup.includes("Технические подробности"));
    assert(
      markup.includes(
        renderToStaticMarkup(React.createElement("pre", null, detail)),
      ),
      "The exact diagnostic must remain accessible and escaped",
    );
    assert(
      !markup.includes("<details open"),
      "Raw diagnostics should initially be collapsed",
    );
    if (status === "blocked") assert(!markup.includes("не отправлено"));
  }
  const russianDetail =
    "LinkedIn просит подтвердить вход. Откройте аккаунт и войдите повторно.";
  const russianMarkup = renderDetail({
    detail: russianDetail,
    status: "blocked",
  });
  assert(russianMarkup.includes(russianDetail));
  assert(!russianMarkup.includes("Технические подробности"));
  assert.equal(renderDetail({ detail: "  ", status: "unknown" }), "");
  const settingsLoading = renderToStaticMarkup(
    React.createElement(DesktopPreferences),
  );
  assert(settingsLoading.includes('class="panel preferences-card"'));
  assert(settingsLoading.includes('role="status">Загружаем настройки…'));
  assert(settingsLoading.includes("пока компьютер включён и не спит"));
  console.log(
    `PASS: ${cases.length} frontend/backend preview parity cases; Unicode counters, recipient totals, route copy, IPC errors/forwarding, stopped-plan rendering, Russian status guidance/raw diagnostics, and settings loading. No LinkedIn requests or sends.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
