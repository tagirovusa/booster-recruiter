// Opens every main screen in the default English interface and reports any
// Cyrillic interface text. Fixture people/messages may be Russian by design;
// those lines are printed for review, not failed automatically.
const { _electron: electron } =
  require("./patchright_test_driver.cjs").loadPatchright();
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "..");
  const shots =
    process.env.BOOSTER_UI_ARTIFACT_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), "booster-en-shots-"));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "booster-ui-en-"));
  const python = path.join(
    root,
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
  execFileSync(python, [path.join(root, "scripts/ui_fixtures.py"), data], {
    cwd: root,
    env: { ...process.env, PYTHONPATH: path.join(root, "backend") },
  });
  const env = {
    ...process.env,
    BOOSTER_DATA_DIR: data,
    PYTHONPATH: path.join(root, "backend"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [root], env, timeout: 60000 });
  const found = new Map();
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("heading", { name: "Your campaigns" })
      .waitFor({ timeout: 30000 });
    const scan = async (label) => {
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(shots, `${label}.png`),
        fullPage: true,
      });
      const lines = await page.evaluate(() => {
        const out = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
        );
        const attrs = ["aria-label", "title", "placeholder", "alt"];
        for (let n = walker.currentNode; n; n = walker.nextNode()) {
          for (const a of attrs) {
            const v = n.getAttribute?.(a);
            if (v && /[А-Яа-яЁё]/.test(v)) out.push(`[${a}] ${v}`);
          }
          if (n.tagName === "TEXTAREA" || n.tagName === "INPUT") continue;
          for (const c of n.childNodes)
            if (c.nodeType === 3 && /[А-Яа-яЁё]/.test(c.nodeValue))
              out.push(c.nodeValue.trim());
        }
        return out;
      });
      for (const l of lines) if (!found.has(l)) found.set(l, label);
    };
    const click = async (name) => {
      const b = page.getByRole("button", { name, exact: true }).first();
      if (await b.count()) {
        await b.click();
        return true;
      }
      return false;
    };
    await scan("campaigns");
    const rows = page.locator("table tbody tr, .campaign-row, [data-campaign]");
    const n = Math.min(await rows.count(), 4);
    for (let i = 0; i < n; i++) {
      await rows
        .nth(i)
        .click()
        .catch(() => {});
      await scan(`campaign-${i}`);
      for (const tab of ["Candidates", "Outreach", "History"]) {
        if (await click(tab)) {
          await scan(`campaign-${i}-${tab}`);
          for (const d of await page
            .locator("details:not([open]) > summary")
            .all())
            await d.click().catch(() => {});
          await scan(`campaign-${i}-${tab}-open`);
        }
      }
      await click("All campaigns");
    }
    for (const nav of ["Accounts", "Settings", "Needs attention"]) {
      const b = page.getByRole("button", { name: new RegExp(nav) }).first();
      if (await b.count()) {
        await b.click();
        await scan(nav);
      }
    }
    for (const d of await page.locator("details:not([open]) > summary").all())
      await d.click().catch(() => {});
    await scan("settings-open");
    // Switching to Russian reloads the window in Russian and persists.
    await page
      .getByRole("button", { name: /^Settings/ })
      .first()
      .click();
    await page.getByRole("combobox", { name: /Language/ }).selectOption("ru");
    await page
      .getByRole("heading", { name: "Настройки и помощь" })
      .waitFor({ timeout: 15000 });
    const saved = JSON.parse(
      fs.readFileSync(path.join(data, "desktop-preferences.json"), "utf8"),
    );
    if (saved.language !== "ru") throw Error("language was not saved");
    console.log("PASS: language switch to Russian reloads and is saved");
  } finally {
    await app.close().catch(() => {});
  }
  console.log(`Screens in ${shots}`);
  console.log(`Cyrillic strings: ${found.size}`);
  for (const [l, where] of found) console.log(`  ${where}: ${l.slice(0, 160)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
