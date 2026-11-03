const { _electron: electron, expect } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "..");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "booster-ui-"));
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  execFileSync(
    python,
    [
      "-c",
      `from booster_recruiter.store import Store\nfrom pathlib import Path\ns=Store(Path(${JSON.stringify(data)}))\na=s.create_account('Демо · команда подбора')\ns.set_account(a['id'],'ready','demo-recruiter')\nc=s.create_campaign({'name':'Head of Recruitment · пример','account_id':a['id'],'keywords':'"driver recruitment" manager','max_profiles':20,'template_open':'Hi {first_name}, I noticed you are open to opportunities. Let us discuss a remote recruitment role.','template_neutral':'Hi {first_name}, would you be interested in discussing a remote recruitment role?'})\nfor name,url,status in [('Alex Morgan','demo-alex','open_to_work'),('Sam Taylor','demo-sam','unknown'),('Jamie Reed','demo-jamie','hiring')]:\n s.add_candidate(c['id'],{'url':url,'name':name,'headline':'Recruitment operations · US trucking','photo_frame':{'status':status},'sections':{'main_profile':'Example profile for interface testing.'}})\ns.progress(c['id'],'ready','Демонстрационные данные для проверки интерфейса. Сообщения не отправляются.')\ns.db.close()`,
    ],
    {
      cwd: root,
      env: { ...process.env, PYTHONPATH: path.join(root, "backend") },
    },
  );
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
    await page.getByRole("checkbox", { name: "Выбрать Alex Morgan" }).check();
    await page.getByRole("button", { name: "Проверить сообщения (1)" }).click();
    await expect(
      page.getByRole("dialog", { name: "Проверьте отправку" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Hi Alex, I noticed you are open to opportunities. Let us discuss a remote recruitment role.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Вернуться к списку" }).click();
    await page
      .getByRole("button", { name: "Автоматизация", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Как связываться с людьми" }),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: /Разрешить платный InMail/ })
      .check();
    await page
      .getByLabel("Тема InMail · Open to Work")
      .fill("Recruitment opportunity");
    await page
      .getByLabel("Тема InMail · нейтральное")
      .fill("Recruitment leadership");
    await page
      .getByLabel("Текст приглашения · необязательно")
      .fill("Hi {first_name}, let us connect.");
    await page.getByLabel("Максимум кредитов на эту кампанию").fill("2");
    await page.getByRole("button", { name: "Сохранить правила" }).click();
    await expect(
      page.getByText("Правила сохранены. Проверьте план перед запуском."),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(root, "..", "booster-recruiter-automation-preview.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Кандидаты", exact: true }).click();
    await page.getByRole("button", { name: "Проверить сообщения (1)" }).click();
    await expect(
      page.getByText("Hi Alex, let us connect.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("InMail · Recruitment opportunity", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/экономный режим, не более 1 кредитов/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Вернуться к списку" }).click();
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
      path: path.join(root, "..", "booster-recruiter-preview.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Аккаунты", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "LinkedIn-аккаунты" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Добавить аккаунт" }).click();
    await expect(
      page.getByRole("dialog", { name: "Подключить LinkedIn" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Продолжать работу после закрытия окна" })
      .check();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
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
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "PASS: desktop startup, local API, selection, frame groups, exact invitation/InMail preview and budget, automation settings, isolated background close/reopen, account UI; no LinkedIn requests or sends.",
    );
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
