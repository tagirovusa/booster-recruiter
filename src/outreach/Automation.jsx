// Outreach setup for one campaign: contact mode, texts and launch check,
// plus the live panel of a running plan.
import React, { useEffect, useRef, useState } from "react";
import { zoneNames } from "../labels";
import {
  UserRoundPlus,
  Clock3,
  Zap,
  Check,
  ArrowLeft,
  ArrowRight,
  Wallet,
  LoaderCircle,
} from "lucide-react";
import { plural } from "../text";
import { t, hourLabel } from "../i18n";
import { LivePlanPanel } from "./LivePlanPanel";
import { PlanSummary } from "./PlanSummary";
import { ContactModeStep } from "./ContactModeStep";
import { TextsStep } from "./TextsStep";
import {
  characterCount,
  currentRules,
  draftMatchesRules,
  validateTemplate,
  outreachCounts,
  campaignNextEvent,
} from "./rules";

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
      title: t("Без InMail"),
      tag: t("Рекомендуем"),
      description: rules.allow_invites
        ? t("Бесплатное сообщение, а если нельзя — приглашение в контакты.")
        : t("Только бесплатное сообщение. Приглашения выключены."),
    },
    {
      id: "inmail",
      icon: Wallet,
      title: t("С InMail"),
      tag: t("Расходует кредиты"),
      description:
        t("Если бесплатно написать нельзя, используем InMail вашей подписки."),
    },
  ];
  const inmailTimings = [
    {
      id: "economy",
      icon: Clock3,
      title: t("Экономить кредиты"),
      description: rules.allow_invites
        ? t("Сначала приглашение. InMail — если не примут или пригласить нельзя.")
        : t("InMail, если бесплатно написать нельзя."),
    },
    {
      id: "fast",
      icon: Zap,
      title: t("Связаться быстрее"),
      description: t("Сразу InMail, без ожидания приглашения."),
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
  const peopleLabel = plural(
    selected.length,
    ["кандидат", "кандидата", "кандидатов"], // i18n-ignore
    ["candidate", "candidates"],
  );
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
      ? [[t("Текст приглашения"), fieldChecks.invitation]]
      : []),
    ...["open", "neutral"].flatMap((segment) => {
      if (!selected.some((person) => person.segment === segment)) return [];
      const label = segment === "open" ? "Open to Work" : t("Обычный текст");
      return [
        [label, fieldChecks[segment]],
        ...(rules.allow_inmail
          ? [
              [t("Тема InMail · {label}", { label }), fieldChecks["subject_" + segment]],
              [t("InMail · {label}", { label }), fieldChecks["inmail_" + segment]],
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
        ? [t("Текст приглашения"), fieldChecks.invitation]
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
    wait_days: t("Ждать принятия · дней"),
    check_hours: t("Проверять контакты каждые · ч"),
    monitor_days: t("Следить за ответами · дней"),
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
  const times = hourLabel;
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
      title: t("Бесплатное сообщение"),
      text: rules.allow_inmail
        ? t("Обычное сообщение или доступный InMail без списания кредита.")
        : t("Если можно написать бесплатно — используем ваш текст."),
    },
    ...(mode === "fast"
      ? [
          {
            title: t("Платный InMail"),
            text: t("Без ожидания приглашения, если есть кредиты подписки."),
          },
        ]
      : []),
    ...(rules.allow_invites
      ? [
          {
            title: t("Пригласить в контакты"),
            text:
              mode === "fast"
                ? t("Если InMail недоступен в LinkedIn или кредитов нет. После принятия — сообщение.")
                : t("После принятия автоматически отправить сообщение."),
          },
        ]
      : []),
    ...(mode === "economy"
      ? [
          {
            title: rules.allow_invites
              ? t("Подождать {days} дн. и отправить InMail", { days: rules.wait_days })
              : t("Отправить InMail"),
            text: rules.allow_invites
              ? t("Если пригласить нельзя — проверим InMail без ожидания.")
              : t("Если бесплатная связь недоступна и есть кредиты подписки."),
          },
        ]
      : []),
    {
      title: t("Дождаться ответа"),
      text: t("Ответ появится в истории. Дальнейшие обращения остановятся."),
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
        <LivePlanPanel
          ctx={{
            active,
            counts,
            disabled,
            editing,
            nextEvent,
            onAccounts,
            onCheck,
            onCheckNow,
            onHistory,
            onPause,
            onResume,
            recoverableMembers,
            reviewMembers,
            setEditing,
            uncertainActions,
          }}
        />
      )}
      {editing && (
        <div className="automation-layout">
          <section className="panel setup-panel">
            <header className="setup-heading">
              <span className="eyebrow">{t("НАСТРОЙКА ОТПРАВКИ")}</span>
              <h2>{step === 0 ? t("Как связаться") : t("Тексты сообщений")}</h2>
            </header>
            <nav
              className="setup-steps"
              aria-label={t("Шаги настройки автоматизации")}
            >
              {[t("Способ связи"), t("Тексты"), t("Запуск")].map((label, i) => (
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
                <ContactModeStep
                  ctx={{
                    choose,
                    field,
                    fieldChecks,
                    inmailTimings,
                    mode,
                    modes,
                    number,
                    onAccounts,
                    recruiterReady,
                    rules,
                    times,
                    zoneNames,
                    zones,
                  }}
                />
              ) : (
                <TextsStep
                  ctx={{
                    active,
                    field,
                    fieldChecks,
                    neutralCount,
                    openCount,
                    rules,
                    setTexts,
                    texts,
                  }}
                />
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
                        {t("Назад")}
                      </>
                    ) : (
                      t("Сохранить настройки")
                    )}
                  </button>
                  {step === 1 && (
                    <button
                      className="text-link"
                      disabled={!validRules}
                      onClick={() => onSave(rules, texts, false)}
                    >
                      {t("Сохранить без запуска")}
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
                      {t("Готовим тексты…")}
                    </>
                  ) : (
                    <>
                      {step ? t("Посмотреть перед запуском") : t("Далее: сообщения")}
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </footer>
              {previewing && (
                <p className="setup-validation" role="status">
                  {t("Готовим тексты для каждого получателя. Обычно это занимает несколько секунд, с Recruiter — до пары минут.")}
                </p>
              )}
              {!previewing &&
                (!validRules ||
                  stepTextError ||
                  (step === 1 && !canReview)) && (
                  <p className="setup-validation" role="status">
                    {invalidHours
                      ? t("Время окончания должно быть позже начала в пределах суток.")
                      : invalidNumber
                        ? t("«{label}»: укажите целое число от {min} до {max}.", {
                            label: numberLabels[invalidNumber[0]],
                            min: limits[invalidNumber[0]][0],
                            max: limits[invalidNumber[0]][1],
                          })
                        : unsavableTemplate
                          ? t("Сократите шаблоны до 4000 символов, чтобы сохранить настройки.")
                          : stepTextError
                            ? t("«{label}»: {error}", {
                                label: stepTextError[0],
                                error: stepTextError[1].error,
                              })
                            : account?.status !== "ready"
                              ? t("Подключите аккаунт отправителя на вкладке «Аккаунты».")
                              : !selected.length
                                ? t("Сначала выберите кандидатов для этой кампании.")
                                : rules.inmail_channel === "recruiter" &&
                                    !recruiterReady
                                  ? t("Откройте «Способ связи»: подключите Recruiter и разрешите отправку ваших текстов в аккаунте отправителя.")
                                  : t("Проверьте настройки способа связи.")}
                  </p>
                )}
            </fieldset>
          </section>
          <PlanSummary
            ctx={{
              account,
              dirty,
              draftPersisted,
              flow,
              mode,
              onPeople,
              peopleLabel,
              rules,
              selected,
              times,
              zoneNames,
            }}
          />
        </div>
      )}
    </div>
  );
}
