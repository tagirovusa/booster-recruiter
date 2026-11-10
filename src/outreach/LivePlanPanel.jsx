// Status of an approved plan: counts, next step and pause/resume.
import React from "react";
import { ChevronDown, Pause, Play, RefreshCw } from "lucide-react";
import { DetailMessage } from "./parts";
import { t } from "../i18n";

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
          <span className="eyebrow">{t("КАМПАНИЯ")}</span>
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
            ? t("Дождитесь завершения")
            : nextEvent.kind === "account"
              ? t("Открыть аккаунты")
              : nextEvent.kind === "review"
                ? t("Посмотреть")
                : active.status === "active"
                  ? t("Пауза")
                  : t("Продолжить")}
        </button>
      </div>
      <div className="automation-results">
        <div>
          <strong>{counts.waiting}</strong>
          <span>{t("Ждём принятия")}</span>
        </div>
        <div>
          <strong>{counts.sent}</strong>
          <span>{t("Сообщения отправлены")}</span>
        </div>
        <div>
          <strong>{counts.replied}</strong>
          <span>{t("Ответы получены")}</span>
        </div>
        {reviewMembers.length > 0 && (
          <div>
            <strong>{reviewMembers.length}</strong>
            <span>{t("Требуют внимания")}</span>
          </div>
        )}
      </div>
      {active.status === "paused" && recoverableMembers.length > 0 && (
        <div className="recovery-check">
          <p>
            {t(
              "Приложение посмотрит в LinkedIn текущие статусы. Ничего не отправит.",
            )}
          </p>
          <button className="button" disabled={disabled} onClick={onCheck}>
            <RefreshCw size={16} /> {t("Обновить статусы контактов")}
          </button>
        </div>
      )}
      {(uncertainActions || reviewMembers.length > 0) && (
        <p className="recovery-history">
          {uncertainActions
            ? t(
                "Есть действия с неподтверждённым результатом. Проверьте их в LinkedIn и укажите результат в истории.",
              )
            : t("Причины остановки каждого контакта доступны в истории.")}{" "}
          <button className="text-link" onClick={onHistory}>
            {t("Открыть историю")}
          </button>
        </p>
      )}
      {active.status === "active" && (
        <button
          className="button"
          disabled={disabled}
          onClick={() => onCheckNow(active.id)}
        >
          <RefreshCw size={16} /> {t("Проверить сейчас")}
        </button>
      )}
      <button className="text-link" onClick={() => setEditing(!editing)}>
        {editing ? t("Скрыть настройки") : t("Изменить настройки кампании")}
        <ChevronDown size={14} />
      </button>
    </section>
  );
}
