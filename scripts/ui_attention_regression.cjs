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
  execFileSync(
    python,
    [
      "-c",
      `
import sys
from pathlib import Path
from booster_recruiter.store import Store
p=Path(sys.argv[1]); assert p.name.startswith('booster-ui-')
s=Store(p)
row=s.one("SELECT a.id,a.member_id,m.run_id FROM outreach_actions a JOIN outreach_members m ON m.id=a.member_id WHERE a.kind='invite' LIMIT 1")
with s.db:
 s.db.execute("UPDATE outreach_actions SET status='unknown',detail='Response lost' WHERE id=?",(row['id'],))
 s.db.execute("UPDATE outreach_members SET status='needs_review',relationship='not_connected',invitation_at=NULL,reply_text='',detail='Invitation requires verification' WHERE id=?",(row['member_id'],))
 s.db.execute("UPDATE outreach_runs SET status='paused' WHERE id=?",(row['run_id'],))
s.db.close()
`,
      data,
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
      global.__repairAttempts = [];
      global.__repairedItems = new Set();
      global.__repairTargets = {};
      global.__legacyResumeCalls = [];
      ipcMain.removeHandler("command");
      ipcMain.handle("command", async (event, op, p) => {
        if (op === "workspace.recheck") {
          global.__attentionChecks.push(p.id);
          global.__checkedItems.add(p.id);
          return { started: true };
        }
        if (op === "batch.resume") {
          if (p.id !== "synthetic-pending-batch")
            throw Error("Unexpected batch");
          global.__legacyResumeCalls.push(p.id);
          return { started: true };
        }
        if (op === "workspace.retry_invitation") {
          if (p.confirm !== true || p.digest !== "synthetic-repair-digest")
            throw Error("Invalid repair confirmation");
          global.__repairAttempts.push(p);
          global.__repairedItems.add(p.id);
          return { started: true };
        }
        if (!allowed.has(op)) {
          global.__attentionBlocked.push(op);
          throw Error("External/job operation blocked");
        }
        const result = await original(event, op, p);
        if (op === "campaign.detail") {
          const repaired = Object.entries(global.__repairTargets).some(
            ([id, t]) =>
              global.__repairedItems.has(id) && t.campaign_id === p.id,
          );
          if (repaired)
            result.batches.push({
              id: "synthetic-pending-batch",
              status: "approved",
              pending: 1,
              unknown: 1,
            });
          for (const run of result.outreach.runs)
            for (const member of run.members)
              if (global.__repairedItems.has("review:" + member.id)) {
                member.status = "waiting_acceptance";
                member.relationship = "pending";
                member.invitation_at = "2026-11-04T12:00:00Z";
                member.detail = "Приглашение подтверждено. Ожидаем принятия.";
                for (const action of run.actions)
                  if (
                    action.member_id === member.id &&
                    action.status === "unknown"
                  )
                    action.repair_replaced_by = "confirmed-repair";
              }
        }
        if (op === "workspace.summary") {
          result.items = result.items.filter(
            (i) => !global.__repairedItems.has(i.id),
          );
          result.items.forEach((i) => {
            if (i.kind === "review") i.can_recheck = true;
            if (global.__checkedItems.has(i.id)) {
              global.__repairTargets[i.id] = {
                campaign_id: i.campaign_id,
                member_id: i.member_id,
              };
              i.repair = {
                digest: "synthetic-repair-digest",
                member_id: i.member_id,
                name: i.name,
                url: i.url,
                account_id: i.account_id,
                account_label: "Fixture sender",
                note: "Approved invitation note",
                expires_at: "2099-01-01T00:00:00Z",
              };
            }
          });
          global.__repairSource = result.items.find(
            (i) => i.kind === "review" && i.member_id,
          )?.id;
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
    for (const width of [1000, 1380]) {
      await app.evaluate(
        ({ BrowserWindow }, w) =>
          BrowserWindow.getAllWindows()[0].setSize(w, 700),
        width,
      );
      const geometry = await page
        .locator(".attention-filters button")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect();
            const count = node.querySelector("b").getBoundingClientRect();
            return {
              y: r.y,
              height: r.height,
              center: r.y + r.height / 2,
              countCenter: count.y + count.height / 2,
              bottom: r.bottom,
              right: r.right,
            };
          }),
        );
      assert.equal(geometry.length, 4);
      assert.ok(
        geometry.every(
          (g) =>
            Math.abs(g.height - geometry[0].height) < 1 &&
            Math.abs(g.y - geometry[0].y) < 1 &&
            Math.abs(g.center - g.countCenter) < 1,
        ),
        "Attention filters/counts must share a centered row and height",
      );
      assert.ok(
        await page
          .locator(".attention-filters")
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
        "Filters must not overflow",
      );
      if (process.env.BOOSTER_UI_ARTIFACT_DIR) {
        fs.mkdirSync(process.env.BOOSTER_UI_ARTIFACT_DIR, { recursive: true });
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
        .getByRole("button", { name: "Уточнить статус", exact: true })
        .count();
    const unsupported = list
      .locator("li")
      .filter({ hasText: "Unsupported InMail fixture" });
    await expect(
      unsupported.getByRole("button", {
        name: "Уточнить статус",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      unsupported.getByRole("button", {
        name: "Посмотреть историю",
        exact: true,
      }),
    ).toBeVisible();
    await expect(unsupported).toContainText(
      "Старая отправка InMail требует ручной проверки переписки.",
    );
    assert.ok(before > 0);
    const repairSource = await app.evaluate(() => global.__repairSource);
    assert.ok(repairSource, "Fixture must expose a campaign member for repair");
    await list
      .locator('[id="attention-' + repairSource + '"]')
      .getByRole("button", { name: "Уточнить статус", exact: true })
      .click();
    await expect(
      list.getByRole("button", {
        name: "Уточнить статус",
        exact: true,
      }),
    ).toHaveCount(before - 1);
    assert.equal(
      (await app.evaluate(() => global.__attentionChecks)).length,
      1,
    );
    const repairButton = list
      .getByRole("button", { name: "Отправить приглашение", exact: true })
      .first();
    await repairButton.click();
    const repairDialog = page.getByRole("dialog", {
      name: "Отправить приглашение?",
      exact: true,
    });
    await expect(repairDialog).toContainText("Fixture sender");
    await expect(repairDialog).toContainText("Approved invitation note");
    for (const width of [1000, 1380]) {
      await app.evaluate(
        ({ BrowserWindow }, w) =>
          BrowserWindow.getAllWindows()[0].setSize(w, 700),
        width,
      );
      const visibleActions = await repairDialog
        .locator(".modal-footer button")
        .evaluateAll((nodes) =>
          nodes.every((node) => {
            const r = node.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= innerHeight + 1;
          }),
        );
      assert.equal(
        visibleActions,
        true,
        "Repair confirmation actions must be visible at minimum window size",
      );
      if (process.env.BOOSTER_UI_ARTIFACT_DIR)
        await page.screenshot({
          path: path.join(
            process.env.BOOSTER_UI_ARTIFACT_DIR,
            `invitation-repair-confirm-${width}.png`,
          ),
          fullPage: true,
        });
    }

    await repairDialog
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    assert.equal(
      (await app.evaluate(() => global.__repairAttempts)).length,
      0,
      "Cancelling repair must not authorize an invitation",
    );
    await repairButton.click();
    await repairDialog
      .getByRole("button", { name: "Подтвердить приглашение", exact: true })
      .click();
    await expect(repairDialog).toHaveCount(0);
    assert.equal(
      (await app.evaluate(() => global.__repairAttempts)).length,
      1,
      "Explicit repair must submit exactly one confirmed request",
    );
    await expect(
      list.getByRole("button", { name: "Отправить приглашение", exact: true }),
    ).toHaveCount(0);
    const repairedTarget = await app.evaluate(() => {
      const attempt = global.__repairAttempts[0];
      return global.__repairTargets[attempt.id];
    });
    const repairedCampaign = await page.evaluate(
      async (id) =>
        (await window.booster.command("state")).campaigns.find(
          (c) => c.id === id,
        ),
      repairedTarget.campaign_id,
      undefined,
      false,
    );
    await page.getByRole("button", { name: /^Кампании/ }).click();
    await page
      .getByRole("button", { name: repairedCampaign.name, exact: true })
      .click();
    await page.getByRole("button", { name: "История", exact: true }).click();
    await expect(
      page.locator("#member-" + repairedTarget.member_id),
    ).toContainText("Ждём принятия");
    const oldAttempt = page
      .locator(".action-record")
      .filter({ hasText: "Старая попытка" })
      .first();
    await oldAttempt.locator("summary").click();
    await expect(oldAttempt).toContainText(
      "актуальное состояние приглашения или связи",
    );
    const legacyResume = page.getByRole("button", {
      name: "Продолжить очередь",
      exact: true,
    });
    await expect(legacyResume).toBeEnabled();
    await expect(
      page.getByText(/Неподтверждённые отправки отложены для проверки/),
    ).toBeVisible();
    await legacyResume.click();
    assert.deepEqual(await app.evaluate(() => global.__legacyResumeCalls), [
      "synthetic-pending-batch",
    ]);

    await expect(
      oldAttempt.getByRole("button", {
        name: "Уточнить статус",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Аккаунты", exact: true }).click();
    const originalAccount = await page.evaluate(
      async () => (await window.booster.command("state")).accounts[0],
      undefined,
      undefined,
      false,
    );
    const card = page.locator("#account-" + originalAccount.id);
    for (const width of [1000, 1380]) {
      await app.evaluate(
        ({ BrowserWindow }, w) =>
          BrowserWindow.getAllWindows()[0].setSize(w, 700),
        width,
      );
      for (const readyCard of await page.locator(".account-card").all()) {
        const disconnect = readyCard.getByRole("button", {
          name: "Отключить сессию",
          exact: true,
        });
        if (await disconnect.count()) {
          const d = await disconnect.boundingBox(),
            remove = await readyCard
              .getByRole("button", { name: "Удалить аккаунт", exact: true })
              .boundingBox();
          assert.ok(
            remove.y - (d.y + d.height) >= 28,
            "Disconnect and delete must have separate groups and at least 28px hit-target gap",
          );
        }
      }
      if (process.env.BOOSTER_UI_ARTIFACT_DIR)
        await page.screenshot({
          path: path.join(
            process.env.BOOSTER_UI_ARTIFACT_DIR,
            `account-actions-${width}.png`,
          ),
          fullPage: true,
        });
    }

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
      page.getByRole("button", { name: "Отправка", exact: true }),
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
      "PASS: aligned filters/counts, separated account controls, explicit single-invitation repair cancel/confirm, attention/delete/archive; no LinkedIn actions.",
    );
  } finally {
    await app.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
