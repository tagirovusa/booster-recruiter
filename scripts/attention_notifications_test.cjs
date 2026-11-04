const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createAttentionNotifications,
} = require("../desktop/attention_notifications.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "booster-notify-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "notifications.json");
  let shown = [];
  const make = () =>
    createAttentionNotifications({
      filename,
      show: async (items) => shown.push(items),
    });
  return { filename, make, shown };
}
test("initial history is quiet; opt-in new events notify once across restarts", async (t) => {
  const f = fixture(t);
  let n = f.make();
  n.access({ enabled: true });
  await n.poll({ items: [{ id: "old" }] });
  assert.equal(f.shown.length, 0);
  await n.poll({ items: [{ id: "old" }, { id: "new", kind: "reply" }] });
  assert.equal(f.shown.length, 1);
  n = f.make();
  await n.poll({ items: [{ id: "new" }] });
  assert.equal(f.shown.length, 1);
});
test("disabled notifications retain a quiet baseline", async (t) => {
  const f = fixture(t);
  const n = f.make();
  await n.poll({ items: [] });
  await n.poll({ items: [{ id: "a" }] });
  n.access({ enabled: true });
  await n.poll({ items: [{ id: "a" }] });
  assert.equal(f.shown.length, 0);
  await n.poll({ items: [{ id: "a" }, { id: "b" }] });
  assert.equal(f.shown.length, 1);
});
test("an OS failure does not repeatedly redisplay the same event", async (t) => {
  const f = fixture(t);
  let attempts = 0;
  const n = createAttentionNotifications({
    filename: f.filename,
    show: async () => {
      attempts++;
      throw Error("OS unavailable");
    },
  });
  n.access({ enabled: true });
  await n.poll({ items: [] });
  await assert.rejects(n.poll({ items: [{ id: "event" }] }));
  await n.poll({ items: [{ id: "event" }] });
  assert.equal(attempts, 1);
});
test("invalid preferences fail without changing the saved setting", (t) => {
  const f = fixture(t);
  const n = f.make();
  assert.throws(() => n.access({ enabled: "yes" }));
  assert.throws(() => n.access({ enabled: true, other: 1 }));
  assert.equal(n.access().enabled, false);
});
test("a damaged notification preferences file cannot prevent app startup", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.filename, "broken");
  assert.equal(f.make().access().enabled, false);
});
test("a recovered account can notify on a later new interruption", async (t) => {
  const f = fixture(t);
  const n = f.make();
  n.access({ enabled: true });
  await n.poll({ items: [] });
  await n.poll({ items: [{ id: "login:a", kind: "login" }] });
  await n.poll({ items: [] });
  await n.poll({ items: [{ id: "login:a", kind: "login" }] });
  assert.equal(f.shown.length, 2);
});
