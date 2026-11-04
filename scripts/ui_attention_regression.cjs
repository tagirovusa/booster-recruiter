// Isolated UI coverage: auto-check browser work is intercepted; no LinkedIn requests.
const { _electron: electron, expect } =
  require("./patchright_test_driver.cjs").loadPatchright();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, ".."),
    data = fs.mkdtempSync(path.join(os.tmpdir(), "booster-ui-attention-"));
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
    await app.evaluate(({ ipcMain, dialog }) => {
      const original = ipcMain._invokeHandlers.get("command"),
        allowed = new Set([
          "state",
          "workspace.summary",
          "workspace.acknowledge",
          "campaign.detail",
          "account.create",
          "account.deletion_preview",
          "account.delete",
          "backup.list",
        ]);
      global.__externalProfileOpened = null;
      ipcMain.removeHandler("open-profile");
      ipcMain.handle("open-profile", (_event, url) => {
        global.__externalProfileOpened = url;
        return true;
      });
      global.__archiveExportRequested = false;
      dialog.showSaveDialog = async () => {
        global.__archiveExportRequested = true;
        return { canceled: true };
      };
      global.__attentionChecks = [];
      global.__attentionBlocked = [];
      global.__checkedItems = new Set();
      ipcMain.removeHandler("command");
      ipcMain.handle("command", async (event, op, p) => {
        if (op === "workspace.recheck") {
          global.__attentionChecks.push(p.id);
          global.__checkedItems.add(p.id);
          return { started: true };
        }
        if (!allowed.has(op)) {
          global.__attentionBlocked.push(op);
          throw Error("External/job operation blocked");
        }
        const result = await original(event, op, p);
        if (op === "workspace.summary") {
          result.items = result.items.filter(
            (i) => !global.__checkedItems.has(i.id),
          );
          result.items.forEach((i) => {
            if (i.kind === "review") i.can_recheck = true;
          });
          const sourceItem = result.items.find((i) => i.kind === "review");
          if (sourceItem)
            result.items.push({
              ...sourceItem,
              id: "review:unsupported-fixture",
              name: "Unsupported InMail fixture",
              can_recheck: false,
              recheck_unavailable_reason:
                "Старая отправка InMail требует ручной проверки переписки.",
            });
          result.counts = Object.fromEntries(
            ["reply", "review", "login"].map((k) => [
              k,
              result.items.filter((i) => i.kind === k).length,
            ]),
          );
        }
        return result;
      });
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await expect(
      page.getByRole("heading", { name: "Ваши кампании", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Требуют внимания" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Требует внимания/ }).click();
    await expect(
      page.getByRole("heading", { name: "Требует внимания", exact: true }),
    ).toBeVisible();
    if (process.env.BOOSTER_UI_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.BOOSTER_UI_ARTIFACT_DIR, { recursive: true });
      for (const width of [1000, 1380]) {
        await app.evaluate(
          ({ BrowserWindow }, w) =>
            BrowserWindow.getAllWindows()[0].setSize(w, 700),
          width,
        );
        await page.screenshot({
          path: path.join(
            process.env.BOOSTER_UI_ARTIFACT_DIR,
            `attention-menu-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
    const list = page.getByRole("region", { name: "Требуют внимания" }),
      before = await list
        .getByRole("button", { name: "Проверить автоматически", exact: true })
        .count();
    const unsupported = list
      .locator("li")
      .filter({ hasText: "Unsupported InMail fixture" });
    await expect(
      unsupported.getByRole("button", {
        name: "Проверить автоматически",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      unsupported.getByRole("button", {
        name: "Проверить вручную",
        exact: true,
      }),
    ).toBeVisible();
    await expect(unsupported).toContainText(
      "Старая отправка InMail требует ручной проверки переписки.",
    );
    assert.ok(before > 0);
    await list
      .getByRole("button", { name: "Проверить автоматически", exact: true })
      .first()
      .click();
    await expect(
      list.getByRole("button", {
        name: "Проверить автоматически",
        exact: true,
      }),
    ).toHaveCount(before - 1);
    assert.equal(
      (await app.evaluate(() => global.__attentionChecks)).length,
      1,
    );
    await page.getByRole("button", { name: "Аккаунты", exact: true }).click();
    const originalAccount = await page.evaluate(
      async () => (await window.booster.command("state")).accounts[0],
      undefined,
      undefined,
      false,
    );
    const card = page.locator("#account-" + originalAccount.id);
    await card
      .getByRole("button", { name: "Удалить аккаунт", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Удалить аккаунт из приложения?",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(card).toBeVisible();
    await card
      .getByRole("button", { name: "Удалить аккаунт", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Удалить аккаунт и сессию", exact: true })
      .click();
    await expect(page.locator("#account-" + originalAccount.id)).toHaveCount(0);
    const state = await page.evaluate(
      () => window.booster.command("state"),
      undefined,
      undefined,
      false,
    );
    assert.ok(state.archived_accounts.some((a) => a.id === originalAccount.id));
    assert.ok(state.archived_campaigns.length > 0);
    // Delete every remaining isolated sender: archives must stay reachable with zero active accounts.
    for (const remaining of state.accounts) {
      const remainingCard = page.locator("#account-" + remaining.id);
      await remainingCard
        .getByRole("button", { name: "Удалить аккаунт", exact: true })
        .click();
      await page
        .getByRole("dialog", {
          name: "Удалить аккаунт из приложения?",
          exact: true,
        })
        .getByRole("button", { name: "Удалить аккаунт и сессию", exact: true })
        .click();
      await expect(remainingCard).toHaveCount(0);
    }
    const afterAll = await page.evaluate(
      () => window.booster.command("state"),
      undefined,
      undefined,
      false,
    );
    assert.equal(afterAll.accounts.length, 0);
    assert.equal(afterAll.campaigns.length, 0);
    await page.getByRole("button", { name: /^Кампании/ }).click();
    await page.getByRole("button", { name: /^Архив ·/ }).click();
    await expect(
      page.getByRole("heading", { name: "Архив кампаний", exact: true }),
    ).toBeVisible();
    const campaign =
      state.archived_campaigns.find((c) => c.name === "История · вместе") ||
      state.archived_campaigns.find((c) => c.name.includes("История")) ||
      state.archived_campaigns[0];
    await page
      .getByRole("button", { name: campaign.name, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: campaign.name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Excel", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Excel", exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => global.__archiveExportRequested))
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Автоматизация", exact: true }),
    ).toHaveCount(0);
    const archiveProfile = page.locator(".outreach-history .text-link").first();
    if (await archiveProfile.count()) {
      await archiveProfile.click();
      await expect
        .poll(() => app.evaluate(() => global.__externalProfileOpened))
        .toMatch(/^https:\/\/www\.linkedin\.com\/in\//);
    }
    await expect(
      page.getByRole("button", {
        name: /^(Найти кандидатов|Продолжить поиск|Продолжить кампанию)$/,
      }),
    ).toHaveCount(0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 700),
    );
    if (process.env.BOOSTER_UI_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.BOOSTER_UI_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.BOOSTER_UI_ARTIFACT_DIR,
          "archived-campaign-1000.png",
        ),
        fullPage: true,
      });
    }
    assert.deepEqual(await app.evaluate(() => global.__attentionBlocked), []);
    console.log(
      "PASS: separate attention menu, read-only automatic-check dispatch, account deletion cancel/confirm, archived read-only history; no LinkedIn actions.",
    );
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
