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
} from "lucide-react";

const states = {
  planned: "Готов к обработке",
  check_pending: "Ожидаем проверки",
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
  blocked: "Действие остановлено",
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
  inmail: "InMail",
};

const TEMPLATE_FIELDS = new Set(["name", "first_name", "headline", "company"]);
const characterCount = (value) => [...value].length;

// This catches editing mistakes early. The backend still validates every exact
// recipient text, including the current Recruiter signature, before approval.
export function validateTemplate(
  template,
  recipients,
  { limit = 1900, required = false, singleLine = false } = {},
) {
  const source = String(template || "");
  const result = {
    count: characterCount(source),
    rendered: false,
    error: "",
  };
  const fail = (error) => ({ ...result, error });
  if (characterCount(source) > 4000)
    return fail("В шаблоне допустимо не больше 4000 символов.");
  if (!source.trim())
    return required && recipients.length
      ? fail("Заполните это поле для выбранных кандидатов.")
      : { ...result, count: 0 };
  const parts = [];
  let literal = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if ((char === "{" || char === "}") && source[index + 1] === char) {
      literal += char;
      index++;
    } else if (char === "{") {
      parts.push({ literal });
      literal = "";
      const end = source.indexOf("}", index + 1);
      if (end < 0)
        return fail("Закройте фигурную скобку в переменной шаблона.");
      const field = source.slice(index + 1, end).replace(/:$/, "");
      if (!TEMPLATE_FIELDS.has(field))
        return fail(
          "Используйте только {first_name}, {name}, {headline} или {company}. Для обычных скобок напишите {{ и }}.",
        );
      parts.push({ field });
      index = end;
    } else if (char === "}") {
      return fail(
        "Проверьте фигурные скобки в шаблоне: у закрывающей нет пары.",
      );
    } else literal += char;
  }
  parts.push({ literal });
  const evaluate = (values) =>
    parts
      .map((part) => (part.field ? values[part.field] : part.literal))
      .join("");
  const texts = [];
  for (const recipient of recipients) {
    const person = recipient.data || recipient;
    const values = Object.fromEntries(
      [...TEMPLATE_FIELDS].map((key) => [
        key,
        String(person[key] || "").trim(),
      ]),
    );
    values.first_name = values.name.split(" ")[0];
    const missing = parts.find((part) => part.field && !values[part.field]);
    if (missing)
      return fail(
        `У «${person.name || recipient.url || "кандидата"}» нет значения {${missing.field}}. Измените текст или выбор кандидатов.`,
      );
    texts.push(evaluate(values).trim());
  }
  // Without recipients the counter describes the template, not an invented
  // rendered name. Literal-only templates can already be checked in full.
  if (!recipients.length && !parts.some((part) => part.field))
    texts.push(evaluate({}).trim());
  if (texts.length) {
    result.rendered = recipients.length > 0;
    result.count = Math.max(...texts.map(characterCount));
    for (const text of texts) {
      if (!text || characterCount(text) > 1900)
        return fail(
          `После подстановки данных допустимо от 1 до ${limit} символов.`,
        );
      const normalized = text.replace(/\r\n?/g, "\n");
      if (characterCount(normalized) > limit)
        return fail(
          `После подстановки данных должно быть не больше ${limit} символов.`,
        );
      if (singleLine && normalized.includes("\n"))
        return fail("Тема InMail должна быть одной строкой.");
      if (/\[(?:link|ссылка)\]/i.test(text))
        return fail("Замените [link] или [ссылка] настоящей ссылкой.");
      if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f]/.test(text))
        return fail("Удалите служебные символы из текста, например табуляцию.");
    }
    if (limit < 1900)
      result.count = Math.max(
        ...texts.map((text) => characterCount(text.replace(/\r\n?/g, "\n"))),
      );
  }
  return result;
}

export function describeOutreach(rules) {
  const steps = ["Сначала — доступное бесплатное сообщение."];
  if (rules.allow_inmail)
    steps.push(
      "Если LinkedIn предлагает InMail без списания кредита, его можно отправить без ожидания.",
    );
  if (rules.allow_inmail && rules.strategy === "fast") {
    steps.push(
      "Платный InMail — без ожидания приглашения, в пределах бюджета.",
    );
    if (rules.allow_invites)
      steps.push(
        "Если InMail недоступен в LinkedIn или кредитов нет, используем доступное приглашение; после принятия — сообщение.",
      );
  } else if (rules.allow_invites) {
    steps.push(
      "Если бесплатно написать нельзя, отправим доступное приглашение; после принятия — сообщение.",
    );
    if (rules.allow_inmail)
      steps.push(
        `Если приглашение не примут за ${rules.wait_days} дн., проверим возможность InMail. Если пригласить нельзя, InMail возможен без ожидания.`,
      );
  } else if (rules.allow_inmail) {
    steps.push(
      "Приглашения выключены: если бесплатная связь недоступна, используем доступный InMail в пределах бюджета.",
    );
  } else {
    steps.push(
      "Приглашения и InMail выключены: если бесплатное сообщение недоступно, отправки не будет.",
    );
  }
  steps.push("После ответа кандидата автоматические обращения прекратятся.");
  return steps.join(" ");
}

export function outreachCounts(run) {
  if (!run) return null;
  const confirmed = new Set(
    run.actions
      .filter(
        (action) =>
          action.status === "sent" &&
          ["message", "inmail"].includes(action.kind),
      )
      .map((action) => action.member_id),
  );
  return {
    waiting: run.members.filter(
      (member) => member.status === "waiting_acceptance",
    ).length,
    // Confirmation is stored before the member timestamp is updated. Count
    // each recipient once, including those who have subsequently replied.
    sent: run.members.filter(
      (member) => member.sent_at || confirmed.has(member.id),
    ).length,
    replied: run.members.filter((member) => member.status === "replied").length,
  };
}

function TemplateFeedback({ id, value, limit = 1900, extra = "" }) {
  return (
    <span id={id} className="field-feedback">
      <small>
        {value.count} / {limit} символов
        {value.rendered ? " · максимум после подстановки" : " · в шаблоне"}
        {extra && ` · ${extra}`}
      </small>
      {value.error && (
        <span className="field-error" role="status">
          {value.error}
        </span>
      )}
    </span>
  );
}

export function DetailMessage({ detail, status, kind }) {
  const original = String(detail ?? "");
  const text = original.trim();
  if (!text) return null;
  // Keep readable product guidance intact. Transport envelopes and diagnostics
  // remain available verbatim, but are not the recruiter's primary next step.
  const technical =
    /^[{[]|^(?:Traceback|Error invoking remote method|\w*(?:Error|Exception):)/i.test(
      text,
    ) || /\bCall log:|"(?:message|error|meta)"\s*:/.test(text);
  const russian =
    /^(?:[«"'“]?[А-Яа-яЁё]|(?:LinkedIn|InMail|Recruiter)\s+[А-Яа-яЁё])/.test(
      text,
    );
  if (russian && !technical)
    return <p className="detail-message">{original}</p>;

  const check =
    kind === "invite"
      ? "Проверьте приглашение в профиле LinkedIn."
      : kind === "message" || kind === "inmail"
        ? "Проверьте переписку в LinkedIn."
        : "Проверьте профиль и переписку в LinkedIn.";
  const guidance =
    {
      sent:
        kind === "invite"
          ? "Отправка приглашения подтверждена в LinkedIn."
          : "Отправка сообщения подтверждена в LinkedIn.",
      replied: "Получен ответ кандидата. Автоматические обращения прекращены.",
      unknown: `Результат отправки не подтверждён. ${check} Не повторяйте отправку до проверки, чтобы избежать дубликата.`,
      needs_review: `Результат требует ручной проверки. ${check} Не повторяйте действие до проверки.`,
      blocked: `Действие остановлено. ${check} Перед новой попыткой изучите технические подробности ниже.`,
      unavailable: `Действие сейчас недоступно. ${check} Технические подробности сохранены ниже.`,
      submitting:
        "Действие выполняется. Дождитесь результата и не запускайте его повторно.",
      waiting_acceptance:
        "Приглашение ожидает принятия. Его состояние можно проверить в LinkedIn.",
      waiting_credits:
        "Для продолжения проверьте доступные InMail-кредиты аккаунта.",
      waiting_budget:
        "Для продолжения проверьте бюджет InMail в настройках кампании.",
      excluded: "Кандидат исключён из этого плана. Подробности сохранены ниже.",
      finished:
        "Наблюдение за кандидатом завершено. Подробности сохранены ниже.",
      cancelled: "План остановлен. Подробности сохранены ниже.",
      paused: "План приостановлен. Проверьте подробности перед возобновлением.",
    }[status] || `${check} Подробности сохранены ниже.`;
  return (
    <div className="detail-message">
      <p>{guidance}</p>
      <details className="technical-details">
        <summary>Технические подробности</summary>
        <pre>{original}</pre>
      </details>
    </div>
  );
}

const date = (v) => (v ? new Date(v).toLocaleString("ru-RU") : "—");
export function ContactState({ person, member }) {
  const contact = member?.observation || person.data.contact || {};
  const unfinished = [
    "planned",
    "waiting_acceptance",
    "waiting_budget",
    "waiting_credits",
    "check_pending",
  ].includes(member?.status);
  const stopped =
    unfinished && ["cancelled", "completed"].includes(member?.run_status);
  const label = stopped
    ? member.run_status === "cancelled"
      ? "План остановлен"
      : "Наблюдение завершено"
    : member
      ? states[member.status] || member.status
      : relations[contact.relationship] || relations.unknown;
  const detail = stopped
    ? member.invitation_at || member.status === "waiting_acceptance"
      ? "Приглашение уже было отправлено. Проверки принятия и последующие сообщения остановлены."
      : "Этот план больше не выполняется. Для новых обращений подготовьте новый план."
    : member?.detail;
  return (
    <div className="contact-state">
      <span
        className={
          "badge " + (stopped ? "cancelled" : member?.status || "neutral")
        }
      >
        {label}
      </span>
      {member && (
        <small>{relations[member.relationship] || relations.unknown}</small>
      )}
      <DetailMessage detail={detail} status={member?.status} />
      {unfinished && member?.run_status === "paused" && (
        <small>
          Автоматические проверки продолжатся после возобновления плана.
        </small>
      )}
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
  onHistory,
  onAccounts,
  initialDraft,
  onDraftChange,
  draftPersisted = false,
}) {
  const draft =
    initialDraft?.baseRules === JSON.stringify(data.rules) &&
    initialDraft?.baseTexts ===
      JSON.stringify([campaign.template_open, campaign.template_neutral])
      ? initialDraft
      : null;
  const serverRules = useRef(JSON.stringify(data.rules));
  const serverTexts = useRef(
    JSON.stringify([campaign.template_open, campaign.template_neutral]),
  );
  const [rules, setRules] = useState(draft?.rules || data.rules);
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
      description: rules.allow_invites
        ? "Бесплатное сообщение или приглашение в контакты."
        : "Только доступное бесплатное сообщение. Приглашения выключены.",
    },
    {
      id: "economy",
      icon: Clock3,
      title: "Экономить кредиты",
      tag: rules.allow_invites ? "Сначала знакомство" : "Без приглашений",
      description: rules.allow_invites
        ? "Сначала приглашение. Платный InMail — после ожидания или если пригласить нельзя."
        : "Приглашения выключены: доступный InMail без ожидания, если бесплатно написать нельзя.",
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
  const peopleLabel = {
    one: "кандидат",
    few: "кандидата",
    many: "кандидатов",
    other: "кандидата",
  }[new Intl.PluralRules("ru").select(selected.length)];
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
      const label =
        segment === "open" ? "Open to Work" : "Нейтральное сообщение";
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
    inmail_budget: [0, 1000],
    daily_invites: [1, 100],
    daily_messages: [1, 200],
    daily_inmails: [1, 100],
    monitor_days: [1, 90],
  };
  const numberLabels = {
    wait_days: "Ждать принятия · дней",
    check_hours: "Проверять контакты каждые · ч",
    inmail_budget: "Бюджет InMail · кредитов",
    daily_invites: "Приглашений в сутки",
    daily_messages: "Сообщений в сутки",
    daily_inmails: "InMail в сутки",
    monitor_days: "Следить за ответами · дней",
  };
  const invalidNumber = Object.entries(limits).find(
    ([key, [min, max]]) =>
      !Number.isInteger(rules[key]) || rules[key] < min || rules[key] > max,
  );
  const invalidHours = rules.start_hour >= rules.end_hour;
  const invalidInmailBudget = rules.allow_inmail && rules.inmail_budget < 1;
  const validRules =
    !invalidNumber &&
    !invalidHours &&
    !invalidInmailBudget &&
    !unsavableTemplate;
  const canReview =
    account?.status === "ready" &&
    validRules &&
    selected.length > 0 &&
    !invalidText &&
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
      title: "Проверить бесплатную связь",
      text: rules.allow_inmail
        ? "Обычное сообщение или доступный InMail без списания кредита."
        : "Если можно написать бесплатно — используем ваш текст.",
    },
    ...(mode === "fast"
      ? [
          {
            title: "Проверить платный InMail",
            text: "Без ожидания приглашения, при доступных кредитах и в пределах бюджета.",
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
              : "Если бесплатная связь недоступна, в пределах бюджета.",
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
  const uncertainActions = active?.actions.some((a) =>
    ["unknown", "submitting"].includes(a.status),
  );
  const counts = outreachCounts(active);
  return (
    <div className="automation-workspace">
      {active && (
        <section className="panel automation-live">
          <div className="automation-live-heading">
            <div>
              <span className="eyebrow">КАМПАНИЯ</span>
              <h2>{states[active.status]}</h2>
              <DetailMessage
                detail={
                  active.detail ||
                  (active.status === "paused"
                    ? "План приостановлен. Проверьте подробности перед возобновлением."
                    : "Программа проверяет контакты и выполняет утверждённый план.")
                }
                status={active.status}
              />
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
            {reviewMembers.length > 0 && (
              <div>
                <strong>{reviewMembers.length}</strong>
                <span>Требуют проверки</span>
              </div>
            )}
          </div>
          {active.status === "paused" && recoverableMembers.length > 0 && (
            <div className="recovery-check">
              <p>
                Повторная проверка уточнит состояние контактов. Она не
                отправляет приглашения или сообщения.
              </p>
              <button className="button" disabled={disabled} onClick={onCheck}>
                <RefreshCw size={16} /> Повторно проверить контакты · без
                отправки
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
                          Бесплатный InMail не расходует бюджет. Платные
                          отправки — в пределах выбранных кредитов;
                          дополнительных покупок не будет.
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
                                  : "Нейтральный InMail"}
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
                  {step ? "Проверить запуск" : "Далее: сообщения"}
                  <ArrowRight size={16} />
                </button>
              </footer>
              {(!validRules || stepTextError || (step === 1 && !canReview)) && (
                <p className="setup-validation" role="status">
                  {invalidHours
                    ? "Время окончания должно быть позже начала в пределах суток."
                    : invalidNumber
                      ? `«${numberLabels[invalidNumber[0]]}»: укажите целое число от ${limits[invalidNumber[0]][0]} до ${limits[invalidNumber[0]][1]}.`
                      : invalidInmailBudget
                        ? "Укажите бюджет InMail не меньше одного кредита."
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
                  {dirty
                    ? draftPersisted
                      ? "Черновик сохранён на этом компьютере"
                      : "Есть несохранённые изменения"
                    : "Сохранено"}
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
    <section className="outreach-history" aria-label="Приглашения и сообщения">
      {visible.map((run) => (
        <div key={run.id} className="outreach-run">
          <div className="toolbar">
            <b>
              {states[run.status]} · {date(run.created)}
            </b>
            <span>
              Получателей: {run.members.length}
              {(run.rules.allow_inmail || run.credits_reserved > 0) && (
                <>
                  {" "}
                  · InMail-кредиты: {run.credits_reserved}/
                  {run.rules.inmail_budget}
                </>
              )}
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
                        ? run.status === "paused"
                          ? "После возобновления"
                          : run.status === "active"
                            ? date(m.next_check)
                            : "—"
                        : "—"}
                    </td>
                    <td>
                      <DetailMessage detail={m.detail} status={m.status} />
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
                <DetailMessage
                  detail={a.detail}
                  status={a.status}
                  kind={a.kind}
                />
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
        <h2 id="background-settings-title">Работа в фоне</h2>
        <p>Выберите, когда приложение должно продолжать работу.</p>
      </header>
      {pending === "load" && (
        <p className="preference-status" role="status">
          Загружаем настройки…
        </p>
      )}
      {error && (
        <div className="preference-error">
          <p role="alert">
            {prefs
              ? "Не удалось подтвердить сохранение. Обновите настройки и проверьте переключатель."
              : "Не удалось загрузить настройки. Попробуйте ещё раз."}
          </p>
          <button className="button" disabled={Boolean(pending)} onClick={load}>
            {prefs ? "Обновить настройки" : "Попробовать ещё раз"}
          </button>
          <details className="technical-details">
            <summary>Технические подробности</summary>
            <pre>{error}</pre>
          </details>
        </div>
      )}
      {prefs && (
        <>
          <label className="preference-row">
            <div className="preference-copy">
              <strong>Продолжать работу после закрытия окна</strong>
              <small id="background-setting-help">
                При включении этой настройки кампании продолжатся в фоне.
                Открыть окно можно через значок приложения.
              </small>
            </div>
            <input
              className="preference-switch"
              type="checkbox"
              aria-label="Продолжать работу после закрытия окна"
              aria-describedby="background-setting-help"
              checked={prefs.background}
              disabled={Boolean(pending)}
              onChange={(e) => save({ background: e.target.checked })}
            />
          </label>
          <label className="preference-row">
            <div className="preference-copy">
              <strong>Запускать при входе в систему</strong>
              <small id="autostart-setting-help">
                {prefs.autoStartNote ||
                  (prefs.packaged
                    ? "Приложение откроется автоматически после входа в компьютер."
                    : "Автозапуск доступен в установленной версии приложения.")}
              </small>
            </div>
            <input
              className="preference-switch"
              type="checkbox"
              aria-label="Запускать при входе в систему"
              aria-describedby="autostart-setting-help"
              checked={prefs.autoStart}
              disabled={!prefs.packaged || Boolean(pending)}
              onChange={(e) => save({ autoStart: e.target.checked })}
            />
          </label>
          {(pending === "save" || saved) && (
            <p className="preference-status" role="status">
              {pending === "save"
                ? "Сохраняем настройку…"
                : "Настройки сохранены."}
            </p>
          )}
        </>
      )}
      <footer className="preference-footnote">
        Выполняются только утверждённые кампании и только в выбранные часы, пока
        компьютер включён и не спит. Чтобы полностью остановить приложение,
        выберите «Завершить работу» в меню его значка.
      </footer>
    </section>
  );
}
