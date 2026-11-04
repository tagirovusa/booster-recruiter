function createCloseHandler({
  preferences,
  window,
  isQuitting,
  reportFailure,
}) {
  let waiting = false;
  let closeApproved = false;
  return async function onClose(event) {
    // Explicit Quit uses the application's existing shutdown path.
    if (isQuitting() || closeApproved) return;
    if (waiting) {
      event.preventDefault();
      return;
    }
    if (!preferences.isSaving) {
      if (preferences.background) {
        event.preventDefault();
        window.hide();
      }
      return;
    }
    event.preventDefault();
    waiting = true;
    try {
      await preferences.waitForWrites();
      if (isQuitting() || window.isDestroyed()) return;
      if (preferences.background) window.hide();
      else {
        closeApproved = true;
        try {
          window.close();
        } finally {
          closeApproved = false;
        }
      }
    } catch (error) {
      if (!isQuitting() && !window.isDestroyed()) {
        window.show();
        window.focus();
        await reportFailure(error);
      }
    } finally {
      waiting = false;
    }
  };
}

module.exports = { createCloseHandler };
