const test = require("node:test");
const assert = require("node:assert/strict");
const { createPauseAllHandler } = require("../desktop/tray_pause.cjs");

const campaigns = [
  { id: "a", name: "Кампания А" },
  { id: "b", name: "Кампания Б" },
  { id: "c", name: "Кампания В" },
];
function fixture(pause, state = async () => ({ campaigns })) {
  const requests = [],
    reports = [];
  const handler = createPauseAllHandler({
    async call(op, parameters) {
      if (op === "state") return state();
      assert.equal(op, "campaign.pause");
      requests.push(parameters.id);
      return pause(parameters.id);
    },
    async report(result) {
      reports.push(result);
    },
  });
  return { handler, requests, reports };
}

test("success reports acknowledged requests and warns that an in-flight action may finish", async () => {
  const f = fixture(async (id) => ({
    pause_requested: true,
    paused: id !== "a",
  }));
  const menu = { enabled: true };
  await f.handler(menu);
  assert.deepEqual(f.requests, ["a", "b", "c"]);
  assert.equal(f.reports[0].type, "info");
  assert.match(f.reports[0].message, /Пауза запрошена.*3/);
  assert.match(
    f.reports[0].detail,
    /начатое действие LinkedIn может завершиться/,
  );
  assert.doesNotMatch(
    JSON.stringify(f.reports[0]),
    /Все кампании приостановлены/,
  );
  assert.equal(menu.enabled, true);
});

test("one failed campaign does not prevent pausing later campaigns", async () => {
  const f = fixture(async (id) => {
    if (id === "b") throw Error("synthetic connection error");
    return { pause_requested: true, paused: true };
  });
  await f.handler();
  assert.deepEqual(f.requests, ["a", "b", "c"]);
  assert.equal(f.reports[0].type, "warning");
  assert.match(f.reports[0].message, /2 из 3/);
  assert.match(f.reports[0].detail, /Кампания Б: synthetic connection error/);
  assert.match(f.reports[0].detail, /Проверьте оставшиеся кампании/);
});

test("all failures and missing acknowledgements never claim a successful pause", async () => {
  const f = fixture(async (id) => {
    if (id === "b") return {};
    throw Error("synthetic failure");
  });
  await f.handler();
  assert.deepEqual(f.requests, ["a", "b", "c"]);
  assert.equal(f.reports[0].type, "error");
  assert.match(f.reports[0].message, /0 из 3/);
  assert.match(f.reports[0].detail, /Работа кампаний могла продолжиться/);
  assert.match(f.reports[0].detail, /Сервис не подтвердил запрос паузы/);
});

test("state-fetch failure is visible and no campaign request is invented", async () => {
  const f = fixture(
    async () => {
      throw Error("not reached");
    },
    async () => {
      throw Error("synthetic state failure");
    },
  );
  await f.handler();
  assert.deepEqual(f.requests, []);
  assert.equal(f.reports[0].type, "error");
  assert.match(f.reports[0].message, /Не удалось получить список кампаний/);
  assert.match(f.reports[0].detail, /synthetic state failure/);
});

test("empty state is explained without issuing pause requests", async () => {
  const f = fixture(
    async () => {
      throw Error("not reached");
    },
    async () => ({ campaigns: [] }),
  );
  await f.handler();
  assert.deepEqual(f.requests, []);
  assert.equal(f.reports[0].type, "info");
  assert.match(f.reports[0].message, /Кампаний для приостановки пока нет/);
});

test("reentrant clicks do not overlap while requests or the result dialog are pending", async () => {
  let releasePause, releaseDialog;
  const pauseGate = new Promise((resolve) => {
    releasePause = resolve;
  });
  const dialogGate = new Promise((resolve) => {
    releaseDialog = resolve;
  });
  let states = 0,
    pauses = 0,
    dialogs = 0;
  const handler = createPauseAllHandler({
    async call(op) {
      if (op === "state") {
        states++;
        return { campaigns: [campaigns[0]] };
      }
      pauses++;
      await pauseGate;
      return { pause_requested: true, paused: true };
    },
    async report() {
      dialogs++;
      await dialogGate;
    },
  });
  const menu = { enabled: true };
  const first = handler(menu);
  await Promise.resolve();
  assert.equal(menu.enabled, false);
  await handler(menu);
  assert.equal(states, 1);
  assert.equal(pauses, 1);
  releasePause();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dialogs, 1);
  await handler(menu);
  assert.equal(states, 1);
  releaseDialog();
  await first;
  assert.equal(menu.enabled, true);
  await handler(menu);
  assert.equal(states, 2);
  assert.equal(pauses, 2);
});

test("a dialog failure releases the guard for a later request", async () => {
  let reports = 0;
  const handler = createPauseAllHandler({
    async call() {
      return { campaigns: [] };
    },
    async report() {
      if (++reports === 1) throw Error("synthetic dialog failure");
    },
  });
  const menu = { enabled: true };
  await assert.rejects(handler(menu), /dialog failure/);
  assert.equal(menu.enabled, true);
  await handler(menu);
  assert.equal(reports, 2);
});

test("in English, service failures are shown in English", async () => {
  const i18n = require("../desktop/i18n.cjs");
  i18n.setLanguage("en");
  try {
    const reports = [];
    const handler = createPauseAllHandler({
      async call(op) {
        if (op === "state") return { campaigns: [{ id: "a", name: "Test" }] };
        throw Error("Кампания в архиве. Сначала верните её из архива.");
      },
      async report(result) {
        reports.push(result);
      },
      t: i18n.t,
      tr: i18n.tr,
    });
    await handler();
    const [report] = reports;
    assert.equal(report.title, "Pause not confirmed for all campaigns");
    assert.match(report.detail, /Test: The campaign is archived\./);
    assert.doesNotMatch(report.detail, /[А-Яа-яЁё]/);
  } finally {
    i18n.setLanguage("ru");
  }
});
