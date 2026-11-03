import React, { useEffect, useState } from "react";

const states = {
  planned: "Готов к обработке",
  waiting_acceptance: "Ждём принятия",
  waiting_credits: "Ожидаем кредиты",
  waiting_budget: "Ожидаем бюджет",
  needs_review: "Нужно проверить",
  sent: "Отправлено",
  replied: "Ответ получен",
  excluded: "Исключён",
  unavailable: "Недоступно",
  finished: "Наблюдение завершено",
  preview: "Предпросмотр",
  active: "Работает по расписанию",
  paused: "На паузе",
  completed: "Завершено",
  cancelled: "Отменено",
  submitting: "Выполняется",
  unknown: "Нужно проверить результат",
  blocked: "Не выполнено",
};
const relations = {
  unknown: "Связь ещё не подтверждена",
  connected: "В контактах · 1-й уровень",
  pending: "Приглашение ожидает принятия",
  not_connected: "Нет контакта",
  incoming: "Входящее приглашение",
  self: "Собственный профиль",
};
const kindNames = {
  invite: "Приглашение",
  message: "Обычное сообщение",
  inmail: "Платный InMail",
};
const date = (v) => (v ? new Date(v).toLocaleString("ru-RU") : "—");
export function ContactState({ person, member }) {
  const contact = member?.observation || person.data.contact || {};
  return (
    <div className="contact-state">
      <span className={"badge " + (member?.status || "neutral")}>
        {member
          ? states[member.status] || member.status
          : relations[contact.relationship] || relations.unknown}
      </span>
      {member && (
        <small>{relations[member.relationship] || relations.unknown}</small>
      )}
      {member?.detail && <small title={member.detail}>{member.detail}</small>}
      {(member?.checked_at || contact.checked_at) && (
        <small>
          Проверено: {date(member?.checked_at || contact.checked_at)}
        </small>
      )}
    </div>
  );
}

export function Automation({
  data,
  disabled,
  onSave,
  onCheck,
  onResume,
  onPause,
}) {
  const [rules, setRules] = useState(data.rules);
  useEffect(() => setRules(data.rules), [JSON.stringify(data.rules)]);
  const field = (key, value) => setRules((r) => ({ ...r, [key]: value }));
  const number = (key, label, min, max) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={rules[key]}
        onChange={(e) => field(key, Number(e.target.value))}
      />
    </label>
  );
  const active = data.runs.find((r) => ["active", "paused"].includes(r.status));
  return (
    <section className="panel templates">
      <div className="panel-title">
        <div>
          <h2>Как связываться с людьми</h2>
          <p>
            Сначала используется доступное бесплатное сообщение. Остальные
            действия — по вашим правилам.
          </p>
        </div>
        <button className="button" disabled={disabled} onClick={onCheck}>
          Проверить контакты сейчас
        </button>
      </div>
      {active && (
        <div className="automation-summary">
          <div>
            <b>{states[active.status]}</b>
            <p>
              {active.detail ||
                "Получатели и тексты сохранены. Новые профили автоматически не добавляются."}
            </p>
            <small>
              InMail: зарезервировано / использовано {active.credits_reserved}{" "}
              из {active.rules.inmail_budget}
            </small>
          </div>
          {active.status === "active" ? (
            <button className="button" onClick={onPause}>
              Приостановить кампанию
            </button>
          ) : (
            <button
              className="button primary"
              disabled={disabled}
              onClick={() => onResume(active.id)}
            >
              Продолжить утверждённую кампанию
            </button>
          )}
        </div>
      )}
      <fieldset disabled={disabled} className="automation-fields">
        <label className="check-option">
          <input
            type="checkbox"
            checked={rules.allow_invites}
            onChange={(e) => field("allow_invites", e.target.checked)}
          />
          <span>
            <b>Приглашать в контакты</b>
            <small>
              После принятия отправить утверждённое сообщение автоматически.
            </small>
          </span>
        </label>
        {rules.allow_invites && (
          <label className="field">
            <span>Текст приглашения · необязательно</span>
            <textarea
              rows={3}
              value={rules.invitation}
              onChange={(e) => field("invitation", e.target.value)}
              placeholder="Hi {first_name}, I'd like to connect regarding recruitment opportunities."
            />
            <small>
              До 200 символов после подстановки имени. Пустое поле — приглашение
              без заметки.
            </small>
          </label>
        )}
        <label className="check-option">
          <input
            type="checkbox"
            checked={rules.allow_inmail}
            onChange={(e) =>
              setRules((r) => ({
                ...r,
                allow_inmail: e.target.checked,
                inmail_budget: e.target.checked
                  ? r.inmail_budget || 5
                  : r.inmail_budget,
              }))
            }
          />
          <span>
            <b>Разрешить платный InMail</b>
            <small>
              Использует кредиты LinkedIn. Программа не покупает дополнительные
              кредиты.
            </small>
          </span>
        </label>
        {rules.allow_inmail && (
          <div className="inmail-settings">
            <div className="template-grid">
              <label className="field">
                <span>Режим InMail</span>
                <select
                  value={rules.strategy}
                  onChange={(e) => field("strategy", e.target.value)}
                >
                  <option value="economy">
                    Экономный · сначала приглашение
                  </option>
                  <option value="fast">Быстрый · сразу InMail</option>
                </select>
              </label>
              {number(
                "inmail_budget",
                "Максимум кредитов на эту кампанию",
                1,
                1000,
              )}
            </div>
            {rules.strategy === "economy" &&
              number("wait_days", "Дней ожидания принятия перед InMail", 1, 60)}
            <div className="template-grid">
              {["open", "neutral"].map((s) => (
                <label className="field" key={s}>
                  <span>
                    Тема InMail ·{" "}
                    {s === "open" ? "Open to Work" : "нейтральное"}
                  </span>
                  <input
                    value={rules["subject_" + s]}
                    onChange={(e) => field("subject_" + s, e.target.value)}
                    placeholder="Recruitment opportunity"
                    maxLength={4000}
                  />
                </label>
              ))}
            </div>
            <details>
              <summary>Отдельные тексты InMail</summary>
              <p>
                По умолчанию используются тексты из вкладки «Шаблоны сообщений».
              </p>
              <div className="template-grid">
                {["open", "neutral"].map((s) => (
                  <label className="field" key={s}>
                    <span>
                      {s === "open" ? "Open to Work" : "Нейтральный InMail"}
                    </span>
                    <textarea
                      rows={5}
                      value={rules["inmail_" + s]}
                      onChange={(e) => field("inmail_" + s, e.target.value)}
                      placeholder="Оставьте пустым, чтобы использовать основной текст"
                    />
                  </label>
                ))}
              </div>
            </details>
          </div>
        )}
        <h3>Расписание и бюджеты</h3>
        <p>
          Проверки и отправка работают, пока приложение запущено и компьютер не
          спит. Бюджеты приложения не являются лимитами LinkedIn.
        </p>
        <div className="automation-grid">
          <label className="field">
            <span>Часовой пояс</span>
            <input
              value={rules.timezone}
              onChange={(e) => field("timezone", e.target.value)}
            />
          </label>
          {number("start_hour", "Начало работы · час", 0, 23)}
          {number("end_hour", "Окончание работы · час", 1, 24)}
          {number("check_hours", "Проверять каждые · часы", 1, 72)}
          {number("monitor_days", "Наблюдать за ответами · дней", 1, 90)}
        </div>
        <div className="automation-grid">
          {number("daily_invites", "Приглашений за сутки UTC", 1, 100)}
          {number("daily_messages", "Обычных сообщений за сутки UTC", 1, 200)}
          {number("daily_inmails", "InMail за сутки UTC", 1, 100)}
        </div>
        <small>
          Считаются попытки по всем кампаниям отправителя. При разных настройках
          действует меньший утверждённый бюджет.
        </small>
        <div className="hint">
          Любой ответ останавливает обращения к этому человеку. Неясный
          результат не повторяется автоматически. Изменение настроек отменяет
          прежний план и требует нового предпросмотра.
        </div>
        <button className="button primary" onClick={() => onSave(rules)}>
          Сохранить правила
        </button>
      </fieldset>
    </section>
  );
}

export function OutreachHistory({
  runs,
  disabled,
  onResolve,
  onResume,
  onOpen,
}) {
  const visible = runs.filter((r) => r.status !== "preview");
  if (!visible.length) return null;
  return (
    <section className="panel outreach-history">
      <div className="panel-title">
        <div>
          <h2>Приглашения и сообщения</h2>
          <p>
            «Отправлено» означает подтверждение в LinkedIn; это не подтверждение
            прочтения.
          </p>
        </div>
      </div>
      {visible.map((run) => (
        <div key={run.id} className="outreach-run">
          <div className="toolbar">
            <b>
              {states[run.status]} · {date(run.created)}
            </b>
            <span>
              Получателей: {run.members.length} · InMail: {run.credits_reserved}
              /{run.rules.inmail_budget}
            </span>
            {run.status === "paused" && (
              <button
                className="button"
                disabled={disabled}
                onClick={() => onResume(run.id)}
              >
                Продолжить кампанию
              </button>
            )}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>Состояние</th>
                  <th>Следующая проверка</th>
                  <th>Причина</th>
                </tr>
              </thead>
              <tbody>
                {run.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <button
                        className="text-link"
                        onClick={() => onOpen(m.url)}
                      >
                        {m.name || m.url}
                      </button>
                    </td>
                    <td>{states[m.status] || m.status}</td>
                    <td>
                      {[
                        "sent",
                        "waiting_acceptance",
                        "waiting_budget",
                        "waiting_credits",
                        "planned",
                      ].includes(m.status)
                        ? date(m.next_check)
                        : "—"}
                    </td>
                    <td>
                      {m.detail}
                      {m.reply_text && <blockquote>{m.reply_text}</blockquote>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.actions.map((a) => {
            const m = run.members.find((m) => m.id === a.member_id);
            return (
              <details className="action-record" key={a.id}>
                <summary>
                  {kindNames[a.kind]} · {m?.name || a.url} · {states[a.status]}{" "}
                  · {date(a.created)}
                </summary>
                <p>{a.detail}</p>
                {a.kind === "inmail" && <b>Тема: {m?.subject}</b>}
                <pre>
                  {a.kind === "invite"
                    ? m?.invitation || "Приглашение без заметки"
                    : a.kind === "inmail"
                      ? m?.inmail_message
                      : m?.message}
                </pre>
                {a.status === "unknown" && (
                  <div className="actions">
                    <button className="button" onClick={() => onOpen(a.url)}>
                      Открыть LinkedIn
                    </button>
                    <button
                      className="button"
                      disabled={disabled}
                      onClick={() => onResolve(a.id, true)}
                    >
                      Проверено:{" "}
                      {a.kind === "invite" ? "приглашение" : "сообщение"}{" "}
                      отправлено
                    </button>
                    <button
                      className="button"
                      disabled={disabled}
                      onClick={() => onResolve(a.id, false)}
                    >
                      Проверено: не отправлено
                    </button>
                  </div>
                )}
              </details>
            );
          })}
        </div>
      ))}
    </section>
  );
}

export function DesktopPreferences() {
  const [prefs, setPrefs] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    window.booster
      .desktopSettings()
      .then(setPrefs)
      .catch((e) => setError(e.message));
  }, []);
  const save = async (patch) => {
    const previous = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
      setPrefs(await window.booster.desktopSettings(patch));
      setError("");
    } catch (e) {
      setPrefs(previous);
      setError(e.message);
    }
  };
  return (
    <section className="panel templates">
      <h2>Работа в фоне</h2>
      {error && <p role="alert">{error}</p>}
      {prefs && (
        <>
          <label className="check-option">
            <input
              type="checkbox"
              checked={prefs.background}
              onChange={(e) => save({ background: e.target.checked })}
            />
            <span>Продолжать работу после закрытия окна</span>
          </label>
          <label className="check-option">
            <input
              type="checkbox"
              checked={prefs.autoStart}
              disabled={!prefs.packaged}
              onChange={(e) => save({ autoStart: e.target.checked })}
            />
            <span>Запускать при входе в систему</span>
          </label>
          <p>
            Работа продолжается только для утверждённых кампаний и в выбранные
            часы. Для полной остановки выберите «Завершить работу» в меню значка
            приложения.
          </p>
        </>
      )}
    </section>
  );
}
