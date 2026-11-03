import React, { useEffect, useState } from "react";
import {
  UserRoundPlus,
  UserRound,
  Users,
  Clock3,
  Zap,
  Check,
  CheckCircle2,
  ChevronDown,
  SlidersHorizontal,
  RefreshCw,
  MessageSquare,
  ArrowLeft,
  ArrowRight,
  Wallet,
  Monitor,
  Pause,
  Play,
} from "lucide-react";

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
  campaign,
  account,
  selected,
  disabled,
  onSave,
  onCheck,
  onResume,
  onPause,
  onCheckNow,
  onPeople,
  onAccounts,
}) {
  const [rules, setRules] = useState(data.rules);
  const [texts, setTexts] = useState({
    open: campaign.template_open,
    neutral: campaign.template_neutral,
  });
  const [step, setStep] = useState(0);
  useEffect(() => setRules(data.rules), [JSON.stringify(data.rules)]);
  useEffect(
    () =>
      setTexts({
        open: campaign.template_open,
        neutral: campaign.template_neutral,
      }),
    [campaign.id, campaign.template_open, campaign.template_neutral],
  );
  const field = (key, value) => setRules((r) => ({ ...r, [key]: value }));
  const mode = !rules.allow_inmail
    ? "free"
    : rules.strategy === "fast"
      ? "fast"
      : "economy";
  const modes = [
    {
      id: "free",
      icon: UserRoundPlus,
      title: "Без InMail",
      tag: "Без расхода кредитов",
      description: "Бесплатное сообщение или приглашение в контакты.",
    },
    {
      id: "economy",
      icon: Clock3,
      title: "Экономить кредиты",
      tag: "Сначала знакомство",
      description: "InMail, только если приглашение не приняли.",
    },
    {
      id: "fast",
      icon: Zap,
      title: "Связаться быстрее",
      tag: "InMail без ожидания",
      description: "Сразу InMail, если бесплатное сообщение недоступно.",
    },
  ];
  const choose = (id) =>
    setRules((r) => ({
      ...r,
      allow_inmail: id !== "free",
      inmail_channel:
        !r.allow_inmail && account?.services?.recruiter?.status === "ready"
          ? "recruiter"
          : r.inmail_channel || "linkedin",
      strategy: id === "fast" ? "fast" : "economy",
      inmail_budget: id !== "free" ? r.inmail_budget || 5 : r.inmail_budget,
    }));
  const active = data.runs.find((r) => ["active", "paused"].includes(r.status));
  const [editing, setEditing] = useState(!active);
  useEffect(() => {
    setEditing(!active?.id);
  }, [active?.id]);
  const dirty =
    JSON.stringify(rules) !== JSON.stringify(data.rules) ||
    texts.open !== campaign.template_open ||
    texts.neutral !== campaign.template_neutral;
  const peopleLabel = {
    one: "кандидат",
    few: "кандидата",
    many: "кандидатов",
    other: "кандидата",
  }[new Intl.PluralRules("ru").select(selected.length)];
  const openCount = selected.filter((p) => p.segment === "open").length;
  const neutralCount = selected.filter((p) => p.segment === "neutral").length;
  const missingText =
    (openCount > 0 && !texts.open.trim()) ||
    (neutralCount > 0 && !texts.neutral.trim());
  const missingSubject =
    rules.allow_inmail &&
    ((openCount > 0 && !rules.subject_open.trim()) ||
      (neutralCount > 0 && !rules.subject_neutral.trim()));
  const recruiterReady =
    account?.services?.recruiter?.status === "ready" &&
    account.services.recruiter.manual_texts;
  const canReview =
    selected.length > 0 &&
    !missingText &&
    !missingSubject &&
    (!rules.allow_inmail || rules.inmail_budget > 0) &&
    (!rules.allow_inmail ||
      rules.inmail_channel !== "recruiter" ||
      recruiterReady);
  const times = (n) => String(n).padStart(2, "0") + ":00";
  const zones = [
    ...new Set([
      rules.timezone,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      "America/Chicago",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/Kyiv",
      "Europe/Warsaw",
      "Asia/Tbilisi",
      "UTC",
    ]),
  ];
  const zoneNames = {
    "America/Chicago": "Чикаго",
    "America/New_York": "Нью-Йорк",
    "America/Los_Angeles": "Лос-Анджелес",
    "Europe/Kyiv": "Киев",
    "Europe/Warsaw": "Варшава",
    "Asia/Tbilisi": "Тбилиси",
    UTC: "UTC",
  };
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
  const flow = [
    {
      title: "Проверить возможность сообщения",
      text: "Если можно написать бесплатно — используем ваш текст.",
    },
    ...(mode === "fast"
      ? [
          {
            title: "Отправить InMail",
            text: "Только при доступных кредитах и в пределах бюджета.",
          },
        ]
      : []),
    ...(rules.allow_invites
      ? [
          {
            title: "Пригласить в контакты",
            text: "После принятия автоматически отправить сообщение.",
          },
        ]
      : []),
    ...(mode === "economy"
      ? [
          {
            title: rules.allow_invites
              ? `Подождать ${rules.wait_days} дн. и отправить InMail`
              : "Отправить InMail",
            text: "Если бесплатное сообщение всё ещё недоступно.",
          },
        ]
      : []),
    {
      title: "Дождаться ответа",
      text: "Ответ появится в истории. Дальнейшие обращения остановятся.",
    },
  ];
  const counts = active
    ? {
        waiting: active.members.filter((m) => m.status === "waiting_acceptance")
          .length,
        sent: active.members.filter((m) =>
          ["sent", "replied", "finished"].includes(m.status),
        ).length,
        replied: active.members.filter((m) => m.status === "replied").length,
      }
    : null;
  return (
    <div className="automation-workspace">
      {active && (
        <section className="panel automation-live">
          <div className="automation-live-heading">
            <div>
              <span className="eyebrow">КАМПАНИЯ</span>
              <h2>{states[active.status]}</h2>
              <p>
                {active.detail ||
                  "Программа проверяет контакты и выполняет утверждённый план."}
              </p>
            </div>
            <button
              className="button"
              disabled={disabled && active.status !== "active"}
              onClick={() =>
                active.status === "active" ? onPause() : onResume(active.id)
              }
            >
              {active.status === "active" ? (
                <Pause size={16} />
              ) : (
                <Play size={16} />
              )}
              {active.status === "active" ? "Пауза" : "Продолжить"}
            </button>
          </div>
          <div className="automation-results">
            <div>
              <strong>{counts.waiting}</strong>
              <span>Ждём принятия</span>
            </div>
            <div>
              <strong>{counts.sent}</strong>
              <span>Сообщения отправлены</span>
            </div>
            <div>
              <strong>{counts.replied}</strong>
              <span>Ответы получены</span>
            </div>
          </div>
          {active.status === "active" && (
            <button
              className="button"
              disabled={disabled}
              onClick={() => onCheckNow(active.id)}
            >
              <RefreshCw size={16} /> Проверить сейчас и продолжить план
            </button>
          )}
          <button className="text-link" onClick={() => setEditing(!editing)}>
            {editing ? "Скрыть настройки" : "Изменить настройки кампании"}
            <ChevronDown size={14} />
          </button>
        </section>
      )}
      {editing && (
        <div className="automation-layout">
          <section className="panel setup-panel">
            <header className="setup-heading">
              <span className="eyebrow">НАСТРОЙКА АВТОМАТИЗАЦИИ</span>
              <h2>От знакомства — к разговору</h2>
              <p>
                Выберите подход и задайте тексты. Остальную последовательность
                выполнит программа.
              </p>
            </header>
            <nav
              className="setup-steps"
              aria-label="Шаги настройки автоматизации"
            >
              {["Способ связи", "Сообщения", "Проверка запуска"].map(
                (label, i) => (
                  <button
                    key={label}
                    className={
                      step === i ? "current" : step > i ? "complete" : ""
                    }
                    aria-current={step === i ? "step" : undefined}
                    disabled={disabled || (i === 2 && !canReview)}
                    onClick={() =>
                      i === 2 ? onSave(rules, texts, true) : setStep(i)
                    }
                  >
                    <span>{step > i ? <Check size={13} /> : i + 1}</span>
                    {label}
                  </button>
                ),
              )}
            </nav>
            <fieldset disabled={disabled} className="setup-body">
              {step === 0 ? (
                <>
                  <div className="setup-section-title">
                    <h3>Как связываться с кандидатами?</h3>
                    <p>
                      Доступное бесплатное сообщение всегда используется первым.
                    </p>
                  </div>
                  <div
                    className="strategy-options"
                    role="radiogroup"
                    aria-label="Способ связи"
                  >
                    {modes.map(
                      ({ id, icon: Icon, title, tag, description }) => (
                        <label
                          className={
                            "strategy-choice " + (mode === id ? "chosen" : "")
                          }
                          key={id}
                        >
                          <input
                            type="radio"
                            name="outreach-mode"
                            value={id}
                            checked={mode === id}
                            onChange={() => choose(id)}
                          />
                          <span className="strategy-icon">
                            <Icon size={20} />
                          </span>
                          <span className="strategy-copy">
                            <strong>{title}</strong>
                            <small>{description}</small>
                          </span>
                          <span className="strategy-tag">{tag}</span>
                          <span className="strategy-indicator">
                            {mode === id && <Check size={12} />}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                  {rules.allow_inmail && (
                    <div className="credit-budget">
                      <div>
                        <h3>Сколько кредитов можно использовать?</h3>
                        <p>
                          InMail расходует кредиты вашей подписки. Покупок
                          дополнительных кредитов не будет.
                        </p>
                      </div>
                      <label className="field">
                        <span>Подписка для InMail</span>
                        <select
                          value={rules.inmail_channel || "linkedin"}
                          onChange={(e) =>
                            field("inmail_channel", e.target.value)
                          }
                        >
                          <option value="linkedin">LinkedIn Premium</option>
                          <option value="recruiter">LinkedIn Recruiter</option>
                        </select>
                      </label>
                      {rules.inmail_channel === "recruiter" &&
                        !recruiterReady && (
                          <div className="hint warning">
                            Подключите Recruiter и разрешите отправку ваших
                            текстов в аккаунте отправителя.{" "}
                            <button className="text-link" onClick={onAccounts}>
                              Открыть аккаунты
                            </button>
                          </div>
                        )}
                      {number(
                        "inmail_budget",
                        "Бюджет InMail · кредитов",
                        1,
                        1000,
                      )}
                      {mode === "economy" &&
                        rules.allow_invites &&
                        number("wait_days", "Ждать принятия · дней", 1, 60)}
                    </div>
                  )}
                  <details className="setup-details">
                    <summary>
                      <span>
                        <UserRoundPlus size={17} />
                        <b>Приглашения в контакты</b>
                      </span>
                      <small>
                        {rules.allow_invites
                          ? rules.invitation.trim()
                            ? "С вашей заметкой"
                            : "Без заметки"
                          : "Выключены"}
                      </small>
                      <ChevronDown size={16} />
                    </summary>
                    <div className="details-body">
                      <label className="check-option">
                        <input
                          type="checkbox"
                          checked={rules.allow_invites}
                          onChange={(e) =>
                            field("allow_invites", e.target.checked)
                          }
                        />
                        <span>
                          <b>Приглашать в контакты</b>
                          <small>
                            После принятия программа отправит утверждённый
                            текст.
                          </small>
                        </span>
                      </label>
                      {rules.allow_invites && (
                        <label className="field">
                          <span>Текст приглашения · необязательно</span>
                          <textarea
                            rows={3}
                            value={rules.invitation}
                            onChange={(e) =>
                              field("invitation", e.target.value)
                            }
                            placeholder="Можно оставить пустым"
                          />
                          <small>
                            До 200 символов с учётом подставленного имени.
                          </small>
                        </label>
                      )}
                    </div>
                  </details>
                  <details className="setup-details advanced-settings">
                    <summary>
                      <span>
                        <SlidersHorizontal size={17} />
                        <b>Дополнительные настройки</b>
                      </span>
                      <small>
                        {times(rules.start_hour)}–{times(rules.end_hour)}
                      </small>
                      <ChevronDown size={16} />
                    </summary>
                    <div className="details-body">
                      <h3>Когда работать</h3>
                      <div className="settings-row">
                        <label className="field">
                          <span>Часовой пояс</span>
                          <select
                            value={rules.timezone}
                            onChange={(e) => field("timezone", e.target.value)}
                          >
                            {zones.map((z) => (
                              <option key={z} value={z}>
                                {zoneNames[z] || z}
                              </option>
                            ))}
                          </select>
                        </label>
                        {["start_hour", "end_hour"].map((key) => (
                          <label className="field" key={key}>
                            <span>
                              {key === "start_hour"
                                ? "Начинать в"
                                : "Заканчивать в"}
                            </span>
                            <select
                              value={rules[key]}
                              onChange={(e) =>
                                field(key, Number(e.target.value))
                              }
                            >
                              {Array.from(
                                { length: 24 },
                                (_, i) => i + (key === "end_hour" ? 1 : 0),
                              ).map((n) => (
                                <option value={n} key={n}>
                                  {times(n)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                      <h3>Дневные ограничения</h3>
                      <div className="settings-row">
                        {number("daily_invites", "Приглашений", 1, 100)}
                        {number("daily_messages", "Сообщений", 1, 200)}
                        {number("daily_inmails", "InMail", 1, 100)}
                      </div>
                      <p className="settings-footnote">
                        Общие для всех кампаний отправителя. Сутки считаются по
                        UTC. Это настройки приложения, а не официальные лимиты
                        LinkedIn.
                      </p>
                      <div className="settings-row">
                        {number(
                          "check_hours",
                          "Проверять контакты каждые · ч",
                          1,
                          72,
                        )}
                        {number(
                          "monitor_days",
                          "Следить за ответами · дней",
                          1,
                          90,
                        )}
                      </div>
                      <button className="button small" onClick={onCheck}>
                        <RefreshCw size={14} />
                        Проверить контакты сейчас
                      </button>
                    </div>
                  </details>
                </>
              ) : (
                <>
                  <div className="setup-section-title">
                    <h3>Что получат кандидаты?</h3>
                    <p>
                      Для каждой группы — свой текст. Программа подставит имя и
                      покажет итог перед запуском.
                    </p>
                  </div>
                  <div className="setup-message-grid">
                    {["open", "neutral"].map((segment) => (
                      <div className="setup-message-card" key={segment}>
                        <div className="message-group-title">
                          <span className={"group-dot " + segment} />
                          <strong>
                            {segment === "open"
                              ? "Open to Work"
                              : "Нейтральное сообщение"}
                          </strong>
                          <small>
                            {segment === "open" ? openCount : neutralCount}{" "}
                            выбрано
                          </small>
                        </div>
                        <p>
                          {segment === "open"
                            ? "Для людей с подтверждённой рамкой."
                            : "Для остальных выбранных профилей."}
                        </p>
                        {rules.allow_inmail && (
                          <label className="field">
                            <span>
                              Тема InMail ·{" "}
                              {segment === "open"
                                ? "Open to Work"
                                : "нейтральное"}
                            </span>
                            <input
                              value={rules["subject_" + segment]}
                              onChange={(e) =>
                                field("subject_" + segment, e.target.value)
                              }
                              placeholder="Например: Recruitment opportunity"
                            />
                          </label>
                        )}
                        <label className="field">
                          <span className="sr-only">
                            Сообщение ·{" "}
                            {segment === "open"
                              ? "Open to Work"
                              : "нейтральное"}
                          </span>
                          <textarea
                            rows={7}
                            value={texts[segment]}
                            onChange={(e) =>
                              setTexts((t) => ({
                                ...t,
                                [segment]: e.target.value,
                              }))
                            }
                            placeholder={
                              segment === "open"
                                ? "Hi {first_name}, I noticed you are open to opportunities…"
                                : "Hi {first_name}, would you be interested in discussing…"
                            }
                          />
                          <small>
                            <code>{"{first_name}"}</code> заменится на имя
                            кандидата
                          </small>
                        </label>
                      </div>
                    ))}
                  </div>
                  {rules.allow_inmail && (
                    <details className="setup-details">
                      <summary>
                        <span>
                          <MessageSquare size={17} />
                          <b>Другой текст для InMail</b>
                        </span>
                        <small>
                          {rules.inmail_open || rules.inmail_neutral
                            ? "Настроен отдельно"
                            : "Используем основной"}
                        </small>
                        <ChevronDown size={16} />
                      </summary>
                      <div className="details-body">
                        <p>
                          Оставьте поля пустыми, чтобы использовать сообщения
                          выше.
                        </p>
                        <div className="setup-message-grid">
                          {["open", "neutral"].map((s) => (
                            <label className="field" key={s}>
                              <span>
                                {s === "open"
                                  ? "InMail · Open to Work"
                                  : "Нейтральный InMail"}
                              </span>
                              <textarea
                                rows={4}
                                value={rules["inmail_" + s]}
                                onChange={(e) =>
                                  field("inmail_" + s, e.target.value)
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </details>
                  )}
                  {active && (
                    <p className="setup-caution">
                      Сохранение изменений заменит текущий план. Запуск нужно
                      будет подтвердить заново.
                    </p>
                  )}
                </>
              )}
              <footer className="setup-footer">
                <div>
                  <button
                    className="button"
                    onClick={() =>
                      step ? setStep(0) : onSave(rules, texts, false)
                    }
                  >
                    {step ? (
                      <>
                        <ArrowLeft size={15} />
                        Назад
                      </>
                    ) : (
                      "Сохранить настройки"
                    )}
                  </button>
                  {step === 1 && (
                    <button
                      className="text-link"
                      onClick={() => onSave(rules, texts, false)}
                    >
                      Сохранить без запуска
                    </button>
                  )}
                </div>
                <button
                  className="button primary"
                  disabled={disabled || (step === 1 && !canReview)}
                  onClick={() =>
                    step ? onSave(rules, texts, true) : setStep(1)
                  }
                >
                  {step ? "Проверить запуск" : "Далее: сообщения"}
                  <ArrowRight size={16} />
                </button>
              </footer>
              {step === 1 && !canReview && (
                <p className="setup-validation" role="status">
                  {!selected.length
                    ? "Сначала выберите кандидатов для этой кампании."
                    : missingText
                      ? "Добавьте текст для каждой выбранной группы."
                      : missingSubject
                        ? "Добавьте тему InMail для каждой выбранной группы."
                        : "Укажите бюджет InMail не меньше одного кредита."}
                </p>
              )}
            </fieldset>
          </section>
          <aside className="automation-plan">
            <section className="panel plan-card">
              <div className="plan-heading">
                <span className="eyebrow">ВАШ ПЛАН</span>
                <span
                  role="status"
                  className={"save-indicator " + (dirty ? "unsaved" : "")}
                >
                  {dirty ? "Есть изменения" : "Сохранено"}
                </span>
              </div>
              <h3>{modes.find((m) => m.id === mode).title}</h3>
              <div className="plan-account">
                <Users size={16} />
                <div>
                  <strong>
                    {selected.length} {peopleLabel}
                  </strong>
                  <button className="text-link" onClick={onPeople}>
                    {selected.length ? "Изменить выбор" : "Выбрать кандидатов"}
                  </button>
                </div>
              </div>
              <ol className="plan-flow">
                {flow.map((item, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    <div>
                      <b>{item.title}</b>
                      <p>{item.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="plan-meta">
                <p>
                  <UserRound size={14} />
                  <span>
                    Отправитель: <b>{account?.label || "Не выбран"}</b>
                  </span>
                </p>
                <p>
                  <Clock3 size={14} />
                  <span>
                    {times(rules.start_hour)}–{times(rules.end_hour)} ·{" "}
                    {zoneNames[rules.timezone] || rules.timezone}
                  </span>
                </p>
                {rules.allow_inmail && (
                  <p>
                    <Wallet size={14} />
                    <span>
                      До <b>{rules.inmail_budget}</b> InMail-кредитов
                    </span>
                  </p>
                )}
              </div>
            </section>
            <p className="plan-note">
              <Monitor size={15} />
              <span>
                Оставьте приложение запущенным, а компьютер — включённым.
              </span>
            </p>
            <p className="plan-note">
              <CheckCircle2 size={15} />
              <span>
                Перед запуском вы проверите получателей и точные тексты.
              </span>
            </p>
          </aside>
        </div>
      )}
    </div>
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
