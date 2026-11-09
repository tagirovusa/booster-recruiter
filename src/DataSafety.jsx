import React, { useEffect, useRef, useState } from "react";
import "./safety.css";
import { formatDateTime, formatNumber, t, tr } from "./i18n";

const backupKinds = {
  daily: t("Ежедневная"),
  manual: t("Создана вручную"),
  before: t("Перед восстановлением"),
};
const formatSize = (bytes) =>
  bytes < 1024 * 1024
    ? t("{size} КБ", { size: Math.max(1, Math.round(bytes / 1024)) })
    : t("{size} МБ", {
        size: formatNumber(bytes / 1024 / 1024, { maximumFractionDigits: 1 }),
      });

export function NotificationsSettings() {
  const [value, setValue] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setValue(await window.booster.notificationSettings());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="panel settings-card">
      <header className="settings-card-heading">
        <h2>{t("Уведомления")}</h2>
        <p>{t("Только новые ответы и ситуации, где нужна ваша помощь.")}</p>
      </header>
      {!value && !error && <p className="safety-note">{t("Загружаем настройку…")}</p>}
      {value && (
        <label className="safety-toggle">
          <input
            type="checkbox"
            checked={value.enabled}
            disabled={busy}
            onChange={async (e) => {
              const enabled = e.target.checked;
              setBusy(true);
              try {
                setValue(
                  await window.booster.notificationSettings({ enabled }),
                );
                setError("");
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />{" "}
          {t("Показывать уведомления на компьютере")}
        </label>
      )}
      <p className="safety-note">
        {t("Имена и тексты сообщений в уведомления не попадают. Если они не появляются, разрешите уведомления Booster Recruiter в настройках системы.")}
      </p>
      {error && (
        <div role="alert">
          <p>{tr(error)}</p>
          <button className="button" onClick={load}>
            {t("Повторить")}
          </button>
        </div>
      )}
    </section>
  );
}

export function DataSafety({ onRestored }) {
  const confirmation = useRef(null);

  const [backups, setBackups] = useState(null),
    [pending, setPending] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(null);
  useEffect(() => {
    if (selected) {
      confirmation.current?.scrollIntoView({ block: "nearest" });
      confirmation.current?.focus();
    }
  }, [selected]);
  const load = async () => {
    try {
      const result = await window.booster.command("backup.list");
      setBackups(result.backups);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const run = async (op, params) => {
    setPending(op);
    setError("");
    setNotice("");
    try {
      await window.booster.command(op, params);
      setSelected(null);
      await load();
      setNotice(
        op === "backup.restore"
          ? t("Данные восстановлены. Войдите в аккаунты заново; кампании оставлены на паузе.")
          : t("Резервная копия сохранена."),
      );
      if (op === "backup.restore") await onRestored?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setPending("");
    }
  };
  return (
    <section className="panel settings-card">
      <header className="settings-card-heading">
        <h2>{t("Резервные копии")}</h2>
        <p>{t("Кампании, профили и история сохраняются на этом компьютере.")}</p>
      </header>
      <p className="safety-note">
        {t("Автоматическая копия создаётся ежедневно при работе приложения. Сессии LinkedIn и пароли в копии не входят. Копии на этом же диске не защищают от потери компьютера.")}
      </p>
      <button
        className="button"
        disabled={!!pending}
        onClick={() => run("backup.create")}
      >
        {pending === "backup.create" ? t("Сохраняем…") : t("Создать копию сейчас")}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert">
          <p>{tr(error)}</p>
          <button className="button" disabled={!!pending} onClick={load}>
            {t("Обновить список")}
          </button>
        </div>
      )}
      {backups === null && !error && (
        <p className="safety-note">{t("Загружаем список копий…")}</p>
      )}
      {backups?.length === 0 && (
        <p className="safety-note">
          {t("Копий пока нет. Первая появится автоматически сегодня, или создайте её кнопкой выше.")}
        </p>
      )}
      {backups?.length > 0 && (
        <ul className="backup-list">
          {backups.map((b) => (
            <li key={b.id}>
              <span>
                {formatDateTime(b.created)}
                <small>
                  {backupKinds[b.id.split("-")[0]] || t("Копия")} ·{" "}
                  {formatSize(b.bytes)}
                </small>
              </span>
              <button
                className="button small"
                disabled={!!pending}
                onClick={() => setSelected(b)}
              >
                {t("Восстановить")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div
          className="restore-confirm"
          ref={confirmation}
          tabIndex={-1}
          role="group"
          aria-label={t("Подтверждение восстановления")}
        >
          <h3>
            {t("Восстановить данные от {date}?", {
              date: formatDateTime(selected.created),
            })}
          </h3>
          <p>
            {t("Данные приложения вернутся к этой дате. Текущие данные мы сначала сохраним отдельной копией. После восстановления кампании будут на паузе, а в аккаунты LinkedIn нужно будет войти заново.")}
          </p>
          <div className="actions">
            <button
              className="button"
              disabled={!!pending}
              onClick={() => setSelected(null)}
            >
              {t("Отмена")}
            </button>
            <button
              className="button danger"
              disabled={!!pending}
              onClick={() =>
                run("backup.restore", { id: selected.id, confirm: true })
              }
            >
              {pending === "backup.restore"
                ? t("Восстанавливаем…")
                : t("Подтвердить восстановление")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default DataSafety;
