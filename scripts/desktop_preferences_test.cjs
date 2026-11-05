const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPreferencesStore } = require("../desktop/preferences.cjs");
const { createCloseHandler } = require("../desktop/window_lifecycle.cjs");

function fixture(
  t,
  { packaged = true, platform = "darwin", saved, io, initial } = {},
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "booster-preferences-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "desktop-preferences.json");
  if (saved !== undefined) fs.writeFileSync(filename, JSON.stringify(saved));
  const system = { openAtLogin: false, status: "not-registered", ...initial };
  const calls = [];
  const app = {
    isPackaged: packaged,
    getLoginItemSettings() {
      return { ...system };
    },
    setLoginItemSettings(settings) {
      calls.push(settings);
      system.openAtLogin = settings.openAtLogin;
      system.status = settings.openAtLogin ? "enabled" : "not-registered";
      if (platform === "win32")
        system.executableWillLaunchAtLogin =
          settings.openAtLogin && settings.enabled !== false;
    },
  };
  const store = createPreferencesStore({
    app,
    filename,
    platform,
    io: io || fs,
  });
  return {
    app,
    store,
    system,
    calls,
    filename,
    directory,
    persisted: () => JSON.parse(fs.readFileSync(filename, "utf8")),
  };
}
const withIO = (overrides) => ({
  ...fs,
  promises: { ...fs.promises, ...overrides },
});
const savedDefaults = { background: false, autoStart: false };

test("source keeps defaults and never queries or changes OS autostart", async (t) => {
  const f = fixture(t, { packaged: false });
  f.app.getLoginItemSettings = f.app.setLoginItemSettings = () => {
    throw Error("No real or mock OS call expected");
  };
  // Without a saved choice, campaigns keep working after the window closes.
  assert.deepEqual(await f.store.access(), {
    background: true,
    autoStart: false,
    packaged: false,
  });
  assert.deepEqual(await f.store.access({ background: true }), {
    background: true,
    autoStart: false,
    packaged: false,
  });
  await assert.rejects(
    f.store.access({ autoStart: true }),
    /установленной версии/,
  );
  assert.equal(f.store.background, true);
  assert.deepEqual(f.persisted(), { background: true, autoStart: false });
  for (const patch of [null, [], { unknown: true }, { background: "yes" }])
    await assert.rejects(f.store.access(patch), /Неизвестная настройка/);
});

test("successful replacement persists both fields and leaves no temporary file", async (t) => {
  const f = fixture(t, { saved: savedDefaults });
  assert.deepEqual(
    await f.store.access({ background: true, autoStart: true }),
    { background: true, autoStart: true, packaged: true },
  );
  assert.deepEqual(f.persisted(), { background: true, autoStart: true });
  assert.equal(f.store.background, true);
  assert.deepEqual(fs.readdirSync(f.directory), ["desktop-preferences.json"]);
});

test("packaged reads reflect an external OS change, without writing it back", async (t) => {
  const f = fixture(t, { saved: { background: true, autoStart: true } });
  assert.equal((await f.store.access()).autoStart, false);
  f.system.openAtLogin = true;
  f.system.status = "enabled";
  assert.equal((await f.store.access()).autoStart, true);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.persisted(), { background: true, autoStart: true });
});

test("temporary-file failure leaves OS, cache, and previous JSON untouched", async (t) => {
  const f = fixture(t, {
    saved: savedDefaults,
    io: withIO({
      open: async () => {
        throw Error("ENOSPC");
      },
    }),
  });
  await assert.rejects(
    f.store.access({ background: true, autoStart: true }),
    /ENOSPC/,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.background, false);
  assert.deepEqual(f.persisted(), savedDefaults);
  assert.deepEqual(fs.readdirSync(f.directory), ["desktop-preferences.json"]);
});

test("rename failure compensates autostart and does not publish memory", async (t) => {
  const f = fixture(t, {
    saved: savedDefaults,
    io: withIO({
      rename: async () => {
        throw Error("EACCES");
      },
    }),
  });
  await assert.rejects(
    f.store.access({ background: true, autoStart: true }),
    /EACCES/,
  );
  assert.deepEqual(f.calls, [{ openAtLogin: true }, { openAtLogin: false }]);
  assert.equal(f.store.background, false);
  assert.equal((await f.store.access()).autoStart, false);
  assert.deepEqual(f.persisted(), savedDefaults);
  assert.deepEqual(fs.readdirSync(f.directory), ["desktop-preferences.json"]);
});

test("a partial write cannot truncate the previous preferences file", async (t) => {
  const f = fixture(t, {
    saved: savedDefaults,
    io: withIO({
      open: async (...args) => {
        const handle = await fs.promises.open(...args);
        return {
          async writeFile() {
            await handle.writeFile('{"background":');
            throw Error("partial write ENOSPC");
          },
          sync: () => handle.sync(),
          close: () => handle.close(),
        };
      },
    }),
  });
  await assert.rejects(
    f.store.access({ background: true, autoStart: true }),
    /partial write ENOSPC/,
  );
  assert.deepEqual(f.persisted(), savedDefaults);
  assert.equal(f.store.background, false);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(fs.readdirSync(f.directory), ["desktop-preferences.json"]);
});

test("failed OS compensation reports uncertainty and readback shows actual state", async (t) => {
  const f = fixture(t, {
    saved: savedDefaults,
    io: withIO({
      rename: async () => {
        throw Error("rename failed");
      },
    }),
  });
  const set = f.app.setLoginItemSettings;
  f.app.setLoginItemSettings = (settings) => {
    if (!settings.openAtLogin) throw Error("rollback denied");
    set(settings);
  };
  await assert.rejects(
    f.store.access({ autoStart: true }),
    /Не удалось подтвердить восстановление автозапуска/,
  );
  assert.equal((await f.store.access()).autoStart, true);
  assert.deepEqual(f.persisted(), savedDefaults);
});

test("a setter that partly applies then throws is also compensated", async (t) => {
  const f = fixture(t, { saved: savedDefaults });
  const set = f.app.setLoginItemSettings;
  f.app.setLoginItemSettings = (settings) => {
    set(settings);
    if (settings.openAtLogin) throw Error("partial OS failure");
  };
  await assert.rejects(
    f.store.access({ autoStart: true }),
    /partial OS failure/,
  );
  assert.equal((await f.store.access()).autoStart, false);
  assert.deepEqual(f.persisted(), savedDefaults);
});

test("concurrent saves and reads serialize without lost fields or premature memory change", async (t) => {
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const arrived = new Promise((resolve) => {
    entered = resolve;
  });
  let count = 0;
  const f = fixture(t, {
    saved: savedDefaults,
    io: withIO({
      rename: async (...args) => {
        if (++count === 1) {
          entered();
          await gate;
        }
        return fs.promises.rename(...args);
      },
    }),
  });
  const first = f.store.access({ background: true });
  await arrived;
  const patch = { autoStart: true };
  const second = f.store.access(patch);
  patch.autoStart = false; // A queued request owns its original patch.
  let readFinished = false;
  const read = f.store.access().then((value) => {
    readFinished = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(readFinished, false);
  assert.equal(f.store.background, false);
  assert.deepEqual(f.persisted(), savedDefaults);
  release();
  await first;
  await second;
  assert.deepEqual(await read, {
    background: true,
    autoStart: true,
    packaged: true,
  });
  assert.deepEqual(f.persisted(), { background: true, autoStart: true });
});

test("a failed queued save does not poison a subsequent save", async (t) => {
  let failures = 1;
  const f = fixture(t, {
    saved: savedDefaults,
    io: withIO({
      rename: async (...args) => {
        if (failures-- > 0) throw Error("transient rename failure");
        return fs.promises.rename(...args);
      },
    }),
  });
  const failed = assert.rejects(
    f.store.access({ autoStart: true }),
    /transient/,
  );
  const next = f.store.access({ background: true });
  await failed;
  assert.deepEqual(await next, {
    background: true,
    autoStart: false,
    packaged: true,
  });
  assert.deepEqual(f.persisted(), { background: true, autoStart: false });
});

test("macOS approval requirement remains visible instead of claiming autostart enabled", async (t) => {
  const f = fixture(t, { saved: savedDefaults });
  f.app.setLoginItemSettings = ({ openAtLogin }) => {
    f.system.openAtLogin = openAtLogin;
    f.system.status = openAtLogin ? "requires-approval" : "not-registered";
  };
  const result = await f.store.access({ autoStart: true });
  assert.equal(result.autoStart, false);
  assert.match(result.autoStartNote, /требует разрешения/);
  assert.equal((await f.store.access()).autoStart, false);
  assert.equal(f.persisted().autoStart, true); // Saved intent, not an OS-state claim.
});

test("Windows startup-disabled state and compensation preserve its effective value", async (t) => {
  const f = fixture(t, {
    platform: "win32",
    saved: savedDefaults,
    initial: { openAtLogin: true, executableWillLaunchAtLogin: false },
    io: withIO({
      rename: async () => {
        throw Error("rename failed");
      },
    }),
  });
  const initial = await f.store.access();
  assert.equal(initial.autoStart, false);
  assert.match(initial.autoStartNote, /выключен в настройках Windows/);
  await assert.rejects(f.store.access({ autoStart: true }), /rename failed/);
  assert.deepEqual(f.calls.at(-1), { openAtLogin: true, enabled: false });
  assert.equal((await f.store.access()).autoStart, false);
});

test("OS query failure is explicit instead of returning a stale cached value", async (t) => {
  const f = fixture(t, { saved: { background: false, autoStart: true } });
  f.app.getLoginItemSettings = () => {
    throw Error("OS query unavailable");
  };
  await assert.rejects(f.store.access(), /OS query unavailable/);
  assert.equal(f.calls.length, 0);
});

function closeFixture(preferences) {
  let quitting = false;
  const errors = [];
  const window = {
    hidden: false,
    destroyed: false,
    hideCount: 0,
    showCount: 0,
    hide() {
      this.hidden = true;
      this.hideCount++;
    },
    show() {
      this.hidden = false;
      this.showCount++;
    },
    focus() {},
    isDestroyed() {
      return this.destroyed;
    },
    close() {
      const event = {
        prevented: false,
        preventDefault() {
          this.prevented = true;
        },
      };
      const done = handler(event);
      if (!event.prevented) this.destroyed = true;
      return { event, done };
    },
  };
  const handler = createCloseHandler({
    preferences,
    window,
    isQuitting: () => quitting,
    reportFailure: async (error) => {
      errors.push(error.message);
    },
  });
  return {
    window,
    errors,
    quit: () => {
      quitting = true;
    },
  };
}

function gatedRename() {
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const arrived = new Promise((resolve) => {
    entered = resolve;
  });
  return {
    release,
    arrived,
    io: withIO({
      rename: async (...args) => {
        entered();
        const error = await gate;
        if (error) throw Error(error);
        return fs.promises.rename(...args);
      },
    }),
  };
}

test("close during background enable waits for persistence and deduplicates repeated X", async (t) => {
  const gate = gatedRename();
  const f = fixture(t, { saved: savedDefaults, io: gate.io });
  const close = closeFixture(f.store);
  const save = f.store.access({ background: true });
  assert.equal(f.store.isSaving, true);
  await gate.arrived;
  const first = close.window.close();
  const repeated = close.window.close();
  assert.equal(first.event.prevented, true);
  assert.equal(repeated.event.prevented, true);
  assert.equal(close.window.destroyed, false);
  assert.equal(close.window.hideCount, 0);
  gate.release();
  await save;
  await first.done;
  assert.equal(f.store.isSaving, false);
  assert.equal(close.window.destroyed, false);
  assert.equal(close.window.hideCount, 1);
  assert.deepEqual(close.errors, []);
});

test("close during background disable uses the committed result and then closes", async (t) => {
  const gate = gatedRename();
  const f = fixture(t, {
    saved: { background: true, autoStart: false },
    io: gate.io,
  });
  const close = closeFixture(f.store);
  const save = f.store.access({ background: false });
  await gate.arrived;
  const attempt = close.window.close();
  assert.equal(attempt.event.prevented, true);
  assert.equal(close.window.destroyed, false);
  gate.release();
  await save;
  await attempt.done;
  assert.equal(close.window.destroyed, true);
  assert.equal(close.window.hideCount, 0);
});

test("failed pending save cancels close and reports outside the renderer", async (t) => {
  const gate = gatedRename();
  const f = fixture(t, { saved: savedDefaults, io: gate.io });
  const close = closeFixture(f.store);
  const save = assert.rejects(
    f.store.access({ background: true }),
    /write denied/,
  );
  await gate.arrived;
  const attempt = close.window.close();
  gate.release("write denied");
  await save;
  await attempt.done;
  assert.equal(close.window.destroyed, false);
  assert.equal(close.window.hidden, false);
  assert.equal(close.window.showCount, 1);
  assert.equal(close.errors.length, 1);
  assert.match(close.errors[0], /write denied/);
  assert.equal(f.store.isSaving, false);
  assert.deepEqual(f.persisted(), savedDefaults);
});

test("normal close uses saved background preference without waiting or OS calls", async () => {
  for (const background of [true, false]) {
    const close = closeFixture({
      background,
      isSaving: false,
      waitForWrites: () => {
        throw Error("Unexpected wait");
      },
    });
    await close.window.close().done;
    assert.equal(close.window.hidden, background);
    assert.equal(close.window.destroyed, !background);
  }
});

test("explicit Quit bypasses a pending preference write", async () => {
  const close = closeFixture({
    background: true,
    isSaving: true,
    waitForWrites: () => {
      throw Error("Quit must not wait here");
    },
  });
  close.quit();
  const attempt = close.window.close();
  await attempt.done;
  assert.equal(attempt.event.prevented, false);
  assert.equal(close.window.destroyed, true);
  assert.deepEqual(close.errors, []);
});

test("explicit Quit during a deferred close is not reversed when saving finishes", async (t) => {
  const gate = gatedRename();
  const f = fixture(t, { saved: savedDefaults, io: gate.io });
  const close = closeFixture(f.store);
  const save = f.store.access({ background: true });
  await gate.arrived;
  const waiting = close.window.close();
  close.quit();
  const quitting = close.window.close();
  assert.equal(quitting.event.prevented, false);
  assert.equal(close.window.destroyed, true);
  gate.release();
  await save;
  await waiting.done;
  assert.equal(close.window.hideCount, 0);
  assert.equal(close.window.showCount, 0);
  assert.deepEqual(close.errors, []);
});
