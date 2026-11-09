// Real Electron UI + local business records. Every network/job operation denied.
const { _electron: electron, expect } =
  require("./patchright_test_driver.cjs").loadPatchright();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "..");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "booster-ui-workspace-"));
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  execFileSync(python, [path.join(root, "scripts/ui_fixtures.py"), data], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: path.join(root, "backend") },
  });
  const env = { ...process.env, BOOSTER_DATA_DIR: data };
  // These checks read the Russian interface; English is the default.
  fs.writeFileSync(
    path.join(data, "desktop-preferences.json"),
    JSON.stringify({ language: "ru" }),
  );
  if (!process.env.BOOSTER_EXECUTABLE)
    env.PYTHONPATH = path.join(root, "backend");
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    ...(process.env.BOOSTER_EXECUTABLE
      ? { executablePath: process.env.BOOSTER_EXECUTABLE, args: [] }
      : { args: [root] }),
    env,
    timeout: 60000,
  });
  let page;
  const errors = [];
  try {
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("command");
      const allowed = new Set([
        "state",
        "workspace.summary",
        "workspace.acknowledge",
        "campaign.detail",
        "campaign.create",
        "campaign.automation",
        "template.save",
        "template.list",
        "template.create",
        "template.delete",
        "backup.list",
        "backup.create",
        "backup.restore",
      ]);
      global.__workspaceBlocked = [];
      ipcMain.removeHandler("command");
      ipcMain.handle("command", (event, op, args) => {
        if (!allowed.has(op)) {
          global.__workspaceBlocked.push(op);
          throw Error(`Forbidden external/job operation: ${op}`);
        }
        return original(event, op, args);
      });
    });
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await expect(
      page.getByRole("heading", { name: "Ваши кампании" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Требуют внимания" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Требует внимания/ }).click();
    const attention = page.getByRole("region", { name: "Требуют внимания" });
    await expect(
      attention.getByRole("button", { name: /Открыть ответ/ }).first(),
    ).toBeVisible();
    await attention
      .getByRole("button", { name: /Открыть ответ/ })
      .first()
      .click();
    await expect(page.locator("[id^='member-']:focus")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Все кампании", exact: true })
      .click();
    await page.getByRole("button", { name: /^Требует внимания/ }).click();
    const repliesBefore = await attention
      .getByRole("button", { name: "Прочитано", exact: true })
      .count();
    await attention
      .getByRole("button", { name: "Прочитано", exact: true })
      .first()
      .click();
    await expect(
      attention.getByRole("button", { name: "Прочитано", exact: true }),
    ).toHaveCount(repliesBefore - 1);
    await page.reload();
    await page.getByRole("button", { name: /^Требует внимания/ }).click();
    await expect(
      attention.getByRole("button", { name: "Прочитано", exact: true }),
    ).toHaveCount(repliesBefore - 1);
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const notificationToggle = page.getByRole("checkbox", {
      name: "Показывать уведомления на компьютере",
    });
    await notificationToggle.uncheck();
    await page.reload();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(notificationToggle).not.toBeChecked();
    await page
      .getByRole("button", { name: "Создать копию сейчас", exact: true })
      .click();
    await expect(
      page.getByText("Резервная копия сохранена.", { exact: true }),
    ).toBeVisible();
    const backupId = await page.evaluate(
      async () => (await window.booster.command("backup.list")).backups[0].id,
      undefined,
      undefined,
      false,
    );
    await page.getByRole("button", { name: /^Кампании/ }).click();
    await page
      .getByRole("button", { name: "Новая кампания", exact: true })
      .click();
    await page
      .getByLabel("Название кампании", { exact: true })
      .fill("Workspace search fixture");
    // Refinements stay folded until the recruiter asks for them.
    await page.locator("details.search-refine summary").click();
    await page.getByLabel("Исключить", { exact: true }).fill("internship");
    await page
      .getByRole("button", { name: "Создать кампанию", exact: true })
      .click();
    await expect(page.getByLabel("Должности", { exact: true })).toBeFocused();
    await expect(page.getByLabel("Должности", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await page.getByLabel("Должности", { exact: true }).fill("a".repeat(1001));
    await page
      .getByRole("button", { name: "Создать кампанию", exact: true })
      .click();
    await expect(
      page.getByText("Сократите поисковый запрос до 1000 символов.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Должности", { exact: true })
      .fill("Driver recruiter, recruitment manager");
    await page.getByLabel("Отрасль", { exact: true }).fill("Trucking");
    await page
      .getByLabel("Ключевые фразы", { exact: true })
      .fill("CDL drivers, driver retention");
    await page.getByLabel("Исключить", { exact: true }).fill("internship");
    const expected =
      '("Driver recruiter" OR "recruitment manager") AND "Trucking" AND ("CDL drivers" OR "driver retention") AND NOT "internship"';
    await expect(page.locator(".search-query-preview code")).toHaveText(
      expected,
    );
    await page
      .getByRole("button", { name: "Запрос или ссылка", exact: true })
      .click();
    await expect(
      page.getByLabel(/^Ключевые слова или ссылка на профиль/),
    ).toHaveValue(expected);
    await page
      .getByLabel(/^Ключевые слова или ссылка на профиль/)
      .fill(expected + ' AND "lead"');
    await page
      .getByRole("button", { name: "Простой поиск", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "Сброс поискового запроса" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Сохранить запрос", exact: true })
      .click();
    await expect(
      page.getByLabel(/^Ключевые слова или ссылка на профиль/),
    ).toHaveValue(expected + ' AND "lead"');
    await page
      .getByLabel(/^Ключевые слова или ссылка на профиль/)
      .fill(expected);
    await page
      .getByLabel("Название кампании", { exact: true })
      .fill("Workspace search fixture");
    await page
      .getByRole("button", { name: "Создать кампанию", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Workspace search fixture",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Сохранить шаблон", exact: true })
      .click();
    await page
      .getByLabel("Название шаблона", { exact: true })
      .fill("Driver recruiting fixture");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Сохранить шаблон", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Все кампании", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Создать из шаблона", exact: true })
      .click();
    await page
      .getByLabel("Шаблон", { exact: true })
      .selectOption({ label: "Driver recruiting fixture" });
    await page
      .getByLabel("Название новой кампании", { exact: true })
      .fill("Fresh draft fixture");
    await page
      .getByRole("button", { name: "Создать черновик", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Fresh draft fixture", exact: true }),
    ).toBeVisible();
    const detail = await page.evaluate(
      async () => {
        const state = await window.booster.command("state");
        const c = state.campaigns.find((c) => c.name === "Fresh draft fixture");
        return window.booster.command("campaign.detail", { id: c.id });
      },
      undefined,
      undefined,
      false,
    );
    assert.equal(detail.candidates.length, 0);
    assert.equal(detail.outreach.runs.length, 0);
    assert.equal(detail.batches.length, 0);
    assert.equal(detail.campaign.keywords, expected);
    assert.equal(detail.campaign.status, "draft");
    await page.getByRole("button", { name: "Отправка", exact: true }).click();
    await page
      .getByRole("button", { name: /Тексты/ })
      .first()
      .click();
    await page
      .getByLabel("Сообщение · Open to Work", { exact: true })
      .fill("Unsaved local draft fixture");
    assert.notEqual(
      await page.evaluate(() =>
        localStorage.getItem("booster.automation-drafts.v1"),
      ),
      null,
    );
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const backupRow = page
      .locator(".backup-list li")
      .filter({ has: page.locator(`button`) });
    // Choose the exact pre-campaign copy by matching its position in the backend list.
    const backupPosition = await page.evaluate(
      async (id) =>
        (await window.booster.command("backup.list")).backups.findIndex(
          (b) => b.id === id,
        ),
      backupId,
      undefined,
      false,
    );
    await backupRow
      .nth(backupPosition)
      .getByRole("button", { name: "Восстановить", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Подтверждение восстановления" })
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    await expect(
      page.getByRole("group", { name: "Подтверждение восстановления" }),
    ).toHaveCount(0);
    await backupRow
      .nth(backupPosition)
      .getByRole("button", { name: "Восстановить", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Подтвердить восстановление", exact: true })
      .click();
    await expect(page.getByText(/Данные восстановлены/)).toBeVisible();
    await page.getByRole("button", { name: /^Кампании/ }).click();
    await expect(
      page.getByRole("heading", { name: "Ваши кампании", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Fresh draft fixture", { exact: true }),
    ).toHaveCount(0);
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("booster.automation-drafts.v1"),
      ),
      null,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 700),
    );
    if (process.env.BOOSTER_UI_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.BOOSTER_UI_ARTIFACT_DIR, { recursive: true });
      await page.getByRole("button", { name: /^Требует внимания/ }).click();
      await page.screenshot({
        path: path.join(
          process.env.BOOSTER_UI_ARTIFACT_DIR,
          "workspace-attention-1000.png",
        ),
        fullPage: true,
      });
      await page.getByRole("button", { name: /^Кампании/ }).click();
      await page
        .getByRole("button", { name: "Новая кампания", exact: true })
        .click();
      await page.screenshot({
        path: path.join(
          process.env.BOOSTER_UI_ARTIFACT_DIR,
          "workspace-search-builder-1000.png",
        ),
        fullPage: true,
      });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(await app.evaluate(() => global.__workspaceBlocked), []);
    console.log(
      "PASS: attention navigation/read persistence, Boolean search builder, saved template to fresh unapproved draft; no LinkedIn actions.",
    );
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
