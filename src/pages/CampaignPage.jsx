// One campaign: its candidates, outreach setup and history.
//
// App owns the workspace state (selection, dialogs, polling); this screen
// receives what it needs through a single context object.
import React from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Inbox,
  LoaderCircle,
  MessageSquare,
  Pause,
  Pencil,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Users,
} from "lucide-react";
import { Automation } from "../outreach/Automation";
import { OutreachHistory } from "../outreach/OutreachHistory";
import { ContactState, DetailMessage } from "../outreach/parts";
import { Badge, Button, Stat, fmt, initials, profileWord } from "../ui";

const api = window.booster;

export default function CampaignPage({ ctx }) {
  const {
    account,
    act,
    active,
    archived,
    automationDrafts,
    busy,
    campaign,
    cid,
    contactMembers,
    detail,
    doExport,
    draftPersisted,
    eligible,
    filter,
    goTo,
    hasMessageHistory,
    hasOutreachHistory,
    liveRun,
    openInSenderAccount,
    people,
    persistDraft,
    previewing,
    query,
    recheckAttention,
    review,
    saveAutomation,
    selectVisible,
    selected,
    setCampaignEdit,
    setCid,
    setError,
    setFilter,
    setInvitationRepair,
    setModal,
    setPerson,
    setQuery,
    setTab,
    setTemplateName,
    tab,
    workspaceSummary,
  } = ctx;
  const unassigned = detail.candidates.filter(
    (p) => p.segment === "review",
  ).length;
  return (
    <>
      <button className="text-button muted" onClick={() => setCid(null)}>
        <ArrowLeft size={16} />
        Все кампании
      </button>
      <div className="page-heading detail">
        <div>
          <h1>{campaign.name}</h1>
          <p>
            {campaign.keywords}
            {account?.label && (
              <span className="muted-inline">
                {" "}
                · отправитель: {account.label}
              </span>
            )}
          </p>
        </div>
        <div className="actions">
          {campaign.status === "archived" ? (
            <>
              {account?.status !== "deleted" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(
                      "campaign.restore",
                      { id: cid },
                      "Кампания возвращена из архива.",
                    )
                  }
                >
                  <RotateCcw size={17} />
                  Вернуть из архива
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() => {
                  setCampaignEdit({ deleteOnly: true, armed: true });
                  setModal("edit-campaign");
                }}
              >
                <Trash2 size={17} />
                Удалить
              </Button>
            </>
          ) : (
            <Button
              disabled={busy}
              onClick={() => {
                setCampaignEdit({
                  name: campaign.name,
                  max_profiles: campaign.max_profiles,
                  keywords: campaign.keywords,
                  armed: false,
                });
                setModal("edit-campaign");
              }}
            >
              <Pencil size={17} />
              Изменить
            </Button>
          )}
          <Button
            disabled={archived || active || busy}
            title={
              active
                ? "Шаблон можно сохранить, когда кампания на паузе."
                : archived
                  ? "Кампания в архиве."
                  : undefined
            }
            onClick={() => {
              setTemplateName(campaign.name);
              setModal("save-template");
            }}
          >
            Сохранить шаблон
          </Button>
          <Button
            disabled={active || busy}
            title={
              active
                ? "Выгрузка доступна, когда кампания на паузе или завершена."
                : undefined
            }
            onClick={() => doExport("xlsx")}
          >
            <Download size={17} />
            Excel
          </Button>
          {archived ? (
            <span className="search-complete">В архиве · только история</span>
          ) : active || liveRun ? (
            <Button
              onClick={() =>
                act(
                  "campaign.pause",
                  { id: cid },
                  "Пауза запрошена. Завершаем текущую операцию.",
                )
              }
            >
              <Pause size={17} />
              Пауза
            </Button>
          ) : detail.candidates.length >= campaign.max_profiles ? (
            <span
              className="search-complete"
              title="Чтобы найти больше людей, нажмите «Изменить» и увеличьте число профилей."
            >
              <CheckCircle2 size={17} />
              Поиск завершён
            </span>
          ) : (
            <Button
              kind={tab === "people" ? "primary" : ""}
              disabled={busy || account?.status !== "ready"}
              onClick={() => act("campaign.collect", { id: cid })}
            >
              <Search size={17} />
              {detail.candidates.length
                ? "Продолжить поиск"
                : "Найти кандидатов"}
            </Button>
          )}
        </div>
      </div>
      {archived && (
        <div className="hint">
          {account?.status === "deleted"
            ? "Аккаунт удалён. История и экспорт сохранены; новые отправки из этой кампании недоступны."
            : "Кампания в архиве. История и экспорт сохранены. Чтобы продолжить работу, верните её из архива."}
        </div>
      )}
      {!archived && account?.status !== "ready" && (
        <div className="hint warning">
          Подключите аккаунт отправителя, чтобы искать кандидатов и запускать
          кампанию.{" "}
          <button className="text-link" onClick={() => goTo("accounts")}>
            Открыть аккаунты
          </button>
        </div>
      )}
      {(tab === "people" || active || campaign.status === "paused") && (
        <div className={"progress-card " + (active ? "working" : "")}>
          <div>
            {active ? (
              <LoaderCircle size={20} className="spin" />
            ) : (
              <CheckCircle2 size={20} />
            )}
            <p>
              {campaign.progress ||
                "Кампания готова. Нажмите «Найти кандидатов», чтобы начать сбор."}
            </p>
          </div>
          <Badge value={campaign.status} />
        </div>
      )}
      {tab === "people" && (
        <div className="stats compact">
          <Stat label="Найдено профилей" value={detail.candidates.length} />
          <Stat
            label="Open to Work"
            value={detail.candidates.filter((p) => p.segment === "open").length}
          />
          <Stat
            label="Обычный текст"
            value={
              detail.candidates.filter((p) => p.segment === "neutral").length
            }
          />
          {unassigned > 0 && <Stat label="Без группы" value={unassigned} />}
          <Stat label="Выбрано для сообщения" value={selected.length} />
        </div>
      )}
      <div className="tabs">
        {[
          ["people", "Кандидаты", Users],
          ["automation", "Отправка", Settings],
          ["history", "История", Inbox],
        ]
          .filter(([id]) => !archived || id === "history")
          .map(([id, name, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={17} />
              {name}
            </button>
          ))}
      </div>
      {tab === "automation" ? (
        <Automation
          key={cid}
          initialDraft={automationDrafts.current[cid]}
          onDraftChange={(draft) => {
            persistDraft(cid, draft);
          }}
          draftPersisted={draftPersisted}
          data={detail.outreach}
          campaign={campaign}
          account={account}
          selected={selected}
          disabled={archived || active || busy}
          previewing={previewing}
          onSave={saveAutomation}
          onPeople={() => setTab("people")}
          onHistory={() => setTab("history")}
          onAccounts={() => goTo("accounts")}
          onCheck={() => act("campaign.check", { id: cid })}
          onResume={(id) => act("outreach.resume", { id })}
          onCheckNow={(id) => act("outreach.check_now", { id })}
          onPause={() => act("campaign.pause", { id: cid })}
        />
      ) : tab === "history" ? (
        <div className="panel">
          <div className="panel-title">
            <div>
              <h2>История контактов</h2>
              <p>
                Приглашения, сообщения и ответы. Статус «Отправлено»
                подтверждает отправку в LinkedIn, но не прочтение.
              </p>
            </div>
            <Button onClick={() => doExport("csv")}>
              <Download size={16} />
              Список в CSV
            </Button>
          </div>
          <OutreachHistory
            runs={detail.outreach.runs}
            repairs={Object.fromEntries(
              (workspaceSummary?.items || [])
                .filter((i) => i.member_id && i.repair)
                .map((i) => [i.member_id, i]),
            )}
            onRepair={
              archived
                ? undefined
                : (item) => {
                    setInvitationRepair({
                      id: item.id,
                      ...item.repair,
                    });
                    setModal("retry-invitation");
                  }
            }
            checkDisabled={archived || busy}
            disabled={archived || active || busy}
            title={
              active
                ? "Пока кампания работает, список кандидатов не меняется. Поставьте её на паузу."
                : archived
                  ? "Кампания в архиве."
                  : undefined
            }
            onResolve={(id, confirmed) =>
              act("outreach.resolve", { id, confirmed })
            }
            onResume={(id) => act("outreach.resume", { id })}
            onOpen={
              archived
                ? (url) =>
                    api.openProfile(url).catch((e) => setError(e.message))
                : openInSenderAccount
            }
            onCheck={
              archived ? undefined : (id) => recheckAttention("review:" + id)
            }
          />
          {hasMessageHistory && (
            <>
              {hasOutreachHistory && (
                <h3 className="history-message-title">Другие сообщения</h3>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Получатель</th>
                      <th>Результат</th>
                      <th>Подробности</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.candidates
                      .filter((p) => p.delivery.length)
                      .map((p) => (
                        <tr
                          key={p.id}
                          id={
                            "action-" +
                            (
                              p.delivery.find((d) => d.status === "unknown") ||
                              p.delivery[0]
                            ).id
                          }
                          tabIndex={-1}
                        >
                          <td>
                            <button
                              className="text-button"
                              onClick={() => setPerson(p)}
                            >
                              {p.data.name || p.url}
                            </button>
                          </td>
                          <td>
                            <Badge value={p.delivery[0].status} />
                          </td>
                          <td>
                            <DetailMessage
                              detail={p.delivery[0].detail}
                              status={p.delivery[0].status}
                              kind="message"
                            />
                            <small>{fmt(p.delivery[0].updated)}</small>
                            <details>
                              <summary>Текст сообщения</summary>
                              <p className="message-text">
                                {p.delivery[0].message}
                              </p>
                            </details>
                            {p.delivery[0].status === "unknown" && (
                              <div className="resolution">
                                <p>
                                  Откройте диалог и проверьте, появилось ли это
                                  сообщение.
                                </p>
                                <Button
                                  disabled={archived || active || busy}
                                  onClick={() =>
                                    recheckAttention(
                                      "delivery:" + p.delivery[0].id,
                                    )
                                  }
                                >
                                  Уточнить статус
                                </Button>
                                <Button
                                  onClick={() =>
                                    archived
                                      ? api
                                          .openProfile(p.url)
                                          .catch((e) => setError(e.message))
                                      : openInSenderAccount(p.url)
                                  }
                                >
                                  Открыть LinkedIn
                                </Button>
                                <Button
                                  disabled={archived || active || busy}
                                  onClick={() =>
                                    act("delivery.resolve", {
                                      id: p.delivery[0].id,
                                      status: "sent",
                                    })
                                  }
                                >
                                  Сообщение есть
                                </Button>
                                <Button
                                  disabled={archived || active || busy}
                                  onClick={() =>
                                    act("delivery.resolve", {
                                      id: p.delivery[0].id,
                                      status: "blocked",
                                    })
                                  }
                                >
                                  Сообщения нет
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!hasMessageHistory && !hasOutreachHistory && (
            <div className="empty compact">
              <Inbox />
              <h3>Обращений пока нет</h3>
              <p>
                После запуска здесь появятся приглашения, сообщения и результаты
                по каждому кандидату.
              </p>
              <Button onClick={() => setTab("automation")}>
                Настроить автоматизацию
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="panel">
          <div className="toolbar">
            <label className="search">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Найти в списке"
                aria-label="Найти кандидата"
              />
            </label>
            <select
              aria-label="Группа кандидатов"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Все группы</option>
              <option value="open">Open to Work</option>
              <option value="neutral">Обычный текст</option>
              <option value="review">Без группы</option>
            </select>
            <div className="spacer" />
            <Button
              kind="primary"
              disabled={!selected.length || active || busy}
              onClick={() => setTab("automation")}
            >
              <MessageSquare size={17} />
              Настроить отправку {selected.length > 0 && `(${selected.length})`}
            </Button>
          </div>
          {people.length > 0 && (
            <div className="selection-toolbar">
              <span>
                Показано: {people.length} · Доступно для выбора:{" "}
                {people.filter(eligible).length}
              </span>
              <div>
                <button
                  className="text-link"
                  disabled={
                    active ||
                    busy ||
                    !people.some((p) => eligible(p) && !p.selected)
                  }
                  onClick={() => selectVisible(true)}
                >
                  Выбрать доступных
                </button>
                <button
                  className="text-link"
                  disabled={
                    active ||
                    busy ||
                    !people.some((p) => eligible(p) && p.selected)
                  }
                  onClick={() => selectVisible(false)}
                >
                  Снять выбор
                </button>
              </div>
            </div>
          )}
          {people.length ? (
            <div className="table-scroll">
              <table className="people">
                <thead>
                  <tr>
                    <th>Выбор</th>
                    <th>Кандидат</th>
                    <th>Группа сообщения</th>
                    <th>Состояние</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr
                      key={p.id}
                      className={p.selected && eligible(p) ? "selected" : ""}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={"Выбрать " + (p.data.name || p.url)}
                          checked={!!p.selected && eligible(p)}
                          title={
                            p.outreach_exclusion || "Выбрать для этой кампании"
                          }
                          aria-describedby={
                            !eligible(p) ? `eligibility-${p.id}` : undefined
                          }
                          disabled={active || busy || !eligible(p)}
                          onChange={(e) =>
                            review(p, p.segment, e.target.checked)
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="person-button"
                          onClick={() => setPerson(p)}
                        >
                          {p.data.photo ? (
                            <img
                              src={"data:image/png;base64," + p.data.photo}
                              alt="Аватар кандидата"
                            />
                          ) : (
                            <div className="avatar small">
                              {initials(p.data.name)}
                            </div>
                          )}
                          <span>
                            <b>{p.data.name || "Имя не определено"}</b>
                            <small>
                              {p.data.headline ||
                                "Откройте профиль для проверки данных"}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <select
                          value={p.segment}
                          disabled={archived || active || busy}
                          aria-label={"Группа " + (p.data.name || p.url)}
                          onChange={(e) =>
                            review(
                              p,
                              e.target.value,
                              e.target.value === "review" ? false : p.selected,
                            )
                          }
                        >
                          <option value="review">Без группы</option>
                          <option value="open">Open to Work</option>
                          <option value="neutral">Обычный текст</option>
                        </select>
                      </td>
                      <td>
                        {!eligible(p) && (
                          <span className="sr-only" id={`eligibility-${p.id}`}>
                            {p.outreach_exclusion}
                          </span>
                        )}
                        {p.blocked ? (
                          <span className="badge blocked">
                            Не контактировать
                          </span>
                        ) : contactMembers.has(p.id) || p.data.contact ? (
                          <ContactState
                            person={p}
                            member={contactMembers.get(p.id)}
                          />
                        ) : p.delivery.length &&
                          p.delivery[0].status !== "cancelled" ? (
                          <Badge value={p.delivery[0].status} />
                        ) : (
                          <span className="muted">
                            {p.data.photo_frame?.status === "hiring"
                              ? "Рамка Hiring"
                              : p.segment === "review"
                                ? "Выберите группу"
                                : eligible(p)
                                  ? "Готов к выбору"
                                  : p.outreach_exclusion}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon"
                          aria-label="Открыть в LinkedIn"
                          onClick={() => openInSenderAccount(p.url)}
                        >
                          <ExternalLink size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty compact">
              <Search />
              <h3>
                {detail.candidates.length
                  ? "Нет совпадений"
                  : "Профили появятся после поиска"}
              </h3>
              {detail.candidates.length ? (
                <>
                  <p>
                    Поиск и фильтр скрыли профили. Измените запрос или сбросьте
                    фильтры.
                  </p>
                  <Button
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    Сбросить фильтры
                  </Button>
                </>
              ) : (
                <p>
                  Нажмите «Найти кандидатов», чтобы собрать профили по вашему
                  запросу.
                </p>
              )}
            </div>
          )}
          <div className="table-footer">
            <span>
              Показано: {people.length} {profileWord(people.length)} · Всего
              выбрано: {selected.length}
            </span>
            <span>Изменение группы сохраняется автоматически</span>
          </div>
        </div>
      )}
    </>
  );
}
