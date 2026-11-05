const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createPreferencesStore({
  app,
  filename,
  io = fs,
  platform = process.platform,
}) {
  // Campaigns keep working after the window is closed unless the recruiter
  // explicitly turned this off: closing a window should not silently stop
  // approved outreach.
  let committed = { background: true, autoStart: false };
  try {
    const saved = JSON.parse(io.readFileSync(filename, "utf8"));
    committed = {
      background: saved.background !== false,
      autoStart: saved.autoStart === true,
    };
  } catch {}
  let queue = Promise.resolve();
  const pendingWrites = new Set();

  function loginState() {
    if (!app.isPackaged) return null;
    const raw = app.getLoginItemSettings();
    if (typeof raw?.openAtLogin !== "boolean")
      throw Error("Не удалось проверить автозапуск в настройках системы.");
    let enabled = raw.openAtLogin;
    let note = "";
    if (
      platform === "win32" &&
      typeof raw.executableWillLaunchAtLogin === "boolean"
    ) {
      enabled = raw.executableWillLaunchAtLogin;
      if (raw.openAtLogin && !enabled)
        note =
          "Автозапуск выключен в настройках Windows. Чтобы включить его, разрешите Booster Recruiter в списке автозагрузки.";
    }
    if (platform === "darwin" && raw.status === "requires-approval") {
      enabled = false;
      note =
        "Автозапуск требует разрешения в macOS. Разрешите Booster Recruiter в настройках входа в систему.";
    }
    return { raw, enabled, note };
  }

  function snapshot(login) {
    return {
      ...committed,
      ...(login ? { autoStart: login.enabled } : {}),
      packaged: app.isPackaged,
      ...(login?.note ? { autoStartNote: login.note } : {}),
    };
  }

  async function update(patch) {
    const before = loginState();
    if (patch === undefined) return snapshot(before);
    const next = {
      ...committed,
      ...(before ? { autoStart: before.enabled } : {}),
      ...patch,
    };
    const temporary = path.join(
      path.dirname(filename),
      `.${path.basename(filename)}.${randomUUID()}.tmp`,
    );
    let osAttempted = false;
    let login = before;
    try {
      // Complete the new file before changing system settings. The original
      // file and the close-window behavior stay intact until rename succeeds.
      const handle = await io.promises.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(next), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (Object.hasOwn(patch, "autoStart")) {
        osAttempted = true; // Even a throwing OS setter may have partly applied.
        app.setLoginItemSettings({ openAtLogin: patch.autoStart });
        login = loginState();
        // A system approval requirement is a known, visible state, not a claim
        // that autostart is enabled. Other unconfirmed changes are failures.
        if (login.enabled !== patch.autoStart && !login.note)
          throw Error(
            "Система не подтвердила изменение автозапуска. Проверьте настройки входа в систему.",
          );
      }
      await io.promises.rename(temporary, filename);
      committed = next;
      return snapshot(login);
    } catch (error) {
      let recovery = "";
      if (osAttempted) {
        try {
          const restore = { openAtLogin: before.raw.openAtLogin };
          if (platform === "win32") restore.enabled = before.enabled;
          app.setLoginItemSettings(restore);
          const restored = loginState();
          if (
            restored.enabled !== before.enabled ||
            restored.raw.openAtLogin !== before.raw.openAtLogin
          )
            throw Error("Автозапуск отличается от предыдущего состояния.");
        } catch {
          recovery =
            " Не удалось подтвердить восстановление автозапуска. Проверьте его в настройках системы.";
        }
      }
      throw new Error(
        `Не удалось сохранить настройки.${recovery} ${error.message}`,
        { cause: error },
      );
    } finally {
      await io.promises.unlink(temporary).catch(() => {});
    }
  }

  return {
    get background() {
      return committed.background;
    },
    get isSaving() {
      return pendingWrites.size > 0;
    },
    async waitForWrites() {
      while (pendingWrites.size) {
        const results = await Promise.allSettled([...pendingWrites]);
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      }
    },
    async access(patch) {
      if (patch !== undefined) {
        if (
          !patch ||
          typeof patch !== "object" ||
          Array.isArray(patch) ||
          Object.keys(patch).some(
            (key) =>
              !["background", "autoStart"].includes(key) ||
              typeof patch[key] !== "boolean",
          )
        )
          throw Error("Неизвестная настройка приложения.");
        if (Object.hasOwn(patch, "autoStart") && !app.isPackaged)
          throw Error("Автозапуск доступен в установленной версии.");
        patch = { ...patch };
      }
      // The Electron IPC handler can receive overlapping requests. A failed
      // request does not poison later reads or lose unrelated saved settings.
      const operation = queue.then(() => update(patch));
      queue = operation.catch(() => {});
      if (patch !== undefined) {
        pendingWrites.add(operation);
        operation.then(
          () => pendingWrites.delete(operation),
          () => pendingWrites.delete(operation),
        );
      }
      return operation;
    },
  };
}

module.exports = { createPreferencesStore };
