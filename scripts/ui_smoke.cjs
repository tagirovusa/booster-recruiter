const { _electron: electron, expect } =
  require("./patchright_test_driver.cjs").loadPatchright();
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "..");
  const artifacts = process.env.BOOSTER_UI_ARTIFACT_DIR
    ? path.resolve(process.env.BOOSTER_UI_ARTIFACT_DIR)
    : path.join(root, "..");
  fs.mkdirSync(artifacts, { recursive: true });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "booster-ui-"));
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
  try {
    const page = await app.firstWindow();
    const captureNarrow = async (name) => {
      if (!process.env.BOOSTER_UI_ARTIFACT_DIR) return;
      const size = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const old = window.getSize();
        window.setSize(1000, 700);
        return old;
      });
      await page.screenshot({
        path: path.join(artifacts, `${name}-1000.png`),
      });
      if (!name.includes("confirmation"))
        await page.screenshot({
          path: path.join(artifacts, `${name}-1000-full.png`),
          fullPage: true,
        });
      await app.evaluate(({ BrowserWindow }, old) => {
        BrowserWindow.getAllWindows()[0].setSize(...old);
      }, size);
    };
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(
      page.getByRole("heading", { name: "Ваши кампании" }),
    ).toBeVisible({ timeout: 30000 });
    await page
      .getByText("Head of Recruitment · пример", { exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Head of Recruitment · пример" }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Выбрать Sam Taylor" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("combobox", { name: "Группа Sam Taylor" }),
    ).toHaveValue("neutral");
    await expect(
      page.getByRole("combobox", { name: "Группа Jamie Reed" }),
    ).toHaveValue("neutral");
    await page.getByRole("checkbox", { name: "Выбрать Alex Morgan" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Выбрать Alex Morgan" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Настроить отправку (1)" }).click();
    await expect(
      page.getByRole("heading", { name: "Как связаться" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Приглашений", { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByLabel("Текст приглашения · необязательно"),
    ).not.toBeVisible();
    await page.getByRole("button", { name: "Далее: сообщения" }).click();
    await page
      .getByRole("button", { name: "Посмотреть перед запуском", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Перед запуском" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Hi Alex, I noticed you are open to opportunities. Let us discuss a remote recruitment role.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Вернуться к настройкам" }).click();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "Способ связи" })
      .getByText("Экономить кредиты", { exact: true })
      .click();
    await expect(
      page.getByRole("radio", { name: /Экономить кредиты/ }),
    ).toBeChecked();
    // Even expanded settings must not expose application quotas. The selected
    // recipients and the explicit InMail mode define the approved scope.
    const advanced = page.locator("details.advanced-settings");
    await advanced.locator("summary").click();
    await expect(
      page.getByLabel("Проверять контакты каждые · ч"),
    ).toBeVisible();
    await expect(page.getByLabel("Следить за ответами · дней")).toBeVisible();
    for (const label of [
      "Приглашений",
      "Сообщений",
      "InMail",
      "Бюджет InMail · кредитов",
    ])
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Дневные ограничения", { exact: true }),
    ).toHaveCount(0);
    await captureNarrow("inmail-setup-expanded");
    await advanced.locator("summary").click();
    await page.getByLabel("Подписка для InMail").selectOption("recruiter");
    await expect(
      page.getByRole("button", { name: "Открыть аккаунты", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Далее: сообщения" }).click();
    await expect(
      page.getByRole("button", {
        name: "Посмотреть перед запуском",
        exact: true,
      }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByLabel("Подписка для InMail").selectOption("linkedin");
    const invitations = page.locator("details").filter({
      has: page
        .locator("summary")
        .getByText("Приглашения в контакты", { exact: true }),
    });
    await invitations.locator("summary").click();
    await page
      .getByLabel("Текст приглашения · необязательно")
      .fill("Hi {first_name}, let us connect.");
    await invitations.locator("summary").click();
    await page
      .getByRole("button", { name: "Сохранить настройки", exact: true })
      .click();
    await expect(
      page.locator(".save-indicator").getByText("Сохранено", { exact: true }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "booster-recruiter-automation-preview.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Далее: сообщения" }).click();
    await expect(
      page.getByRole("button", {
        name: "Посмотреть перед запуском",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByLabel("Тема InMail · Open to Work")
      .fill("Recruitment opportunity");
    await page
      .getByLabel("Тема InMail · нейтральное")
      .fill("Recruitment leadership");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(artifacts, "booster-recruiter-messages-preview.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Посмотреть перед запуском", exact: true })
      .click();
    await expect(
      page.getByText("Hi Alex, let us connect.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("InMail · Recruitment opportunity", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Максимальный расход InMail: 1 кредит.", {
        exact: true,
      }),
    ).toBeVisible();
    await captureNarrow("inmail-confirmation");
    await page.getByRole("button", { name: "Вернуться к настройкам" }).click();
    await page.getByRole("button", { name: "Кандидаты", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Группа Sam Taylor" })
      .selectOption("review");
    await expect(
      page.getByRole("checkbox", { name: "Выбрать Sam Taylor" }),
    ).toBeDisabled();
    await page
      .getByRole("combobox", { name: "Группа Sam Taylor" })
      .selectOption("neutral");
    await expect(
      page.getByRole("checkbox", { name: "Выбрать Sam Taylor" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("checkbox", { name: "Выбрать Alex Morgan" }),
    ).toBeEnabled();
    await page.screenshot({
      path: path.join(artifacts, "booster-recruiter-preview.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Все кампании", exact: true })
      .click();
    await page.getByText("История · без обращений", { exact: true }).click();
    await page.getByRole("button", { name: "История", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "История контактов" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Обращений пока нет" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Список в CSV" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Настроить автоматизацию", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Как связаться" }),
    ).toBeVisible();
    for (const [campaign, outreach, legacy] of [
      ["История · автоматизация", true, false],
      ["История · сообщения", false, true],
      ["История · вместе", true, true],
    ]) {
      await page
        .getByRole("button", { name: "Все кампании", exact: true })
        .click();
      await page.getByText(campaign, { exact: true }).click();
      await page.getByRole("button", { name: "История", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "История контактов" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Обращений пока нет" }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Здесь появится история обработки", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Список в CSV" }),
      ).toBeVisible();
      const automatedHistory = page.getByRole("region", {
        name: "Приглашения и сообщения",
      });
      if (outreach) {
        await expect(automatedHistory).toBeVisible();
        await expect(
          automatedHistory.getByRole("cell", {
            name: "Ждём принятия",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          automatedHistory.getByRole("cell", {
            name: "После возобновления",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          automatedHistory.getByRole("cell", {
            name: "Ответ получен",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          automatedHistory.getByText("Спасибо за сообщение.", { exact: true }),
        ).toBeVisible();
        await automatedHistory
          .locator("summary")
          .filter({ hasText: "Обычное сообщение" })
          .click();
        await expect(
          automatedHistory.locator("pre").filter({ hasText: "Hi Jordan," }),
        ).toBeVisible();
      } else {
        await expect(automatedHistory).toHaveCount(0);
      }
      const oldRecipient = page.getByRole("button", {
        name: "Taylor Parker",
        exact: true,
      });
      if (legacy) {
        await expect(oldRecipient).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Сообщение есть", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Сообщения нет", exact: true }),
        ).toBeVisible();
      } else {
        await expect(oldRecipient).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Другие сообщения" }),
        ).toHaveCount(0);
      }
      if (outreach && legacy) {
        await expect(
          page.getByRole("heading", { name: "Другие сообщения" }),
        ).toBeVisible();
        await page.screenshot({
          path: path.join(artifacts, "booster-recruiter-history-preview.png"),
          fullPage: true,
        });
      }
    }
    await page.getByRole("button", { name: "Аккаунты", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "LinkedIn-аккаунты" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Подключить Recruiter", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Добавить аккаунт" }).click();
    await expect(
      page.getByRole("dialog", { name: "Подключить LinkedIn" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const background = page.getByRole("checkbox", {
      name: "Продолжать работу после закрытия окна",
    });
    // A fresh install keeps campaigns working after the window is closed.
    await expect(background).toBeChecked();
    await background.uncheck();
    await expect(page.getByRole("status")).toHaveText("Настройки сохранены.");
    for (const failSave of [false, true]) {
      await app.evaluate(({ app, dialog }, failSave) => {
        const fs = process.getBuiltinModule("fs");
        const path = process.getBuiltinModule("path");
        const directory = app.getPath("userData");
        if (!path.basename(directory).startsWith("booster-ui-"))
          throw Error("Preference fault injection requires isolated test data");
        const filename = path.join(directory, "desktop-preferences.json");
        const rename = fs.promises.rename;
        const showMessageBox = dialog.showMessageBox;
        const gate = { entered: false, reports: [] };
        const pending = new Promise((resolve) => {
          gate.release = resolve;
        });
        fs.promises.rename = async (...args) => {
          if (path.resolve(args[1]) === filename) {
            gate.entered = true;
            await pending;
            if (failSave) throw Error("Synthetic preferences rename failure");
          }
          return rename(...args);
        };
        dialog.showMessageBox = async (...args) => {
          const options = args.at(-1);
          if (options.title === "Настройки не сохранены") {
            gate.reports.push(options);
            return { response: 0, checkboxChecked: false };
          }
          return showMessageBox(...args);
        };
        gate.restore = () => {
          gate.release();
          fs.promises.rename = rename;
          dialog.showMessageBox = showMessageBox;
          delete globalThis.__boosterPreferenceGate;
        };
        globalThis.__boosterPreferenceGate = gate;
      }, failSave);
      try {
        await background.check();
        await expect(page.getByRole("status")).toHaveText(
          "Сохраняем настройку…",
        );
        await expect
          .poll(() =>
            app.evaluate(() => globalThis.__boosterPreferenceGate.entered),
          )
          .toBe(true);
        if (failSave)
          await page
            .getByRole("button", { name: "Аккаунты", exact: true })
            .click();
        await app.evaluate(({ BrowserWindow }) => {
          const window = BrowserWindow.getAllWindows()[0];
          window.close();
          window.close();
        });
        expect(
          await app.evaluate(({ BrowserWindow }) => ({
            count: BrowserWindow.getAllWindows().length,
            visible: BrowserWindow.getAllWindows()[0]?.isVisible(),
          })),
        ).toEqual({ count: 1, visible: true });
        await app.evaluate(() => globalThis.__boosterPreferenceGate.release());
        if (failSave) {
          await expect
            .poll(() =>
              app.evaluate(
                () => globalThis.__boosterPreferenceGate.reports.length,
              ),
            )
            .toBe(1);
          const result = await app.evaluate(({ app, BrowserWindow }) => ({
            count: BrowserWindow.getAllWindows().length,
            visible: BrowserWindow.getAllWindows()[0]?.isVisible(),
            background: JSON.parse(
              process
                .getBuiltinModule("fs")
                .readFileSync(
                  process
                    .getBuiltinModule("path")
                    .join(app.getPath("userData"), "desktop-preferences.json"),
                  "utf8",
                ),
            ).background,
            message: globalThis.__boosterPreferenceGate.reports[0].message,
          }));
          expect(result.count).toBe(1);
          expect(result.visible).toBe(true);
          expect(result.background).toBe(false);
          expect(result.message).toContain("Окно оставлено открытым");
        } else {
          await expect
            .poll(() =>
              app.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0].isVisible(),
              ),
            )
            .toBe(false);
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].show(),
          );
          await expect(
            page.getByRole("heading", { name: "Настройки и помощь" }),
          ).toBeVisible();
        }
      } finally {
        await app.evaluate(() => globalThis.__boosterPreferenceGate?.restore());
      }
      if (failSave) {
        await page
          .getByRole("button", { name: "Настройки", exact: true })
          .click();
        await expect(background).not.toBeChecked();
      } else {
        await background.uncheck();
        await expect(page.getByRole("status")).toHaveText(
          "Настройки сохранены.",
        );
      }
    }
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "PASS: desktop startup, local API, selection, frame groups, exact invitation/InMail preview and recipient-based credit estimate, guided setup, empty/automation/message/mixed history with wait/reply/unknown states, isolated close during preferences save/failure and background reopen, account UI; no LinkedIn requests or sends.",
    );
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
