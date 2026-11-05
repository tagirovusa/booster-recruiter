// Status of an approved plan: counts, next step and pause/resume.
import React from "react";
import { ChevronDown, Pause, Play, RefreshCw } from "lucide-react";
import { DetailMessage } from "./parts";

export function LivePlanPanel({ ctx }) {
  const {
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
  } = ctx;
  return (
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
            Приложение посмотрит в LinkedIn текущие статусы. Ничего не отправит.
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
  );
}
