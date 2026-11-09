// Step 1 of outreach setup: how to contact candidates, invitations and
// working hours.
import React from "react";
import {
  Check,
  ChevronDown,
  SlidersHorizontal,
  UserRoundPlus,
} from "lucide-react";
import { TemplateFeedback } from "./parts";
import { t } from "../i18n";

export function ContactModeStep({ ctx }) {
  const {
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
  } = ctx;
  return (
    <>
      <div className="setup-section-title">
        <h3>{t("Как связываться с кандидатами?")}</h3>
        <p>{t("Доступное бесплатное сообщение всегда используется первым.")}</p>
      </div>
      <div
        className="strategy-options"
        role="radiogroup"
        aria-label={t("Способ связи")}
      >
        {modes.map(({ id, icon: Icon, title, tag, description }) => (
          <label
            className={
              "strategy-choice " +
              ((id === "free") === (mode === "free") ? "chosen" : "")
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
              {(id === "free") === (mode === "free") && <Check size={12} />}
            </span>
          </label>
        ))}
      </div>
      {rules.allow_inmail && (
        <div className="inmail-settings">
          <div
            className="inmail-timing"
            role="radiogroup"
            aria-label={t("Когда отправлять InMail")}
          >
            {inmailTimings.map(({ id, icon: Icon, title, description }) => (
              <label
                key={id}
                className={"timing-choice " + (mode === id ? "chosen" : "")}
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
            ))}
          </div>
          <p className="field-note">
            {t("Дополнительные кредиты не покупаем. Если кредиты закончатся, оставшиеся кандидаты подождут в очереди.")}
          </p>
          <label className="field">
            <span>{t("Подписка для InMail")}</span>
            <select
              value={rules.inmail_channel || "linkedin"}
              onChange={(e) => field("inmail_channel", e.target.value)}
            >
              <option value="linkedin">LinkedIn Premium</option>
              <option value="recruiter">LinkedIn Recruiter</option>
            </select>
          </label>
          {rules.inmail_channel === "recruiter" && !recruiterReady && (
            <div className="hint warning">
              {t("Подключите Recruiter и разрешите отправку ваших текстов в аккаунте отправителя.")}{" "}
              <button className="text-link" onClick={onAccounts}>
                {t("Открыть аккаунты")}
              </button>
            </div>
          )}
          {mode === "economy" &&
            rules.allow_invites &&
            number("wait_days", t("Ждать принятия · дней"), 1, 60)}
        </div>
      )}
      <details className="setup-details">
        <summary>
          <span>
            <UserRoundPlus size={17} />
            <b>{t("Приглашения в контакты")}</b>
          </span>
          <small>
            {rules.allow_invites && fieldChecks.invitation.error
              ? t("Проверьте текст")
              : rules.allow_invites
                ? rules.invitation.trim()
                  ? t("С вашей заметкой")
                  : t("Без заметки")
                : t("Выключены")}
          </small>
          <ChevronDown size={16} />
        </summary>
        <div className="details-body">
          <label className="check-option">
            <input
              type="checkbox"
              checked={rules.allow_invites}
              onChange={(e) => field("allow_invites", e.target.checked)}
            />
            <span>
              <b>{t("Приглашать в контакты")}</b>
              <small>
                {t("После принятия программа отправит утверждённый текст.")}
              </small>
            </span>
          </label>
          {rules.allow_invites && (
            <label className="field">
              <span>{t("Текст приглашения · необязательно")}</span>
              <textarea
                rows={3}
                aria-invalid={!!fieldChecks.invitation.error}
                aria-describedby="invitation-feedback"
                value={rules.invitation}
                onChange={(e) => field("invitation", e.target.value)}
                placeholder={t("Можно оставить пустым")}
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
            <b>{t("Дополнительные настройки")}</b>
          </span>
          <small>
            {times(rules.start_hour)}–{times(rules.end_hour)}
          </small>
          <ChevronDown size={16} />
        </summary>
        <div className="details-body">
          <h3>{t("Когда работать")}</h3>
          <div className="settings-row">
            <label className="field">
              <span>{t("Часовой пояс")}</span>
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
                  {key === "start_hour" ? t("Начинать в") : t("Заканчивать в")}
                </span>
                <select
                  value={rules[key]}
                  onChange={(e) => field(key, Number(e.target.value))}
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
          <h3>{t("Когда проверять контакты и ответы")}</h3>
          <div className="settings-row">
            {number("check_hours", t("Проверять контакты каждые · ч"), 1, 72)}
            {number("monitor_days", t("Следить за ответами · дней"), 1, 90)}
          </div>
        </div>
      </details>
    </>
  );
}
