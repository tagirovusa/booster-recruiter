// How long the window waits for a service command. Most commands answer at
// once; these wait for LinkedIn pages or stop browser workers first, so a
// shorter limit would report "took too long" while the action still succeeds.
const DEFAULT_TIMEOUT = 30000;
const TIMEOUTS = {
  "outreach.preview": 240000,
  // Sign-in check (up to 300 s) plus opening the profile (up to 90 s).
  "account.open_profile": 420000,
  // Stops the account's browser workers (up to 16 s each).
  "account.delete": 120000,
  // Stops every browser worker before replacing the database.
  "backup.restore": 180000,
};

function commandTimeout(op) {
  return Object.hasOwn(TIMEOUTS, op) ? TIMEOUTS[op] : DEFAULT_TIMEOUT;
}

module.exports = { commandTimeout, DEFAULT_TIMEOUT };
