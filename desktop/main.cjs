const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
  Tray,
  Menu,
  nativeImage,
  Notification,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const readline = require("node:readline");
const { createPreferencesStore } = require("./preferences.cjs");
const { createPauseAllHandler } = require("./tray_pause.cjs");
const { createCloseHandler } = require("./window_lifecycle.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "booster",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win,
  child,
  connection,
  tray,
  exiting = false;
let desktopPreferences, attentionNotifications, notificationTimer;
const {
  createAttentionNotifications,
} = require("./attention_notifications.cjs");
function createApplicationMenu() {
  const items = [];
  if (process.platform === "darwin")
    items.push({
      label: "Booster Recruiter",
      submenu: [
        { role: "about", label: "О Booster Recruiter" },
        { type: "separator" },
        { role: "services", label: "Службы" },
        { type: "separator" },
        { role: "hide", label: "Скрыть Booster Recruiter" },
        { role: "hideOthers", label: "Скрыть остальные" },
        { role: "unhide", label: "Показать все" },
        { type: "separator" },
        { role: "quit", label: "Завершить Booster Recruiter" },
      ],
    });
  else
    items.push({
      label: "Booster Recruiter",
      submenu: [
        { role: "about", label: "О Booster Recruiter" },
        { type: "separator" },
        { role: "quit", label: "Выход" },
      ],
    });
  items.push(
    {
      label: "Правка",
      submenu: [
        { role: "undo", label: "Отменить" },
        { role: "redo", label: "Повторить" },
        { type: "separator" },
        { role: "cut", label: "Вырезать" },
        { role: "copy", label: "Копировать" },
        { role: "paste", label: "Вставить" },
        { role: "selectAll", label: "Выделить всё" },
      ],
    },
    {
      label: "Окно",
      submenu: [
        { role: "minimize", label: "Свернуть" },
        { role: "zoom", label: "Изменить размер" },
        { role: "togglefullscreen", label: "Полный экран" },
        { role: "close", label: "Закрыть окно" },
      ],
    },
  );
  if (!app.isPackaged)
    items.push({
      label: "Разработка",
      submenu: [
        { role: "reload", label: "Перезагрузить" },
        { role: "toggleDevTools", label: "Инструменты разработчика" },
      ],
    });
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}
function preferencesPath() {
  return path.join(app.getPath("userData"), "desktop-preferences.json");
}
function showWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}
function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "tray.png"))
    .resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip("Booster Recruiter");
  const pauseAll = createPauseAllHandler({
    call,
    report: async (result) => {
      if (exiting) return;
      showWindow();
      const options = {
        ...result,
        buttons: ["Понятно"],
        defaultId: 0,
        noLink: true,
      };
      if (win && !win.isDestroyed()) await dialog.showMessageBox(win, options);
      else await dialog.showMessageBox(options);
    },
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть Booster Recruiter", click: showWindow },
      {
        label: "Приостановить все кампании",
        click: pauseAll,
      },
      { type: "separator" },
      { label: "Завершить работу", click: () => app.quit() },
    ]),
  );
  tray.on("click", showWindow);
}
const operations = new Set([
  "state",
  "workspace.summary",
  "workspace.recheck",
  "workspace.retry_invitation",
  "account.deletion_preview",
  "account.delete",
  "workspace.acknowledge",
  "template.list",
  "template.save",
  "template.create",
  "template.delete",
  "backup.list",
  "backup.create",
  "backup.restore",
  "account.create",
  "account.login",
  "account.open_profile",
  "account.disconnect",
  "account.recruiter",
  "account.recruiter_prepare",
  "campaign.create",
  "campaign.detail",
  "campaign.collect",
  "campaign.pause",
  "campaign.templates",
  "campaign.save_automation",
  "candidate.review",
  "candidate.select_many",
  "candidate.suppress",
  "campaign.preview",
  "batch.approve",
  "batch.resume",
  "delivery.resolve",
  "diagnostics",
  "campaign.automation",
  "campaign.check",
  "outreach.preview",
  "outreach.approve",
  "outreach.resume",
  "outreach.check_now",
  "outreach.resolve",
]);
const base = path.resolve(__dirname, "..");
function backend() {
  if (app.isPackaged)
    return {
      exe: path.join(
        process.resourcesPath,
        "runtime",
        "booster-backend",
        process.platform === "win32"
          ? "booster-backend.exe"
          : "booster-backend",
      ),
      args: [],
    };
  return {
    exe: path.join(
      base,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    ),
    args: ["-m", "booster_recruiter"],
  };
}
async function call(op, params = {}) {
  if (!connection) throw Error("Сервис приложения ещё запускается.");
  const response = await fetch(`http://127.0.0.1:${connection.port}/command`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ op, params }),
    signal: AbortSignal.timeout(op === "outreach.preview" ? 240000 : 30000),
  });
  const result = await response.json();
  if (result.error) throw Error(result.error);
  return result.result;
}
function trusted(event) {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    !event.senderFrame.url.startsWith("booster://app/")
  )
    throw Error("Недопустимый источник команды.");
}
async function start() {
  app.setName("Booster Recruiter");
  if (process.platform === "win32")
    app.setAppUserModelId("io.bbooster.recruiter");
  createApplicationMenu();
  desktopPreferences = createPreferencesStore({
    app,
    filename: preferencesPath(),
  });
  const { exe, args } = backend();
  const root = process.env.BOOSTER_DATA_DIR || app.getPath("userData");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const browsers = path.join(process.resourcesPath, "runtime", "browser");
  if (app.isPackaged && fs.existsSync(browsers))
    env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  child = spawn(exe, [...args, "--data-dir", root], {
    cwd: app.isPackaged ? path.dirname(exe) : base,
    stdio: ["ignore", "pipe", "pipe"],
    env,
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Не удалось запустить сервис приложения.")),
      45000,
    );
    child.once("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (!connection) reject(Error(`Сервис завершился (${code}).`));
    });
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const data = JSON.parse(line);
        if (data.ready) {
          connection = data;
          clearTimeout(timeout);
          resolve();
        }
      } catch {}
    });
    let log = "";
    child.stderr.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-10000);
    });
  });
  protocol.handle("booster", (request) => {
    const url = new URL(request.url);
    let file;
    try {
      file = path.resolve(
        base,
        "dist",
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (
      url.hostname !== "app" ||
      !file.startsWith(path.join(base, "dist") + path.sep)
    )
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  win = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    title: "Booster Recruiter",
    backgroundColor: "#F3F3F3",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("booster://app/")) event.preventDefault();
  });
  win.once("ready-to-show", () => win.show());
  win.on(
    "close",
    createCloseHandler({
      preferences: desktopPreferences,
      window: win,
      isQuitting: () => exiting,
      reportFailure: async (error) => {
        await dialog.showMessageBox(win, {
          type: "error",
          title: "Настройки не сохранены",
          message:
            "Не удалось подтвердить сохранение настроек. Окно оставлено открытым.",
          detail: `Закрытие отменено, чтобы работа кампаний не прервалась. Проверьте настройки и попробуйте ещё раз.\n\nТехнические подробности: ${error.message}`,
          buttons: ["Понятно"],
          defaultId: 0,
          noLink: true,
        });
      },
    }),
  );
  createTray();
  attentionNotifications = createAttentionNotifications({
    filename: path.join(
      app.getPath("userData"),
      "attention-notifications.json",
    ),
    show: async (items) => {
      if (!Notification.isSupported() || win?.isFocused()) return;
      const notification = new Notification({
        title: "Booster Recruiter",
        body: items.some((i) => i.kind === "reply")
          ? "Есть новые ответы. Откройте рабочее пространство."
          : "Кампаниям нужна ваша помощь. Откройте рабочее пространство.",
        silent: true,
      });
      notification.on("click", () => {
        showWindow();
        win?.webContents.send("workspace-attention", items[0].id);
      });
      notification.show();
    },
  });
  let polling = false;
  const pollAttention = async () => {
    if (polling || exiting || !connection) return;
    polling = true;
    try {
      await attentionNotifications.poll(await call("workspace.summary"));
    } catch {
    } finally {
      polling = false;
    }
  };
  await pollAttention();
  notificationTimer = setInterval(pollAttention, 30000);
  notificationTimer.unref();
  await win.loadURL("booster://app/");
  child.on("exit", () => {
    connection = null;
    if (!exiting && win && !win.isDestroyed())
      dialog.showErrorBox(
        "Сервис остановлен",
        "Перезапустите приложение. Сохранённые кампании останутся; незавершённая отправка потребует проверки.",
      );
  });
}
ipcMain.handle("command", async (event, op, params) => {
  trusted(event);
  if (!operations.has(op)) throw Error("Команда недоступна.");
  return call(op, params);
});
ipcMain.handle("notification-settings", (event, patch) => {
  trusted(event);
  if (!attentionNotifications)
    throw Error("Настройки ещё загружаются. Попробуйте снова.");
  return attentionNotifications.access(patch);
});
ipcMain.handle("desktop-settings", async (event, patch) => {
  trusted(event);
  return desktopPreferences.access(patch);
});
ipcMain.handle("export", async (event, cid, format) => {
  trusted(event);
  if (!["csv", "xlsx"].includes(format)) throw Error("Неверный формат.");
  const result = await call("campaign.export", { id: cid, format });
  const target = await dialog.showSaveDialog(win, {
    defaultPath: result.filename,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (target.canceled) return false;
  await fs.promises.writeFile(
    target.filePath,
    Buffer.from(result.data, "base64"),
  );
  return true;
});
ipcMain.handle("open-profile", async (event, url) => {
  trusted(event);
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)linkedin\.com$/.test(u.hostname))
    throw Error("Разрешены только ссылки LinkedIn.");
  await shell.openExternal(u.href);
});
ipcMain.handle("mcp-config", (event) => {
  trusted(event);
  const { exe, args } = backend();
  return JSON.stringify(
    {
      mcpServers: {
        "booster-recruiter": {
          command: exe,
          args: [
            ...args,
            "--mcp",
            "--data-dir",
            process.env.BOOSTER_DATA_DIR || app.getPath("userData"),
          ],
        },
      },
    },
    null,
    2,
  );
});
// An isolated workspace (including acceptance tests) needs its own Electron
// lock and browser cache, matching the backend's data directory.
if (process.env.BOOSTER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.BOOSTER_DATA_DIR));
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
  app.on("activate", showWindow);
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      dialog.showErrorBox(
        "Не удалось открыть Booster Recruiter",
        error.message,
      );
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (exiting) return;
    exiting = true;
    clearInterval(notificationTimer);
    event.preventDefault();
    Promise.race([
      call("shutdown").catch(() => {}),
      new Promise((r) => setTimeout(r, 10000)),
    ]).finally(() => {
      child?.kill();
      app.quit();
    });
  });
}
