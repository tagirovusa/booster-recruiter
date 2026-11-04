const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "../src/Outreach.jsx"),
  "utf8",
);
const start = source.indexOf("export function campaignNextEvent");
const end = source.indexOf("function TemplateFeedback", start);
const next = vm.runInNewContext(
  source.slice(start, end).replace("export function", "function") +
    "\ncampaignNextEvent",
);
const ready = { status: "ready" };
const now = Date.parse("2026-11-04T12:00:00Z");
const run = (changes = {}) => ({
  status: "active",
  rules: { timezone: "America/New_York" },
  members: [],
  actions: [],
  ...changes,
});
test("login and account restriction take priority over waiting times", () => {
  const r = run({
    members: [
      { status: "waiting_acceptance", next_check: "2026-11-04T16:00:00Z" },
    ],
  });
  assert.equal(next(r, { status: "needs_login" }, now).kind, "account");
  assert.match(next(r, { status: "restricted" }, now).title, /ограничены/);
});
test("uncertain paused sends direct user to history rather than promise another send", () => {
  const value = next(
    run({ status: "paused", actions: [{ status: "unknown" }] }),
    ready,
    now,
  );
  assert.equal(value.kind, "review");
  assert.match(value.text, /Повторная отправка заблокирована/);
  assert.doesNotMatch(value.text, /Следующая проверка/);
});
test("ordinary manual pause never advertises a stale automatic check", () => {
  const value = next(
    run({
      status: "paused",
      members: [{ status: "sent", next_check: "2026-11-04T14:00:00Z" }],
    }),
    ready,
    now,
  );
  assert.equal(value.kind, "paused");
  assert.match(value.text, /остановлены/);
  assert.doesNotMatch(value.text, /14:00/);
});
test("future checks use run timezone and a lower bound rather than guaranteed delivery time", () => {
  const value = next(
    run({
      members: [
        { status: "waiting_acceptance", next_check: "2026-11-04T16:00:00Z" },
        { status: "excluded", next_check: "2026-11-04T13:00:00Z" },
      ],
    }),
    ready,
    now,
  );
  assert.match(value.title, /: 1$/);
  assert.match(value.text, /11:00/);
  assert.match(value.text, /America\/New_York/);
  assert.match(value.text, /не раньше/);
  assert.match(value.text, /если LinkedIn разрешает/);
});
test("overdue work explains waiting without inventing a deadline", () => {
  const value = next(
    run({
      members: [{ status: "planned", next_check: "2026-11-04T11:00:00Z" }],
    }),
    ready,
    now,
  );
  assert.match(value.text, /ожидает выполнения в рабочее время/);
  assert.doesNotMatch(value.text, /не раньше/);
});
test("finished and excluded people do not create a future check", () => {
  const value = next(
    run({
      members: [{ status: "replied", next_check: "2026-11-04T16:00:00Z" }],
    }),
    ready,
    now,
  );
  assert.match(value.title, /завершены/);
  assert.doesNotMatch(value.text, /Следующая проверка/);
});

test("pause during submission waits for confirmation instead of asking for manual resolution", () => {
  const value = next(
    run({ status: "paused", actions: [{ status: "submitting" }] }),
    ready,
    now,
  );
  assert.equal(value.kind, "busy");
  assert.match(value.text, /Дождитесь результата/);
});
test("one parked profile does not label the whole active campaign stopped", () => {
  const value = next(
    run({
      members: [
        { status: "needs_review" },
        { status: "waiting_acceptance", next_check: "2026-11-04T16:00:00Z" },
      ],
    }),
    ready,
    now,
  );
  assert.match(value.title, /Ожидаем принятия/);
  assert.match(value.text, /Отложены для проверки: 1/);
  assert.match(value.text, /Остальные получатели продолжают/);
});
test("a repaired old unknown invitation does not demand manual resolution again", () => {
  const value = next(
    run({
      status: "paused",
      actions: [
        { status: "unknown", repair_replaced_by: "confirmed-new-action" },
      ],
    }),
    ready,
    now,
  );
  assert.equal(value.kind, "paused");
  assert.doesNotMatch(value.text, /укажите результат|заблокирована/i);
});

test("manual pause can resume other approved recipients while uncertain people stay parked", () => {
  const value = next(
    run({
      status: "paused",
      actions: [{ status: "unknown" }],
      members: [{ status: "needs_review" }, { status: "planned" }],
    }),
    ready,
    now,
  );
  assert.equal(value.kind, "paused");
  assert.match(value.text, /Можно продолжить план для остальных/);
  assert.match(value.text, /спорные действия повторяться не будут/);
});
