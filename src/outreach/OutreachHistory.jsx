// History of every contact attempt in a campaign.
import React from "react";
import { actionKinds, personStates } from "../labels";
import { DetailMessage, date } from "./parts";

export function OutreachHistory({
  runs,
  repairs = {},
  onRepair,
  checkDisabled,
  disabled,
  onResolve,
  onResume,
  onOpen,
  onCheck,
}) {
  const visible = runs.filter((r) => r.status !== "preview");
  if (!visible.length) return null;
  return (
    <section className="outreach-history" aria-label="Приглашения и сообщения">
      {visible.map((run) => (
        <div key={run.id} className="outreach-run">
          <div className="toolbar">
            <b>
              {personStates[run.status]} · {date(run.created)}
            </b>
            <span>
              Получателей: {run.members.length}
              {(run.rules.allow_inmail || run.credits_reserved > 0) && (
                <> · Учтено InMail-кредитов: {run.credits_reserved}</>
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
            <table className="history-table">
              <colgroup>
                <col style={{ width: "20%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "18%" }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>Состояние</th>
                  <th>Следующая проверка</th>
                  <th>Причина</th>
                </tr>
              </thead>
              <tbody>
                {run.members.map((m) => {
                  const uncertain = run.actions.some(
                    (a) =>
                      a.member_id === m.id &&
                      ["unknown", "submitting"].includes(a.status) &&
                      !a.repair_replaced_by,
                  );
                  const stoppedKnown =
                    ["cancelled", "completed"].includes(run.status) &&
                    !uncertain &&
                    m.status === "needs_review";
                  return (
                    <tr key={m.id} id={"member-" + m.id} tabIndex={-1}>
                      <td>
                        <button
                          className="text-link"
                          onClick={() => onOpen(m.url)}
                        >
                          {m.name || m.url}
                        </button>
                      </td>
                      <td>
                        {stoppedKnown
                          ? "План остановлен"
                          : personStates[m.status] || m.status}
                      </td>
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
                        <DetailMessage
                          detail={m.detail}
                          status={m.status}
                          stopped={stoppedKnown}
                        />
                        {repairs[m.id] && onRepair && (
                          <button
                            className="button primary small"
                            disabled={checkDisabled}
                            onClick={() => onRepair(repairs[m.id])}
                          >
                            Отправить приглашение
                          </button>
                        )}
                        {m.status === "needs_review" &&
                          !stoppedKnown &&
                          !uncertain &&
                          onCheck && (
                            <button
                              className="button small"
                              disabled={checkDisabled ?? disabled}
                              onClick={() => onCheck(m.id)}
                            >
                              Уточнить статус
                            </button>
                          )}
                        {m.reply_text && (
                          <blockquote>{m.reply_text}</blockquote>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {run.actions.map((a) => {
            const m = run.members.find((m) => m.id === a.member_id);
            return (
              <details
                className="action-record"
                key={a.id}
                id={"action-" + a.id}
                tabIndex={-1}
              >
                <summary>
                  {actionKinds[a.kind]} · {m?.name || a.url} ·{" "}
                  {a.repair_replaced_by
                    ? "Старая попытка"
                    : personStates[a.status]}{" "}
                  · {date(a.created)}
                </summary>
                {a.repair_replaced_by ? (
                  <p className="hint">
                    Исход старой попытки не подтверждён. Новая проверка
                    подтвердила актуальное состояние приглашения или связи;
                    повторная проверка этой старой записи не требуется.
                  </p>
                ) : (
                  <DetailMessage
                    detail={a.detail}
                    status={a.status}
                    kind={a.kind}
                    stopped={
                      ["cancelled", "completed"].includes(run.status) &&
                      a.status === "blocked"
                    }
                  />
                )}
                {a.kind === "inmail" && <b>Тема: {m?.subject}</b>}
                <pre>
                  {a.kind === "invite"
                    ? m?.invitation || "Приглашение без заметки"
                    : a.kind === "inmail"
                      ? m?.inmail_message
                      : m?.message}
                </pre>
                {a.status === "unknown" && !a.repair_replaced_by && (
                  <div className="actions">
                    {a.kind === "inmail" && (run.context || m?.subject) && (
                      <p className="hint">
                        Эту старую отправку InMail нельзя надёжно проверить
                        автоматически. Откройте переписку в LinkedIn и укажите
                        результат вручную.
                      </p>
                    )}
                    {onCheck &&
                      m &&
                      !(a.kind === "inmail" && (run.context || m.subject)) && (
                        <button
                          className="button"
                          disabled={checkDisabled ?? disabled}
                          onClick={() => onCheck(m.id)}
                        >
                          Уточнить статус
                        </button>
                      )}
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
