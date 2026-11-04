import React, { useEffect, useRef, useState } from "react";
import "./safety.css";

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
        <h2>Уведомления</h2>
        <p>Только новые ответы и ситуации, где нужна ваша помощь.</p>
      </header>
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
          Показывать уведомления на компьютере
        </label>
      )}
      <p className="safety-note">
        Имена и тексты сообщений в уведомления не попадают. Если они не
        появляются, разрешите уведомления Booster Recruiter в настройках
        системы.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button className="button" onClick={load}>
            Повторить
          </button>
        </div>
      )}
    </section>
  );
}

export function DataSafety({ onRestored }) {
  const confirmation = useRef(null);

  const [backups, setBackups] = useState([]),
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
          ? "Данные восстановлены. Войдите в аккаунты заново; кампании оставлены на паузе."
          : "Резервная копия сохранена.",
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
        <h2>Резервные копии</h2>
        <p>Кампании, профили и история сохраняются на этом компьютере.</p>
      </header>
      <p className="safety-note">
        Автоматическая копия создаётся ежедневно при работе приложения. Сессии
        LinkedIn и пароли в копии не входят. Копии на этом же диске не защищают
        от потери компьютера.
      </p>
      <button
        className="button"
        disabled={!!pending}
        onClick={() => run("backup.create")}
      >
        {pending === "backup.create" ? "Сохраняем…" : "Создать копию сейчас"}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button className="button" disabled={!!pending} onClick={load}>
            Обновить список
          </button>
        </div>
      )}
      {backups.length > 0 && (
        <ul className="backup-list">
          {backups.map((b) => (
            <li key={b.id}>
              <span>
                {new Date(b.created).toLocaleString("ru-RU")}
                <small>{Math.max(1, Math.round(b.bytes / 1024))} КБ</small>
              </span>
              <button
                className="button small"
                disabled={!!pending}
                onClick={() => setSelected(b)}
              >
                Восстановить
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
          aria-label="Подтверждение восстановления"
        >
          <h3>
            Восстановить данные от{" "}
            {new Date(selected.created).toLocaleString("ru-RU")}?
          </h3>
          <p>
            Текущие данные будут заменены. Перед заменой сохраним отдельную
            копию. Кампании будут остановлены, аккаунты потребуется подключить
            заново. Текущая история останется в копии перед восстановлением.
            Защита от повторного контакта сохранится. Для новой отправки
            потребуется новый предпросмотр.
          </p>
          <div className="actions">
            <button
              className="button"
              disabled={!!pending}
              onClick={() => setSelected(null)}
            >
              Отмена
            </button>
            <button
              className="button"
              disabled={!!pending}
              onClick={() =>
                run("backup.restore", { id: selected.id, confirm: true })
              }
            >
              {pending === "backup.restore"
                ? "Восстанавливаем…"
                : "Подтвердить восстановление"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default DataSafety;
