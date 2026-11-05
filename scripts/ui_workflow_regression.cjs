// Real Electron regressions against synthetic local data. Never contacts LinkedIn.
// BOOSTER_EXECUTABLE exercises the packaged app with the same assertions.
const { _electron: electron, expect } =
  require("./patchright_test_driver.cjs").loadPatchright();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

(async () => {
  const root = path.resolve(__dirname, "..");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "booster-ui-workflow-"));
  const artifacts = process.env.BOOSTER_UI_ARTIFACT_DIR
    ? path.resolve(process.env.BOOSTER_UI_ARTIFACT_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), "booster-ui-workflow-artifacts-"));
  fs.mkdirSync(artifacts, { recursive: true });
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  const env = { ...process.env, BOOSTER_DATA_DIR: data };
  if (!process.env.BOOSTER_EXECUTABLE)
    env.PYTHONPATH = path.join(root, "backend");
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  let page;
  let passed = false;
  const rendererErrors = [];
  const checks = [];

  const start = async () => {
    app = await electron.launch({
      ...(process.env.BOOSTER_EXECUTABLE
        ? { executablePath: process.env.BOOSTER_EXECUTABLE, args: [] }
        : { args: [root] }),
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => rendererErrors.push(error.message));
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("command");
      if (typeof original !== "function")
        throw Error("Cannot install the local-only regression guard.");
      // Deny by default, including future operations. These commands only
      // read/change local fixtures; approval, resume, login, search and checks
      // that could open LinkedIn are deliberately absent.
      const local = new Set([
        "state",
        "workspace.summary",
        "backup.list",
        "campaign.detail",
        "campaign.create",
        "campaign.automation",
        "campaign.templates",
        "campaign.save_automation",
        "candidate.review",
        "candidate.select_many",
        "candidate.suppress",
        "outreach.preview",
      ]);
      global.__uiWorkflowBlocked = [];
      ipcMain.removeHandler("command");
      ipcMain.handle("command", async (event, operation, params) => {
        if (!local.has(operation)) {
          global.__uiWorkflowBlocked.push(operation);
          throw Error(
            `External/job operation blocked by UI test: ${operation}`,
          );
        }
        if (operation === "outreach.preview") {
          const detail = await original(event, "campaign.detail", {
            id: params.id,
          });
          if (detail.outreach.rules.inmail_channel === "recruiter") {
            global.__uiWorkflowBlocked.push("recruiter preview");
            throw Error("Recruiter preview is blocked by the local-only test.");
          }
        }
        if (operation === "campaign.save_automation")
          global.__uiWorkflowLastSavedRules = structuredClone(params.rules);
        const result = await original(event, operation, params);
        if (operation === "campaign.detail") {
          // Read-only response fixture for the real dialog's long-source layout.
          const sample = result.candidates.find(
            (person) => person.data.name === "Sam Taylor",
          );
          if (sample)
            sample.data.sections = {
              ...sample.data.sections,
              main_profile:
                "Synthetic long profile text for layout acceptance. ".repeat(
                  150,
                ),
            };
        }
        if (
          operation === "outreach.preview" &&
          global.__uiWorkflowDelayPreview
        ) {
          global.__uiWorkflowDelayPreview = false;
          await new Promise((resolve) => {
            global.__uiWorkflowReleasePreview = resolve;
          });
          global.__uiWorkflowReleasePreview = null;
        }
        return result;
      });
      ipcMain.removeHandler("open-profile");
      ipcMain.handle("open-profile", () => {
        global.__uiWorkflowBlocked.push("external profile");
        throw Error("External navigation is blocked by the UI test.");
      });
    });
    await expect(
      page.getByRole("heading", { name: "Ваши кампании", exact: true }),
    ).toBeVisible({ timeout: 30000 });
  };
  const stop = async () => {
    if (!app) return;
    assert.deepEqual(
      await app.evaluate(() => global.__uiWorkflowBlocked),
      [],
      "The test attempted an external/job-producing operation.",
    );
    const current = app;
    app = null;
    await current.close();
  };
  const openCampaign = async (name) => {
    await page.getByRole("button", { name: /^Кампании/ }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  };
  const detail = (name) =>
    // The preload bridge is exposed in the app's main world. Patchright
    // evaluates in an isolated world by default; ordinary DOM checks keep it.
    page.evaluate(
      async (campaignName) => {
        const state = await window.booster.command("state");
        const campaign = state.campaigns.find(
          (item) => item.name === campaignName,
        );
        if (!campaign) throw Error("Synthetic campaign not found.");
        return window.booster.command("campaign.detail", { id: campaign.id });
      },
      name,
      undefined,
      false,
    );
  const messages = async () => {
    await page.getByRole("button", { name: "Отправка", exact: true }).click();
    await page
      .getByRole("button", { name: "Далее: сообщения", exact: true })
      .click();
  };
  const record = (name) => {
    checks.push(name);
    console.log(`PASS: ${name}`);
  };
  const screenshots = async (name) => {
    if (!process.env.BOOSTER_UI_ARTIFACT_DIR) return;
    for (const width of [1001, 1380]) {
      await app.evaluate(
        ({ BrowserWindow }, value) =>
          BrowserWindow.getAllWindows()[0].setSize(value, 920),
        width,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(artifacts, `${name}-${width}.png`),
      });
    }
  };

  try {
    // Existing fixtures create only fictional profiles and paused plans, using
    // Store directly before the app/backend worker is started.
    execFileSync(python, [path.join(root, "scripts/ui_fixtures.py"), data], {
      cwd: root,
      env: { ...process.env, PYTHONPATH: path.join(root, "backend") },
    });
    await start();

    await page.getByRole("button", { name: "Аккаунты", exact: true }).click();
    const addAccount = page.getByRole("button", { name: "Добавить аккаунт" });
    await addAccount.click();
    await expect(page.getByLabel("Название аккаунта")).toBeFocused();
    await page.getByLabel("Название аккаунта").fill("   ");
    await expect(
      page.getByRole("button", { name: "Открыть вход" }),
    ).toBeDisabled();
    assert.equal(
      await page.evaluate(() => {
        const background = [
          ...document.querySelectorAll(".sidebar button"),
        ].find((item) => item.textContent === "Аккаунты");
        background.focus();
        return (
          Boolean(background.closest("[inert]")) &&
          document
            .querySelector('[role="dialog"]')
            .contains(document.activeElement)
        );
      }),
      true,
      "Modal background must be inert and reject focus.",
    );
    await page.getByRole("button", { name: "Закрыть", exact: true }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Отмена", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Закрыть", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(addAccount).toBeFocused();
    record(
      "modal first focus, keyboard wrap, inert background and return focus",
    );

    await page.getByRole("button", { name: /^Кампании/ }).click();
    const addCampaign = page.getByRole("button", {
      name: "Новая кампания",
      exact: true,
    });
    await addCampaign.click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 700),
    );
    const nameField = page.getByLabel(/^Название кампании/);
    await expect(nameField).toBeFocused();
    await nameField.fill("");
    await page
      .getByRole("button", { name: "Создать кампанию", exact: true })
      .click();
    await expect(
      page.getByText("Введите название кампании.", { exact: true }),
    ).toBeVisible();
    await expect(nameField).toBeFocused();
    assert.equal(
      await page.getByRole("dialog").evaluate((dialog) => {
        const outer = dialog.getBoundingClientRect();
        return [...dialog.querySelectorAll(".modal-footer button")].every(
          (button) =>
            button.getBoundingClientRect().bottom <=
            Math.min(innerHeight, outer.bottom) + 1,
        );
      }),
      true,
      "Form validation must retain fully visible actions at the minimum window size.",
    );
    await nameField.fill("   ");
    await page
      .getByRole("button", { name: "Запрос или ссылка", exact: true })
      .click();
    await page.getByLabel(/^Ключевые слова или ссылка на профиль/).fill("   ");
    await page.getByLabel(/^Сколько профилей собрать/).fill("1.5");
    await page
      .getByRole("button", { name: "Создать кампанию", exact: true })
      .click();
    await expect(
      page.getByText("Укажите целое число от 1 до 100.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Введите название кампании.", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(addCampaign).toBeFocused();
    record(
      "Russian form validation rejects empty, whitespace and fractional limits",
    );

    const demo = "Head of Recruitment · пример";
    await openCampaign(demo);
    await page.getByLabel("Группа Sam Taylor").selectOption("review");
    await expect(page.getByLabel("Выбрать Sam Taylor")).toBeDisabled();
    await page.getByLabel("Группа кандидатов").selectOption("neutral");
    await page
      .getByRole("button", { name: "Выбрать доступных", exact: true })
      .click();
    await expect(page.getByLabel("Выбрать Jamie Reed")).toBeChecked();
    await page.getByLabel("Группа кандидатов").selectOption("all");
    await expect(page.getByLabel("Выбрать Alex Morgan")).not.toBeChecked();
    await expect(page.getByLabel("Выбрать Sam Taylor")).not.toBeChecked();
    await page
      .getByRole("button", { name: "Снять выбор", exact: true })
      .click();
    await expect(page.getByLabel("Выбрать Jamie Reed")).not.toBeChecked();
    await page.getByLabel("Группа Sam Taylor").selectOption("neutral");
    await expect(page.getByLabel("Выбрать Sam Taylor")).toBeEnabled();
    await page
      .getByRole("button", { name: "Выбрать доступных", exact: true })
      .click();
    for (const person of ["Alex Morgan", "Sam Taylor", "Jamie Reed"])
      await expect(page.getByLabel(`Выбрать ${person}`)).toBeChecked();
    record(
      "bulk selection respects the visible filter and recipient eligibility",
    );
    await screenshots("candidates");

    await page.getByRole("button", { name: "Отправка", exact: true }).click();
    await page
      .locator("summary")
      .filter({ hasText: "Приглашения в контакты" })
      .click();
    const invitation = page.getByLabel("Текст приглашения · необязательно");
    await invitation.fill("A".repeat(201));
    await expect(invitation).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#invitation-feedback")).toContainText("200");
    await page
      .getByRole("button", { name: "Далее: сообщения", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Посмотреть перед запуском",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(page.locator(".setup-validation")).toContainText(
      "Текст приглашения",
    );
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    const invitationDetails = page.locator("details").filter({
      has: page
        .locator("summary")
        .filter({ hasText: "Приглашения в контакты" }),
    });
    if (!(await invitationDetails.evaluate((element) => element.open)))
      await invitationDetails.locator("summary").click();
    await invitation.fill("");
    await page.getByRole("button", { name: "Кандидаты", exact: true }).click();
    record(
      "overlong invitation is explained beside its field and cannot be previewed",
    );

    await page.getByRole("button", { name: /Jamie Reed/ }).click();
    await page
      .getByRole("button", { name: "Не контактировать", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("со всех аккаунтов");
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Не контактировать", exact: true }),
    ).toBeEnabled();
    assert.equal(
      (await detail(demo)).candidates.find((p) => p.data.name === "Jamie Reed")
        .blocked,
      false,
    );
    await page
      .getByRole("button", { name: "Не контактировать", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Исключить во всех кампаниях", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Выбрать Jamie Reed")).toBeDisabled();
    await expect(page.getByLabel("Выбрать Jamie Reed")).not.toBeChecked();
    record(
      "suppression explains global scope, cancels safely and excludes after confirmation",
    );

    await app.evaluate(({ dialog }) => {
      global.__uiWorkflowSaveDialog = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => {
        throw Error("Synthetic save-dialog failure");
      };
    });
    await page.getByRole("button", { name: "Excel", exact: true }).click();
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(page.getByRole("alert")).toHaveText(
      "Synthetic save-dialog failure",
    );
    await page.getByRole("button", { name: /Sam Taylor/ }).click();
    await expect(
      page.getByRole("dialog").locator("header button"),
    ).toBeFocused();
    assert.equal(
      await page
        .locator(".modal-body")
        .evaluate((element) => element.scrollTop),
      0,
      "Read-only profile dialogs must initially show their beginning.",
    );
    assert.equal(
      await page.getByRole("dialog").evaluate((dialog) => {
        const outer = dialog.getBoundingClientRect();
        return [...dialog.querySelectorAll(".modal-footer button")].every(
          (button) =>
            button.getBoundingClientRect().bottom <=
            Math.min(innerHeight, outer.bottom) + 1,
        );
      }),
      true,
      "Long profile actions must fit the minimum window height.",
    );
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = global.__uiWorkflowSaveDialog;
    });
    record(
      "clean visible export error does not steal focus from the next same-page dialog",
    );

    const paused = "История · автоматизация";
    await openCampaign(paused);
    const originalPlan = (await detail(paused)).outreach.runs.find(
      (run) => run.status === "paused",
    );
    assert.ok(originalPlan, "Fixture must contain a paused approved plan.");
    await expect(page.getByLabel("Выбрать Jordan Lee")).toBeDisabled();
    await page.getByRole("button", { name: /Casey Rowan/ }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Группа сообщения")
      .selectOption("open");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "Изменить утверждённую кампанию?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Оставить текущий план", exact: true })
      .click();
    const personDialog = page.getByRole("dialog", {
      name: "Casey Rowan",
      exact: true,
    });
    await expect(personDialog).toBeVisible();
    await expect(personDialog.getByLabel("Группа сообщения")).toHaveValue(
      "neutral",
    );
    await expect(personDialog.getByLabel("Группа сообщения")).toBeFocused();
    assert.equal(
      await page.locator(".app > main").evaluate((element) => element.inert),
      true,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    record(
      "candidate change confirmation replaces the dialog and restores its focus on cancel",
    );
    await page.getByLabel("Выбрать Casey Rowan").click();
    await expect(
      page.getByRole("dialog", { name: "Изменить утверждённую кампанию?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Оставить текущий план", exact: true })
      .click();
    await expect(page.getByLabel("Выбрать Casey Rowan")).toBeChecked();
    assert.equal(
      (await detail(paused)).outreach.runs.find(
        (run) => run.id === originalPlan.id,
      ).status,
      "paused",
    );
    await page.getByRole("button", { name: "Отправка", exact: true }).click();
    await page
      .getByRole("button", { name: "Изменить настройки кампании", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Далее: сообщения", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Посмотреть перед запуском", exact: true })
      .click();
    const preview = page.getByRole("dialog", {
      name: "Перед запуском",
      exact: true,
    });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("Текущий утверждённый план сохранён");
    await screenshots("preview");
    await preview.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(preview.locator("details")).toHaveAttribute("open", "");
    for (const width of [1000, 1001, 1380]) {
      await app.evaluate(
        ({ BrowserWindow }, w) =>
          BrowserWindow.getAllWindows()[0].setSize(w, 700),
        width,
      );
      const footerFits = await preview.evaluate((dialog) => {
        const outer = dialog.getBoundingClientRect();
        return [...dialog.querySelectorAll(".modal-footer button")].every(
          (button) => {
            const box = button.getBoundingClientRect();
            return (
              box.top >= outer.top &&
              box.bottom <= Math.min(outer.bottom, innerHeight) + 1 &&
              box.right <= outer.right + 1
            );
          },
        );
      });
      assert.ok(
        footerFits,
        "Preview actions must remain fully visible with the schedule expanded at minimum window height.",
      );
    }
    await preview.locator("summary").focus();
    await page.keyboard.press("Space");
    await expect(preview.locator("details")).not.toHaveAttribute("open", "");
    await page
      .getByRole("button", { name: "Вернуться к настройкам", exact: true })
      .click();
    assert.equal(
      (await detail(paused)).outreach.runs.find(
        (run) => run.id === originalPlan.id,
      ).status,
      "paused",
    );
    await expect(
      page.getByRole("heading", { name: "Кампания на паузе", exact: true }),
    ).toBeVisible();
    const savedNeutral = (await detail(paused)).campaign.template_neutral;
    await page
      .getByLabel("Сообщение · нейтральное", { exact: true })
      .fill("Changed local draft");
    await page
      .getByRole("button", { name: "Сохранить без запуска", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Изменить утверждённую кампанию?" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    const unchanged = await detail(paused);
    assert.equal(unchanged.campaign.template_neutral, savedNeutral);
    assert.equal(
      unchanged.outreach.runs.find((run) => run.id === originalPlan.id).status,
      "paused",
    );
    record(
      "cancelled changes and unchanged preview preserve the approved paused plan",
    );

    await openCampaign(demo);
    await messages();
    await app.evaluate(() => {
      global.__uiWorkflowDelayPreview = true;
    });
    await page
      .getByRole("button", { name: "Посмотреть перед запуском", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => typeof global.__uiWorkflowReleasePreview))
      .toBe("function");
    await page.getByRole("button", { name: "Аккаунты", exact: true }).click();
    await page
      .getByRole("button", { name: "Добавить аккаунт", exact: true })
      .click();
    await page.getByLabel("Название аккаунта").fill("Unsubmitted local form");
    await app.evaluate(() => global.__uiWorkflowReleasePreview());
    // This becomes enabled only after the original preview finishes and clears
    // busy state, so the absence assertion cannot pass before its completion.
    await expect(
      page.getByRole("button", { name: "Открыть вход" }),
    ).toBeEnabled();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "Подключить LinkedIn" }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Перед запуском" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    record("late local preview cannot open over another screen or dialog");

    await openCampaign(demo);
    await messages();
    const durableText =
      "Local draft survives both renderer reload and complete app restart.";
    await page
      .getByLabel("Сообщение · Open to Work", { exact: true })
      .fill(durableText);
    for (const width of [1001, 1100]) {
      await app.evaluate(
        ({ BrowserWindow }, value) =>
          BrowserWindow.getAllWindows()[0].setSize(value, 800),
        width,
      );
      await expect
        .poll(() =>
          page.locator(".save-indicator").evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const parent = element.parentElement.getBoundingClientRect();
            return (
              element.scrollWidth <= element.clientWidth + 1 &&
              bounds.right <= parent.right + 1
            );
          }),
        )
        .toBe(true);
    }
    record("durable-draft status wraps within the narrow plan card");
    await screenshots("messages");
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem("booster.automation-drafts.v1"),
        ),
      )
      .toContain(durableText);
    // Simulate the last-version draft saved before an application update.
    // Both fingerprints and edited rules used to contain quota fields.
    const demoId = (await detail(demo)).campaign.id;
    await page.evaluate((id) => {
      const key = "booster.automation-drafts.v1";
      const drafts = JSON.parse(localStorage.getItem(key));
      const oldQuotas = {
        daily_invites: 10,
        daily_messages: 20,
        daily_inmails: 5,
        inmail_budget: 0,
      };
      drafts[id].baseRules = JSON.stringify({
        ...JSON.parse(drafts[id].baseRules),
        ...oldQuotas,
      });
      drafts[id].rules = { ...drafts[id].rules, ...oldQuotas };
      localStorage.setItem(key, JSON.stringify(drafts));
    }, demoId);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Ваши кампании", exact: true }),
    ).toBeVisible();
    await openCampaign(demo);
    await messages();
    await expect(
      page.getByLabel("Сообщение · Open to Work", { exact: true }),
    ).toHaveValue(durableText);
    await stop();
    await start();
    await openCampaign(demo);
    await messages();
    await expect(
      page.getByLabel("Сообщение · Open to Work", { exact: true }),
    ).toHaveValue(durableText);
    record(
      "unsaved legacy draft survives quota removal, renderer reload and full process restart",
    );
    await page
      .getByRole("button", { name: "Сохранить без запуска", exact: true })
      .click();
    await expect
      .poll(async () => (await detail(demo)).campaign.template_open)
      .toBe(durableText);
    const sentRules = await app.evaluate(
      () => global.__uiWorkflowLastSavedRules,
    );
    assert.ok(
      sentRules,
      "The restored draft must be saved through the real UI.",
    );
    for (const field of [
      "daily_invites",
      "daily_messages",
      "daily_inmails",
      "inmail_budget",
    ])
      assert.equal(Object.hasOwn(sentRules, field), false);
    record("saving a restored legacy draft never submits retired quota fields");

    await page.getByRole("button", { name: /^Кампании/ }).click();
    await page
      .getByRole("button", { name: "Новая кампания", exact: true })
      .click();
    const longName = "W".repeat(150);
    await page.getByLabel(/^Название кампании/).fill(longName);
    await page
      .getByRole("button", { name: "Запрос или ссылка", exact: true })
      .click();
    await page
      .getByLabel(/^Ключевые слова или ссылка на профиль/)
      .fill("https://www.linkedin.com/in/" + "auditsynthetic".repeat(35));
    await page
      .getByRole("button", { name: "Создать кампанию", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: longName, exact: true }),
    ).toBeVisible();
    for (const width of [1000, 1001, 1100, 1380]) {
      await app.evaluate(
        ({ BrowserWindow }, value) =>
          BrowserWindow.getAllWindows()[0].setSize(value, 800),
        width,
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      const bounds = await page
        .getByRole("button", { name: "Найти кандидатов", exact: true })
        .boundingBox();
      const viewportWidth = await page.evaluate(() => innerWidth);
      assert.ok(
        bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewportWidth + 1,
        "Search action must remain horizontally reachable.",
      );
    }
    record(
      "long campaign name and profile URL fit minimum and intermediate window widths",
    );
    await page
      .getByRole("button", { name: "Все кампании", exact: true })
      .click();
    for (const width of [1000, 1001]) {
      await app.evaluate(
        ({ BrowserWindow }, value) =>
          BrowserWindow.getAllWindows()[0].setSize(value, 800),
        width,
      );
      assert.equal(
        await page.locator("table").evaluate((table) => {
          const panel = table.closest(".panel");
          const right = panel.getBoundingClientRect().right;
          if (table.getBoundingClientRect().right <= right + 1) return true;
          for (
            let ancestor = table.parentElement;
            ancestor && ancestor !== panel.parentElement;
            ancestor = ancestor.parentElement
          ) {
            if (
              ["auto", "scroll"].includes(getComputedStyle(ancestor).overflowX)
            ) {
              ancestor.scrollLeft = ancestor.scrollWidth;
              return (
                table.querySelector("th:last-child").getBoundingClientRect()
                  .right <=
                right + 1
              );
            }
          }
          return false;
        }),
        true,
        "Every home-table column must fit or be reachable by horizontal scrolling.",
      );
    }
    await screenshots("campaign-list-long-content");
    record(
      "long-content campaign list keeps its status and last column reachable",
    );
    // Mock only the desktop-preferences IPC. This never touches OS login items
    // and uses no real user settings. Product renderer and all other APIs remain real.
    await app.evaluate(({ ipcMain }) => {
      global.__uiSettings = {
        mode: "ok",
        value: {
          background: false,
          autoStart: false,
          packaged: true,
          autoStartNote:
            "Автозапуск требует разрешения в macOS. Разрешите его в системных настройках.",
        },
        writes: 0,
      };
      ipcMain.removeHandler("desktop-settings");
      ipcMain.handle("desktop-settings", async (_event, patch) => {
        const fixture = global.__uiSettings;
        if (patch?.autoStart !== undefined)
          throw Error("OS login-item changes are forbidden in UI regressions.");
        if (patch) fixture.writes++;
        if (fixture.mode === "loading" || fixture.mode === "saving")
          await new Promise((resolve) => {
            fixture.release = resolve;
          });
        if (
          fixture.mode === "load-error" ||
          (patch && fixture.mode === "save-error")
        )
          throw Error("Synthetic settings storage failure");
        fixture.value = { ...fixture.value, ...patch };
        return fixture.value;
      });
    });
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const background = page.getByRole("checkbox", {
      name: "Продолжать работу после закрытия окна",
      exact: true,
    });
    await expect(background).toBeVisible();
    await expect(
      page.getByText(
        "Автозапуск требует разрешения в macOS. Разрешите его в системных настройках.",
        { exact: true },
      ),
    ).toBeVisible();
    for (const width of [1000, 1001, 1380, 1600]) {
      await app.evaluate(
        ({ BrowserWindow }, w) =>
          BrowserWindow.getAllWindows()[0].setSize(w, 920),
        width,
      );
      const metrics = await page.evaluate(() => {
        const children = [
          ...document.querySelector(".settings-layout").children,
        ].map((e) => e.getBoundingClientRect().toJSON());
        const insets = [
          ...document.querySelectorAll(".preferences-card,.settings-card"),
        ].map((e) => {
          const outer = e.getBoundingClientRect(),
            title = e.querySelector("h2").getBoundingClientRect();
          return { left: title.left - outer.left, top: title.top - outer.top };
        });
        return {
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          children,
          insets,
        };
      });
      assert.ok(
        metrics.scroll <= metrics.width + 1,
        "Settings must not overflow horizontally.",
      );
      assert.ok(
        metrics.children.every(
          (e) => Math.abs(e.width - metrics.children[0].width) < 1,
        ),
        "Settings sections must share one aligned width.",
      );
      assert.ok(
        metrics.children
          .slice(1)
          .every((e, i) => e.top - metrics.children[i].bottom >= 16),
        "Settings sections need a visible gap.",
      );
      assert.ok(
        metrics.insets.every((e) => e.left >= 16 && e.top >= 16),
        "Every settings card needs actual content padding.",
      );
    }
    await background.focus();
    await page.keyboard.press("Space");
    await expect(background).toBeChecked();
    await expect(
      page.getByRole("status").filter({ hasText: "Настройки сохранены." }),
    ).toBeVisible();
    const mcp = page.locator(".settings-disclosure > summary");
    await mcp.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", {
        name: "Показать настройки подключения",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Настройки MCP", { exact: true }),
    ).toBeVisible();
    await mcp.focus();
    await page.keyboard.press("Space");
    await expect(
      page.getByLabel("Настройки MCP", { exact: true }),
    ).not.toBeVisible();
    record(
      "settings cards align with padding and gaps at four widths; switch and optional MCP disclosure work by keyboard",
    );
    await app.evaluate(() => {
      global.__uiSettings.mode = "saving";
    });
    await background.uncheck();
    await expect(background).toBeDisabled();
    await expect(
      page.getByRole("status").filter({ hasText: "Сохраняем настройку…" }),
    ).toBeVisible();
    await app.evaluate(() => {
      global.__uiSettings.mode = "ok";
      global.__uiSettings.release();
    });
    await expect(background).toBeEnabled();
    await expect(background).not.toBeChecked();
    await app.evaluate(() => {
      global.__uiSettings.mode = "save-error";
    });
    // This write must roll back; check() incorrectly requires a lasting checked
    // state and can fail before the assertions when rejection returns quickly.
    await background.click();
    await expect(page.getByRole("alert")).toContainText(
      "Не удалось подтвердить сохранение",
    );
    await expect(background).not.toBeChecked();
    await app.evaluate(() => {
      global.__uiSettings.mode = "ok";
    });
    await page
      .getByRole("button", { name: "Обновить настройки", exact: true })
      .click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: /^Кампании/ }).click();
    await app.evaluate(() => {
      global.__uiSettings.mode = "load-error";
    });
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Не удалось загрузить настройки",
    );
    await app.evaluate(() => {
      global.__uiSettings.mode = "loading";
    });
    await page
      .getByRole("button", { name: "Попробовать ещё раз", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Загружаем настройки…" }),
    ).toBeVisible();
    await app.evaluate(() => {
      global.__uiSettings.mode = "ok";
      global.__uiSettings.release();
    });
    await expect(background).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    assert.equal(
      await app.evaluate(() => global.__uiSettings.writes),
      3,
      "Only the three intentional background preference changes should reach storage.",
    );
    record(
      "settings display OS approval note, disable pending saves, roll back failed writes, and recover load errors with retry",
    );
    await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("command");
      global.__uiLoadFault = { mode: "state-error" };
      ipcMain.removeHandler("command");
      ipcMain.handle("command", async (event, operation, params) => {
        const fixture = global.__uiLoadFault;
        if (operation === "state" && fixture.mode === "state-loading")
          await new Promise((resolve) => {
            fixture.release = resolve;
          });
        if (operation === "state" && fixture.mode === "state-error")
          throw Error("Synthetic initial state read failure");
        if (operation === "campaign.detail" && fixture.mode === "detail-error")
          throw Error("Synthetic campaign read failure");
        return original(event, operation, params);
      });
    });
    await page.reload();
    await expect(
      page.getByRole("heading", {
        name: "Не удалось открыть рабочее пространство",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ваши кампании", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Подключить LinkedIn", exact: true }),
    ).toHaveCount(0);
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "state-loading";
    });
    await page
      .getByRole("button", { name: "Попробовать ещё раз", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Загружаем…", exact: true }),
    ).toBeDisabled();
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "ok";
      global.__uiLoadFault.release();
    });
    await expect(
      page.getByRole("heading", { name: "Ваши кампании", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: demo, exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "state-error";
    });
    await expect(
      page.getByRole("button", { name: "Обновить данные", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("button", { name: demo, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Не удалось обновить данные. Показана последняя загруженная версия.",
        { exact: true },
      ),
    ).toBeVisible();
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "ok";
    });
    await page
      .getByRole("button", { name: "Обновить данные", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Обновить данные", exact: true }),
    ).toHaveCount(0);
    record(
      "initial state failure has a dedicated retry screen and never pretends saved campaigns are absent",
    );
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "detail-error";
    });
    await page.getByRole("button", { name: demo, exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Не удалось открыть кампанию",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".spinner")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Все кампании", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Ваши кампании", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: demo, exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Не удалось открыть кампанию",
        exact: true,
      }),
    ).toBeVisible();
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "ok";
    });
    await page
      .getByRole("button", { name: "Попробовать ещё раз", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: demo, exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "detail-error";
    });
    await expect(
      page.getByRole("button", { name: "Обновить данные", exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole("heading", { name: demo, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Sam Taylor/ }),
    ).toBeVisible();
    await app.evaluate(() => {
      global.__uiLoadFault.mode = "ok";
    });
    await page
      .getByRole("button", { name: "Обновить данные", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Обновить данные", exact: true }),
    ).toHaveCount(0);
    record(
      "campaign read failure stops the spinner and provides working back and retry actions",
    );
    assert.deepEqual(rendererErrors, [], "Unexpected renderer errors.");
    await stop();
    passed = true;
    console.log(
      `PASS: ${checks.length} workflow regression groups; no LinkedIn access or approved sends.`,
    );
  } catch (error) {
    if (page && !page.isClosed())
      await page
        .screenshot({
          path: path.join(artifacts, "failure.png"),
          fullPage: true,
        })
        .catch(() => {});
    fs.writeFileSync(
      path.join(artifacts, "completed-checks.json"),
      JSON.stringify(checks, null, 2),
    );
    console.error(`Workflow regression evidence: ${artifacts}`);
    throw error;
  } finally {
    if (app) await app.close();
    fs.rmSync(data, { recursive: true, force: true });
    if (passed && !process.env.BOOSTER_UI_ARTIFACT_DIR)
      fs.rmSync(artifacts, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
