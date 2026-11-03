const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
} = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const readline = require("node:readline");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "booster",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win,
  child,
  connection,
  exiting = false;
const operations = new Set([
  "state",
  "account.create",
  "account.login",
  "account.disconnect",
  "campaign.create",
  "campaign.detail",
  "campaign.collect",
  "campaign.pause",
  "campaign.templates",
  "candidate.review",
  "candidate.suppress",
  "campaign.preview",
  "batch.approve",
  "batch.resume",
  "delivery.resolve",
  "diagnostics",
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
    signal: AbortSignal.timeout(30000),
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
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
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
