// Small pieces shared by outreach setup and history.
import React from "react";
import { personStates, relations } from "../labels";

export function TemplateFeedback({ id, value, limit = 1900, extra = "" }) {
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

export function DetailMessage({ detail, status, kind, stopped = false }) {
  const original = String(detail ?? "");
  const text = original.trim();
  if (!text) return null;
  if (stopped && status !== "unknown" && status !== "submitting")
    return (
      <div className="detail-message">
        <p>
          План остановлен; дальнейшие действия не выполняются.
          {/you are already connected with this profile/i.test(text)
            ? " LinkedIn сообщил, что профиль уже в контактах. Новое приглашение не требуется."
            : ""}
        </p>
        <details className="technical-details">
          <summary>Подробности прошлого действия</summary>
          <pre>{original}</pre>
        </details>
      </div>
    );
  if (/you are already connected with this profile/i.test(text))
    return (
      <p className="detail-message">
        LinkedIn сообщил, что вы уже в контактах. Приглашение не требуется.
        Нажмите «Уточнить статус», чтобы обновить состояние без отправки.
      </p>
    );
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
        "Проверьте сохранённую причину остановки перед продолжением кампании.",
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

export const date = (v) => (v ? new Date(v).toLocaleString("ru-RU") : "—");
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
      ? personStates[member.status] || member.status
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
