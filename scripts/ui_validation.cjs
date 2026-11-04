/* Frontend/backend validation parity. Uses local synthetic data; never LinkedIn. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/Outreach.jsx"), "utf8");
const start = source.indexOf("const TEMPLATE_FIELDS");
const end = source.indexOf("function TemplateFeedback");
assert(start >= 0 && end > start, "Template helpers must be present");
// Only tracked application code is evaluated. User text is supplied as data.
const { validateTemplate, describeOutreach } = vm.runInNewContext(
  source.slice(start, end).replaceAll("export function", "function") +
    "\n({ validateTemplate, describeOutreach })",
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

cases = json.load(sys.stdin)
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
                    rules.update(allow_inmail=True, inmail_budget=5,
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
  const transformed = await transformWithOxc(source, "Outreach.jsx", {
    jsx: { runtime: "classic" },
  });
  const componentCode = transformed.code
    .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "")
    .replace(/export\s*\{[\s\S]*?\};?/g, "")
    .replace(/\bexport\s+(?=(?:function|const))/g, "");
  const { ContactState } = vm.runInNewContext(
    componentCode + "\n({ContactState})",
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
  assert(render("needs_review", "cancelled").includes("Нужно проверить"));
  console.log(
    `PASS: ${cases.length} frontend/backend preview parity cases; Unicode counters, route copy, IPC errors/forwarding, and stopped-plan rendering. No LinkedIn requests or sends.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
