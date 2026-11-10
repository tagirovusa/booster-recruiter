// Step 2 of outreach setup: the message for each candidate group.
import React from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { TemplateFeedback } from "./parts";
import { t } from "../i18n";

export function TextsStep({ ctx }) {
  const {
    active,
    field,
    fieldChecks,
    neutralCount,
    openCount,
    rules,
    setTexts,
    texts,
  } = ctx;
  return (
    <>
      <div className="setup-section-title">
        <h3>{t("Что получат кандидаты?")}</h3>
        <p>
          {t(
            "Для каждой группы — свой текст. Программа подставит имя и покажет итог перед запуском.",
          )}
        </p>
      </div>
      <div className="setup-message-grid">
        {["open", "neutral"].map((segment) => (
          <div className="setup-message-card" key={segment}>
            <div className="message-group-title">
              <span className={"group-dot " + segment} />
              <strong>
                {segment === "open" ? "Open to Work" : t("Обычный текст")}
              </strong>
              <small>
                {t("{count} выбрано", {
                  count: segment === "open" ? openCount : neutralCount,
                })}
              </small>
            </div>
            <p>
              {segment === "open"
                ? t("Для людей с подтверждённой рамкой.")
                : t("Для остальных выбранных профилей.")}
            </p>
            {rules.allow_inmail && (
              <label className="field">
                <span>
                  {t("Тема InMail ·")}{" "}
                  {segment === "open" ? "Open to Work" : t("нейтральное")}
                </span>
                <input
                  aria-invalid={!!fieldChecks["subject_" + segment].error}
                  aria-describedby={"subject-feedback-" + segment}
                  value={rules["subject_" + segment]}
                  onChange={(e) => field("subject_" + segment, e.target.value)}
                  placeholder={t("Например: Recruitment opportunity")}
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
                {t("Сообщение ·")}{" "}
                {segment === "open" ? "Open to Work" : t("нейтральное")}
              </span>
              <textarea
                aria-invalid={!!fieldChecks[segment].error}
                aria-describedby={"message-feedback-" + segment}
                aria-label={
                  t("Сообщение ·") +
                  " " +
                  (segment === "open" ? "Open to Work" : t("нейтральное"))
                }
                rows={7}
                value={texts[segment]}
                onChange={(e) =>
                  setTexts((prev) => ({
                    ...prev,
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
                <code>{"{first_name}"}</code> {t("заменится на имя кандидата")}
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
              <b>{t("Другой текст для InMail")}</b>
            </span>
            <small>
              {rules.inmail_open || rules.inmail_neutral
                ? t("Настроен отдельно")
                : t("Используем основной")}
            </small>
            <ChevronDown size={16} />
          </summary>
          <div className="details-body">
            <p>
              {t("Оставьте поля пустыми, чтобы использовать сообщения выше.")}
            </p>
            <div className="setup-message-grid">
              {["open", "neutral"].map((s) => (
                <label className="field" key={s}>
                  <span>
                    {s === "open"
                      ? "InMail · Open to Work"
                      : t("Обычный InMail")}
                  </span>
                  <textarea
                    aria-invalid={!!fieldChecks["inmail_" + s].error}
                    aria-describedby={"inmail-feedback-" + s}
                    rows={4}
                    value={rules["inmail_" + s]}
                    onChange={(e) => field("inmail_" + s, e.target.value)}
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
      {rules.allow_inmail && rules.inmail_channel === "recruiter" && (
        <p className="field-feedback">
          {t(
            "Подпись Recruiter входит в лимит 1900 символов. Точный текст вместе с подписью проверим перед запуском.",
          )}
        </p>
      )}
      {active && (
        <p className="setup-caution">
          {t(
            "Сохранение изменений заменит текущий план. Запуск нужно будет подтвердить заново.",
          )}
        </p>
      )}
    </>
  );
}
