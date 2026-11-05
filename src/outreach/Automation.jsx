// Outreach setup for one campaign: contact mode, texts and launch check,
// plus the live panel of a running plan.
import React, { useEffect, useRef, useState } from "react";
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
  LoaderCircle,
} from "lucide-react";
import { plural } from "../text";
import {
  characterCount,
  currentRules,
  draftMatchesRules,
  validateTemplate,
  outreachCounts,
  campaignNextEvent,
} from "./rules";
import { TemplateFeedback, DetailMessage } from "./parts";

export function Automation({
  data,
  campaign,
  account,
  selected,
  disabled,
  previewing = false,
  onSave,
  onCheck,
  onResume,
  onPause,
  onCheckNow,
  onPeople,
  onHistory,
  onAccounts,
  initialDraft,
  onDraftChange,
  draftPersisted = false,
}) {
  const draft =
    draftMatchesRules(initialDraft?.baseRules, data.rules) &&
    initialDraft?.baseTexts ===
      JSON.stringify([campaign.template_open, campaign.template_neutral])
      ? initialDraft
      : null;
  const serverRules = useRef(JSON.stringify(data.rules));
  const serverTexts = useRef(
    JSON.stringify([campaign.template_open, campaign.template_neutral]),
  );
  const [rules, setRules] = useState(currentRules(draft?.rules || data.rules));
  const [texts, setTexts] = useState({
    open: draft?.texts.open ?? campaign.template_open,
    neutral: draft?.texts.neutral ?? campaign.template_neutral,
  });
  const [step, setStep] = useState(0);
  useEffect(() => {
    const next = JSON.stringify(data.rules);
    if (serverRules.current !== next) {
      serverRules.current = next;
      setRules(data.rules);
    }
  }, [JSON.stringify(data.rules)]);
  useEffect(() => {
    const next = JSON.stringify([
      campaign.template_open,
      campaign.template_neutral,
    ]);
    if (serverTexts.current !== next) {
      serverTexts.current = next;
      setTexts({
        open: campaign.template_open,
        neutral: campaign.template_neutral,
      });
    }
  }, [campaign.template_open, campaign.template_neutral]);
  const field = (key, value) => setRules((r) => ({ ...r, [key]: value }));
  // Two plain choices first; the InMail timing only matters once paid
  // InMail is allowed, so it lives inside that choice.
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
      tag: "Рекомендуем",
      description: rules.allow_invites
        ? "Бесплатное сообщение, а если нельзя — приглашение в контакты."
        : "Только бесплатное сообщение. Приглашения выключены.",
    },
    {
      id: "inmail",
      icon: Wallet,
      title: "С InMail",
      tag: "Расходует кредиты",
      description:
        "Если бесплатно написать нельзя, используем InMail вашей подписки.",
    },
  ];
  const inmailTimings = [
    {
      id: "economy",
      icon: Clock3,
      title: "Экономить кредиты",
      description: rules.allow_invites
        ? "Сначала приглашение. InMail — если не примут или пригласить нельзя."
        : "InMail, если бесплатно написать нельзя.",
    },
    {
      id: "fast",
      icon: Zap,
      title: "Связаться быстрее",
      description: "Сразу InMail, без ожидания приглашения.",
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
      strategy:
        id === "fast"
          ? "fast"
          : id === "inmail" && r.allow_inmail
            ? r.strategy
            : "economy",
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
  useEffect(() => {
    onDraftChange?.(
      dirty
        ? {
            rules,
            texts,
            baseRules: JSON.stringify(data.rules),
            baseTexts: JSON.stringify([
              campaign.template_open,
              campaign.template_neutral,
            ]),
          }
        : null,
    );
  }, [
    JSON.stringify(rules),
    texts.open,
    texts.neutral,
    dirty,
    JSON.stringify(data.rules),
    campaign.template_open,
    campaign.template_neutral,
  ]);
  const peopleLabel = plural(selected.length, [
    "кандидат",
    "кандидата",
    "кандидатов",
  ]);
  const openCount = selected.filter((p) => p.segment === "open").length;
  const neutralCount = selected.filter((p) => p.segment === "neutral").length;
  const fieldChecks = {
    invitation: validateTemplate(rules.invitation, selected, { limit: 200 }),
  };
  for (const segment of ["open", "neutral"]) {
    const recipients = selected.filter((person) => person.segment === segment);
    fieldChecks[segment] = validateTemplate(texts[segment], recipients, {
      required: true,
    });
    fieldChecks["subject_" + segment] = validateTemplate(
      rules["subject_" + segment],
      recipients,
      {
        required: true,
        limit: 200,
        singleLine: true,
      },
    );
    fieldChecks["inmail_" + segment] = validateTemplate(
      rules["inmail_" + segment],
      recipients,
      {
        required: !!rules["inmail_" + segment],
      },
    );
  }
  const checkedFields = [
    ...(rules.allow_invites
      ? [["Текст приглашения", fieldChecks.invitation]]
      : []),
    ...["open", "neutral"].flatMap((segment) => {
      if (!selected.some((person) => person.segment === segment)) return [];
      const label = segment === "open" ? "Open to Work" : "Обычный текст";
      return [
        [label, fieldChecks[segment]],
        ...(rules.allow_inmail
          ? [
              [`Тема InMail · ${label}`, fieldChecks["subject_" + segment]],
              [`InMail · ${label}`, fieldChecks["inmail_" + segment]],
            ]
          : []),
      ];
    }),
  ];
  const invalidText = checkedFields.find(([, value]) => value.error);
  const stepTextError =
    step === 1
      ? invalidText
      : rules.allow_invites && fieldChecks.invitation.error
        ? ["Текст приглашения", fieldChecks.invitation]
        : null;
  const unsavableTemplate = [
    texts.open,
    texts.neutral,
    rules.invitation,
    rules.subject_open,
    rules.subject_neutral,
    rules.inmail_open,
    rules.inmail_neutral,
  ].some((value) => characterCount(String(value || "")) > 4000);
  const recruiterReady =
    account?.services?.recruiter?.status === "ready" &&
    account.services.recruiter.manual_texts;
  const limits = {
    wait_days: [1, 60],
    check_hours: [1, 72],
    monitor_days: [1, 90],
  };
  const numberLabels = {
    wait_days: "Ждать принятия · дней",
    check_hours: "Проверять контакты каждые · ч",
    monitor_days: "Следить за ответами · дней",
  };
  const invalidNumber = Object.entries(limits).find(
    ([key, [min, max]]) =>
      !Number.isInteger(rules[key]) || rules[key] < min || rules[key] > max,
  );
  const invalidHours = rules.start_hour >= rules.end_hour;
  const validRules = !invalidNumber && !invalidHours && !unsavableTemplate;
  const canReview =
    account?.status === "ready" &&
    validRules &&
    selected.length > 0 &&
    !invalidText &&
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
      title: "Бесплатное сообщение",
      text: rules.allow_inmail
        ? "Обычное сообщение или доступный InMail без списания кредита."
        : "Если можно написать бесплатно — используем ваш текст.",
    },
    ...(mode === "fast"
      ? [
          {
            title: "Платный InMail",
            text: "Без ожидания приглашения, если есть кредиты подписки.",
          },
        ]
      : []),
    ...(rules.allow_invites
      ? [
          {
            title: "Пригласить в контакты",
            text:
              mode === "fast"
                ? "Если InMail недоступен в LinkedIn или кредитов нет. После принятия — сообщение."
                : "После принятия автоматически отправить сообщение.",
          },
        ]
      : []),
    ...(mode === "economy"
      ? [
          {
            title: rules.allow_invites
              ? `Подождать ${rules.wait_days} дн. и отправить InMail`
              : "Отправить InMail",
            text: rules.allow_invites
              ? "Если пригласить нельзя — проверим InMail без ожидания."
              : "Если бесплатная связь недоступна и есть кредиты подписки.",
          },
        ]
      : []),
    {
      title: "Дождаться ответа",
      text: "Ответ появится в истории. Дальнейшие обращения остановятся.",
    },
  ];
  const reviewMembers =
    active?.members.filter((m) => m.status === "needs_review") || [];
  const recoverableMembers = reviewMembers.filter(
    (m) => !active.actions.some((a) => a.member_id === m.id),
  );
  const uncertainActions = active?.actions.some(
    (a) =>
      ["unknown", "submitting"].includes(a.status) && !a.repair_replaced_by,
  );
  const counts = outreachCounts(active);
  const nextEvent = campaignNextEvent(active, account);
  return (
    <div className="automation-workspace">
      {active && (
        <section className="panel automation-live">
          <div className="automation-live-heading">
            <div>
              <span className="eyebrow">КАМПАНИЯ</span>
              <h2>{nextEvent.title}</h2>
              <p className="campaign-next-event" role="status">
                {nextEvent.text}
              </p>
              {active.detail && (
                <DetailMessage detail={active.detail} status={active.status} />
              )}
            </div>
            <button
              className="button"
              disabled={
                nextEvent.kind === "busy" ||
                (disabled && active.status !== "active")
              }
              onClick={() =>
                nextEvent.kind === "account"
                  ? onAccounts()
                  : nextEvent.kind === "review"
                    ? onHistory()
                    : active.status === "active"
                      ? onPause()
                      : onResume(active.id)
              }
            >
              {["account", "review"].includes(nextEvent.kind) ? (
                <RefreshCw size={16} />
              ) : active.status === "active" ? (
                <Pause size={16} />
              ) : (
                <Play size={16} />
              )}
              {nextEvent.kind === "busy"
                ? "Дождитесь завершения"
                : nextEvent.kind === "account"
                  ? "Открыть аккаунты"
                  : nextEvent.kind === "review"
                    ? "Посмотреть"
                    : active.status === "active"
                      ? "Пауза"
                      : "Продолжить"}
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
            {reviewMembers.length > 0 && (
              <div>
                <strong>{reviewMembers.length}</strong>
                <span>Требуют внимания</span>
              </div>
            )}
          </div>
          {active.status === "paused" && recoverableMembers.length > 0 && (
            <div className="recovery-check">
              <p>
                Приложение посмотрит в LinkedIn текущие статусы. Ничего не
                отправит.
              </p>
              <button className="button" disabled={disabled} onClick={onCheck}>
                <RefreshCw size={16} /> Обновить статусы контактов
              </button>
            </div>
          )}
          {(uncertainActions || reviewMembers.length > 0) && (
            <p className="recovery-history">
              {uncertainActions
                ? "Есть действия с неподтверждённым результатом. Проверьте их в LinkedIn и укажите результат в истории."
                : "Причины остановки каждого контакта доступны в истории."}{" "}
              <button className="text-link" onClick={onHistory}>
                Открыть историю
              </button>
            </p>
          )}
          {active.status === "active" && (
            <button
              className="button"
              disabled={disabled}
              onClick={() => onCheckNow(active.id)}
            >
              <RefreshCw size={16} /> Проверить сейчас
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
              <span className="eyebrow">НАСТРОЙКА ОТПРАВКИ</span>
              <h2>{step === 0 ? "Как связаться" : "Тексты сообщений"}</h2>
            </header>
            <nav
              className="setup-steps"
              aria-label="Шаги настройки автоматизации"
            >
              {["Способ связи", "Тексты", "Запуск"].map((label, i) => (
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
              ))}
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
                            "strategy-choice " +
                            ((id === "free") === (mode === "free")
                              ? "chosen"
                              : "")
                          }
                          key={id}
                        >
                          <input
                            type="radio"
                            name="outreach-mode"
                            value={id}
                            checked={(id === "free") === (mode === "free")}
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
                            {(id === "free") === (mode === "free") && (
                              <Check size={12} />
                            )}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                  {rules.allow_inmail && (
                    <div className="inmail-settings">
                      <div
                        className="inmail-timing"
                        role="radiogroup"
                        aria-label="Когда отправлять InMail"
                      >
                        {inmailTimings.map(
                          ({ id, icon: Icon, title, description }) => (
                            <label
                              key={id}
                              className={
                                "timing-choice " + (mode === id ? "chosen" : "")
                              }
                            >
                              <input
                                type="radio"
                                name="inmail-timing"
                                value={id}
                                checked={mode === id}
                                onChange={() => choose(id)}
                              />
                              <Icon size={16} />
                              <span>
                                <strong>{title}</strong>
                                <small>{description}</small>
                              </span>
                            </label>
                          ),
                        )}
                      </div>
                      <p className="field-note">
                        Дополнительные кредиты не покупаем. Если кредиты
                        закончатся, оставшиеся кандидаты подождут в очереди.
                      </p>
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
                        {rules.allow_invites && fieldChecks.invitation.error
                          ? "Проверьте текст"
                          : rules.allow_invites
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
                            aria-invalid={!!fieldChecks.invitation.error}
                            aria-describedby="invitation-feedback"
                            value={rules.invitation}
                            onChange={(e) =>
                              field("invitation", e.target.value)
                            }
                            placeholder="Можно оставить пустым"
                          />
                          <TemplateFeedback
                            id="invitation-feedback"
                            value={fieldChecks.invitation}
                            limit={200}
                          />
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
                      <h3>Когда проверять контакты и ответы</h3>
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
                              : "Обычный текст"}
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
                              aria-invalid={
                                !!fieldChecks["subject_" + segment].error
                              }
                              aria-describedby={"subject-feedback-" + segment}
                              value={rules["subject_" + segment]}
                              onChange={(e) =>
                                field("subject_" + segment, e.target.value)
                              }
                              placeholder="Например: Recruitment opportunity"
                            />
                            <TemplateFeedback
                              id={"subject-feedback-" + segment}
                              value={fieldChecks["subject_" + segment]}
                              limit={200}
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
                            aria-invalid={!!fieldChecks[segment].error}
                            aria-describedby={"message-feedback-" + segment}
                            aria-label={
                              "Сообщение · " +
                              (segment === "open"
                                ? "Open to Work"
                                : "нейтральное")
                            }
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
                          <TemplateFeedback
                            id={"message-feedback-" + segment}
                            value={fieldChecks[segment]}
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
                                  : "Обычный InMail"}
                              </span>
                              <textarea
                                aria-invalid={
                                  !!fieldChecks["inmail_" + s].error
                                }
                                aria-describedby={"inmail-feedback-" + s}
                                rows={4}
                                value={rules["inmail_" + s]}
                                onChange={(e) =>
                                  field("inmail_" + s, e.target.value)
                                }
                              />
                              <TemplateFeedback
                                id={"inmail-feedback-" + s}
                                value={fieldChecks["inmail_" + s]}
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    </details>
                  )}
                  {rules.allow_inmail &&
                    rules.inmail_channel === "recruiter" && (
                      <p className="field-feedback">
                        Подпись Recruiter входит в лимит 1900 символов. Точный
                        текст вместе с подписью проверим перед запуском.
                      </p>
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
                    disabled={!step && !validRules}
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
                      disabled={!validRules}
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
                  {previewing ? (
                    <>
                      <LoaderCircle className="spin" size={16} />
                      Готовим тексты…
                    </>
                  ) : (
                    <>
                      {step ? "Посмотреть перед запуском" : "Далее: сообщения"}
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </footer>
              {previewing && (
                <p className="setup-validation" role="status">
                  Готовим тексты для каждого получателя. Обычно это занимает
                  несколько секунд, с Recruiter — до пары минут.
                </p>
              )}
              {!previewing &&
                (!validRules ||
                  stepTextError ||
                  (step === 1 && !canReview)) && (
                  <p className="setup-validation" role="status">
                    {invalidHours
                      ? "Время окончания должно быть позже начала в пределах суток."
                      : invalidNumber
                        ? `«${numberLabels[invalidNumber[0]]}»: укажите целое число от ${limits[invalidNumber[0]][0]} до ${limits[invalidNumber[0]][1]}.`
                        : unsavableTemplate
                          ? "Сократите шаблоны до 4000 символов, чтобы сохранить настройки."
                          : stepTextError
                            ? `«${stepTextError[0]}»: ${stepTextError[1].error}`
                            : account?.status !== "ready"
                              ? "Подключите аккаунт отправителя на вкладке «Аккаунты»."
                              : !selected.length
                                ? "Сначала выберите кандидатов для этой кампании."
                                : rules.inmail_channel === "recruiter" &&
                                    !recruiterReady
                                  ? "Откройте «Способ связи»: подключите Recruiter и разрешите отправку ваших текстов в аккаунте отправителя."
                                  : "Проверьте настройки способа связи."}
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
                  {dirty
                    ? draftPersisted
                      ? "Черновик сохранён на этом компьютере"
                      : "Есть несохранённые изменения"
                    : "Сохранено"}
                </span>
              </div>
              <h3>
                {mode === "free"
                  ? "Без InMail"
                  : `С InMail · ${mode === "fast" ? "быстрее" : "экономно"}`}
              </h3>
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
              <details className="plan-sequence">
                <summary>Последовательность действий</summary>
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
              </details>
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
                      Кредиты InMail: до <b>{selected.length}</b>
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
                Обрабатываем только выбранных кандидатов. При ограничении
                LinkedIn остановимся и сохраним очередь.
              </span>
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
