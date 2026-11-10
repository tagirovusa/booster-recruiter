// Background work and start-at-login switches.
import React, { useEffect, useRef, useState } from "react";
import { t, tr } from "./i18n";

export function DesktopPreferences() {
  const [prefs, setPrefs] = useState(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState("load"),
    [saved, setSaved] = useState(false);
  const requestPending = useRef(false);
  const mounted = useRef(true);
  const load = async () => {
    if (requestPending.current) return;
    requestPending.current = true;
    setPending("load");
    setError("");
    setSaved(false);
    try {
      const result = await window.booster.desktopSettings();
      if (mounted.current) setPrefs(result);
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      requestPending.current = false;
      if (mounted.current) setPending("");
    }
  };
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async (patch) => {
    if (requestPending.current || !prefs) return;
    requestPending.current = true;
    const previous = prefs;
    setPending("save");
    setError("");
    setSaved(false);
    setPrefs({ ...prefs, ...patch });
    try {
      const result = await window.booster.desktopSettings(patch);
      if (mounted.current) {
        setPrefs(result);
        setSaved(true);
      }
    } catch (e) {
      if (mounted.current) {
        setPrefs(previous);
        setError(e.message);
      }
    } finally {
      requestPending.current = false;
      if (mounted.current) setPending("");
    }
  };
  return (
    <section
      className="panel preferences-card"
      aria-labelledby="background-settings-title"
    >
      <header className="settings-card-heading">
        <h2 id="background-settings-title">{t("Работа в фоне")}</h2>
        <p>{t("Выберите, когда приложение должно продолжать работу.")}</p>
      </header>
      {pending === "load" && (
        <p className="preference-status" role="status">
          {t("Загружаем настройки…")}
        </p>
      )}
      {error && (
        <div className="preference-error">
          <p role="alert">
            {prefs
              ? t(
                  "Не удалось подтвердить сохранение. Обновите настройки и проверьте переключатель.",
                )
              : t("Не удалось загрузить настройки. Попробуйте ещё раз.")}
          </p>
          <button className="button" disabled={Boolean(pending)} onClick={load}>
            {prefs ? t("Обновить настройки") : t("Попробовать ещё раз")}
          </button>
          <details className="technical-details">
            <summary>{t("Технические подробности")}</summary>
            <pre>{tr(error)}</pre>
          </details>
        </div>
      )}
      {prefs && (
        <>
          <label className="preference-row">
            <div className="preference-copy">
              <strong>{t("Продолжать работу после закрытия окна")}</strong>
              <small id="background-setting-help">
                {t(
                  "При включении этой настройки кампании продолжатся в фоне. Открыть окно можно через значок приложения.",
                )}
              </small>
            </div>
            <input
              className="preference-switch"
              type="checkbox"
              aria-label={t("Продолжать работу после закрытия окна")}
              aria-describedby="background-setting-help"
              checked={prefs.background}
              disabled={Boolean(pending)}
              onChange={(e) => save({ background: e.target.checked })}
            />
          </label>
          <label className="preference-row">
            <div className="preference-copy">
              <strong>{t("Запускать при входе в систему")}</strong>
              <small id="autostart-setting-help">
                {tr(prefs.autoStartNote) ||
                  (prefs.packaged
                    ? t(
                        "Приложение откроется автоматически после входа в компьютер.",
                      )
                    : t(
                        "Автозапуск доступен в установленной версии приложения.",
                      ))}
              </small>
            </div>
            <input
              className="preference-switch"
              type="checkbox"
              aria-label={t("Запускать при входе в систему")}
              aria-describedby="autostart-setting-help"
              checked={prefs.autoStart}
              disabled={!prefs.packaged || Boolean(pending)}
              onChange={(e) => save({ autoStart: e.target.checked })}
            />
          </label>
          {(pending === "save" || saved) && (
            <p className="preference-status" role="status">
              {pending === "save"
                ? t("Сохраняем настройку…")
                : t("Настройки сохранены.")}
            </p>
          )}
        </>
      )}
      <footer className="preference-footnote">
        {t(
          "Выполняются только утверждённые кампании и только в выбранные часы, пока компьютер включён и не спит. Чтобы полностью остановить приложение, выберите «Завершить работу» в меню его значка.",
        )}
      </footer>
    </section>
  );
}
