function createCloseHandler({
  preferences,
  window,
  isQuitting,
  reportFailure,
  // Optional: async () => "background" | "close" | "cancel". Asked only when
  // background work is off, so closing never stops campaigns unannounced.
  confirmStop,
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
        return;
      }
      if (!confirmStop) return;
      event.preventDefault();
      waiting = true;
      try {
        const choice = await confirmStop();
        if (isQuitting() || window.isDestroyed()) return;
        if (choice === "background") {
          await preferences.access({ background: true });
          window.hide();
        } else if (choice === "close") {
          closeApproved = true;
          try {
            window.close();
          } finally {
            closeApproved = false;
          }
        }
      } catch (error) {
        if (!isQuitting() && !window.isDestroyed()) await reportFailure(error);
      } finally {
        waiting = false;
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
