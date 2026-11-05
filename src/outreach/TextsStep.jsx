// Step 2 of outreach setup: the message for each candidate group.
import React from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { TemplateFeedback } from "./parts";

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
        <h3>Что получат кандидаты?</h3>
        <p>
          Для каждой группы — свой текст. Программа подставит имя и покажет итог
          перед запуском.
        </p>
      </div>
      <div className="setup-message-grid">
        {["open", "neutral"].map((segment) => (
          <div className="setup-message-card" key={segment}>
            <div className="message-group-title">
              <span className={"group-dot " + segment} />
              <strong>
                {segment === "open" ? "Open to Work" : "Обычный текст"}
              </strong>
              <small>
                {segment === "open" ? openCount : neutralCount} выбрано
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
                  {segment === "open" ? "Open to Work" : "нейтральное"}
                </span>
                <input
                  aria-invalid={!!fieldChecks["subject_" + segment].error}
                  aria-describedby={"subject-feedback-" + segment}
                  value={rules["subject_" + segment]}
                  onChange={(e) => field("subject_" + segment, e.target.value)}
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
                {segment === "open" ? "Open to Work" : "нейтральное"}
              </span>
              <textarea
                aria-invalid={!!fieldChecks[segment].error}
                aria-describedby={"message-feedback-" + segment}
                aria-label={
                  "Сообщение · " +
                  (segment === "open" ? "Open to Work" : "нейтральное")
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
                <code>{"{first_name}"}</code> заменится на имя кандидата
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
            <p>Оставьте поля пустыми, чтобы использовать сообщения выше.</p>
            <div className="setup-message-grid">
              {["open", "neutral"].map((s) => (
                <label className="field" key={s}>
                  <span>
                    {s === "open" ? "InMail · Open to Work" : "Обычный InMail"}
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
          Подпись Recruiter входит в лимит 1900 символов. Точный текст вместе с
          подписью проверим перед запуском.
        </p>
      )}
      {active && (
        <p className="setup-caution">
          Сохранение изменений заменит текущий план. Запуск нужно будет
          подтвердить заново.
        </p>
      )}
    </>
  );
}
