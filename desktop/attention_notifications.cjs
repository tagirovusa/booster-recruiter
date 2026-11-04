const fs = require("node:fs");
const path = require("node:path");

function createAttentionNotifications({ filename, show }) {
  let settings = { enabled: false, seen: [], initialized: false, active: [] };
  try {
    if (fs.existsSync(filename)) {
      const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (typeof saved.enabled === "boolean" && Array.isArray(saved.seen))
        settings = { ...settings, ...saved };
    }
  } catch {}
  function save(next) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = filename + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    fs.renameSync(temporary, filename);
    settings = next;
  }
  return {
    access(patch) {
      if (patch !== undefined) {
        if (
          !patch ||
          typeof patch.enabled !== "boolean" ||
          Object.keys(patch).some((k) => k !== "enabled")
        )
          throw Error("Некорректные настройки уведомлений.");
        save({ ...settings, enabled: patch.enabled });
      }
      return { enabled: settings.enabled };
    },
    async poll(summary) {
      const items = summary.items || [];
      const seen = new Set(settings.seen);
      const active = new Set(settings.active || []);
      const fresh = items.filter((item) =>
        item.kind === "reply" ? !seen.has(item.id) : !active.has(item.id),
      );
      const next = {
        ...settings,
        initialized: true,
        active: items.map((item) => item.id),
        seen: [
          ...new Set([...settings.seen, ...items.map((item) => item.id)]),
        ].slice(-2000),
      };
      const notify = settings.initialized && settings.enabled && fresh.length;
      // Persist before displaying, so an OS failure never creates a toast loop.
      if (
        fresh.length ||
        !settings.initialized ||
        JSON.stringify(next.active) !== JSON.stringify(settings.active)
      )
        save(next);
      if (notify) await show(fresh);
    },
  };
}
module.exports = { createAttentionNotifications };
