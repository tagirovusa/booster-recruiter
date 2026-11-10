// Small pieces shared by outreach setup and history.
import React from "react";
import { personStates, relations } from "../labels";
import { t, tr, formatDateTime } from "../i18n";

export function TemplateFeedback({ id, value, limit = 1900, extra = "" }) {
  return (
    <span id={id} className="field-feedback">
      <small>
        {t("{count} / {limit} символов", { count: value.count, limit })}
        {value.rendered
          ? t(" · максимум после подстановки")
          : t(" · в шаблоне")}
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

export function DetailMessage({ detail, status, kind, stopped = false }) {
  const original = String(detail ?? "");
  const text = original.trim();
  if (!text) return null;
  if (stopped && status !== "unknown" && status !== "submitting")
    return (
      <div className="detail-message">
        <p>
          {t("План остановлен; дальнейшие действия не выполняются.")}
          {/you are already connected with this profile/i.test(text)
            ? t(
                " LinkedIn сообщил, что профиль уже в контактах. Новое приглашение не требуется.",
              )
            : ""}
        </p>
        <details className="technical-details">
          <summary>{t("Подробности прошлого действия")}</summary>
          <pre>{tr(original)}</pre>
        </details>
      </div>
    );
  if (/you are already connected with this profile/i.test(text))
    return (
      <p className="detail-message">
        {t(
          "LinkedIn сообщил, что вы уже в контактах. Приглашение не требуется. Нажмите «Уточнить статус», чтобы обновить состояние без отправки.",
        )}
      </p>
    );
  // Keep readable product guidance intact. Transport envelopes and diagnostics
  // remain available verbatim, but are not the recruiter's primary next step.
  const technical =
    /^[{[]|^(?:Traceback|Error invoking remote method|\w*(?:Error|Exception):)/i.test(
      text,
    ) || /\bCall log:|"(?:message|error|meta)"\s*:/.test(text);
  const russianStart =
    /^(?:[«"'“]?[А-Яа-яЁё]|(?:LinkedIn|InMail|Recruiter)\s+[А-Яа-яЁё])/; // i18n-ignore
  const russian = russianStart.test(text);
  if (russian && !technical)
    return <p className="detail-message">{tr(original)}</p>;

  const check =
    kind === "invite"
      ? t("Проверьте приглашение в профиле LinkedIn.")
      : kind === "message" || kind === "inmail"
        ? t("Проверьте переписку в LinkedIn.")
        : t("Проверьте профиль и переписку в LinkedIn.");
  const guidance =
    {
      sent:
        kind === "invite"
          ? t("Отправка приглашения подтверждена в LinkedIn.")
          : t("Отправка сообщения подтверждена в LinkedIn."),
      replied: t(
        "Получен ответ кандидата. Автоматические обращения прекращены.",
      ),
      unknown: t(
        "Результат отправки не подтверждён. {check} Не повторяйте отправку до проверки, чтобы избежать дубликата.",
        { check },
      ),
      needs_review: t(
        "Результат требует ручной проверки. {check} Не повторяйте действие до проверки.",
        { check },
      ),
      blocked: t(
        "Действие остановлено. {check} Перед новой попыткой изучите технические подробности ниже.",
        { check },
      ),
      unavailable: t(
        "Действие сейчас недоступно. {check} Технические подробности сохранены ниже.",
        { check },
      ),
      submitting: t(
        "Действие выполняется. Дождитесь результата и не запускайте его повторно.",
      ),
      waiting_acceptance: t(
        "Приглашение ожидает принятия. Его состояние можно проверить в LinkedIn.",
      ),
      waiting_credits: t(
        "Для продолжения проверьте доступные InMail-кредиты аккаунта.",
      ),
      waiting_budget: t(
        "Проверьте сохранённую причину остановки перед продолжением кампании.",
      ),
      excluded: t(
        "Кандидат исключён из этого плана. Подробности сохранены ниже.",
      ),
      finished: t(
        "Наблюдение за кандидатом завершено. Подробности сохранены ниже.",
      ),
      cancelled: t("План остановлен. Подробности сохранены ниже."),
      paused: t(
        "План приостановлен. Проверьте подробности перед возобновлением.",
      ),
    }[status] || t("{check} Подробности сохранены ниже.", { check });
  return (
    <div className="detail-message">
      <p>{guidance}</p>
      <details className="technical-details">
        <summary>{t("Технические подробности")}</summary>
        <pre>{tr(original)}</pre>
      </details>
    </div>
  );
}

export const date = (v) => formatDateTime(v);
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
      ? t("План остановлен")
      : t("Наблюдение завершено")
    : member
      ? personStates[member.status] || member.status
      : relations[contact.relationship] || relations.unknown;
  const detail = stopped
    ? member.invitation_at || member.status === "waiting_acceptance"
      ? t(
          "Приглашение уже было отправлено. Проверки принятия и последующие сообщения остановлены.",
        )
      : t(
          "Этот план больше не выполняется. Для новых обращений подготовьте новый план.",
        )
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
          {t("Автоматические проверки продолжатся после возобновления плана.")}
        </small>
      )}
      {(member?.checked_at || contact.checked_at) && (
        <small>
          {t("Проверено: {when}", {
            when: date(member?.checked_at || contact.checked_at),
          })}
        </small>
      )}
    </div>
  );
}
