const test = require("node:test");
const assert = require("node:assert/strict");
const {
  commandTimeout,
  DEFAULT_TIMEOUT,
} = require("../desktop/command_timeouts.cjs");

test("slow commands wait longer than the default", () => {
  assert.equal(DEFAULT_TIMEOUT, 30000);
  assert.equal(commandTimeout("outreach.preview"), 240000);
  // The service allows 300 s for the sign-in check plus 90 s for the page.
  assert.ok(commandTimeout("account.open_profile") > 390000);
  assert.ok(commandTimeout("account.delete") >= 120000);
  assert.ok(commandTimeout("backup.restore") >= 180000);
});

test("other commands keep the default", () => {
  for (const op of ["state", "campaign.detail", "toString", "__proto__"])
    assert.equal(commandTimeout(op), DEFAULT_TIMEOUT, op);
});
