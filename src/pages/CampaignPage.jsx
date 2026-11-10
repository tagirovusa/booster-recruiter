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
import { labels } from "../labels";
import { t, tr } from "../i18n";
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
  // LinkedIn had no more results for this exact query; another search would
  // only walk the same empty pages.
  const searchExhausted =
    campaign.search_exhausted_keywords === campaign.keywords &&
    detail.candidates.length < campaign.max_profiles;
  const openEdit = () => {
    setCampaignEdit({
      name: campaign.name,
      max_profiles: campaign.max_profiles,
      keywords: campaign.keywords,
      armed: false,
    });
    setModal("edit-campaign");
  };
  return (
    <>
      <button className="text-button muted" onClick={() => setCid(null)}>
        <ArrowLeft size={16} />
        {t("Все кампании")}
      </button>
      <div className="page-heading detail">
        <div>
          <h1>{campaign.name}</h1>
          <p>
            {campaign.keywords}
            {account?.label && (
              <span className="muted-inline">
                {" "}
                · {t("отправитель:")} {account.label}
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
                      t("Кампания возвращена из архива."),
                    )
                  }
                >
                  <RotateCcw size={17} />
                  {t("Вернуть из архива")}
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
                {t("Удалить")}
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={openEdit}>
              <Pencil size={17} />
              {t("Изменить")}
            </Button>
          )}
          <Button
            disabled={archived || active || busy}
            title={
              active
                ? t("Шаблон можно сохранить, когда кампания на паузе.")
                : archived
                  ? t("Кампания в архиве.")
                  : undefined
            }
            onClick={() => {
              setTemplateName(campaign.name);
              setModal("save-template");
            }}
          >
            {t("Сохранить шаблон")}
          </Button>
          <Button
            disabled={active || busy}
            title={
              active
                ? t("Выгрузка доступна, когда кампания на паузе или завершена.")
                : undefined
            }
            onClick={() => doExport("xlsx")}
          >
            <Download size={17} />
            Excel
          </Button>
          {archived ? (
            <span className="search-complete">
              {t("В архиве · только история")}
            </span>
          ) : active || liveRun ? (
            <Button
              onClick={() =>
                act(
                  "campaign.pause",
                  { id: cid },
                  t("Пауза запрошена. Завершаем текущую операцию."),
                )
              }
            >
              <Pause size={17} />
              {t("Пауза")}
            </Button>
          ) : detail.candidates.length >= campaign.max_profiles ? (
            <span
              className="search-complete"
              title={t(
                "Чтобы найти больше людей, нажмите «Изменить» и увеличьте число профилей.",
              )}
            >
              <CheckCircle2 size={17} />
              {t("Поиск завершён")}
            </span>
          ) : searchExhausted ? (
            <>
              <span
                className="search-complete"
                title={t(
                  "Чтобы найти больше людей, упростите запрос в новой кампании или измените число профилей.",
                )}
              >
                <CheckCircle2 size={17} />
                {t("Поиск завершён — LinkedIn больше ничего не находит")}
              </span>
              <Button disabled={busy} onClick={openEdit}>
                <Pencil size={17} />
                {t("Изменить поиск")}
              </Button>
            </>
          ) : (
            <Button
              kind={tab === "people" ? "primary" : ""}
              disabled={busy || account?.status !== "ready"}
              onClick={() => act("campaign.collect", { id: cid })}
            >
              <Search size={17} />
              {detail.candidates.length
                ? t("Продолжить поиск")
                : t("Найти кандидатов")}
            </Button>
          )}
        </div>
      </div>
      {archived && (
        <div className="hint">
          {account?.status === "deleted"
            ? t(
                "Аккаунт удалён. История и экспорт сохранены; новые отправки из этой кампании недоступны.",
              )
            : t(
                "Кампания в архиве. История и экспорт сохранены. Чтобы продолжить работу, верните её из архива.",
              )}
        </div>
      )}
      {!archived && account?.status !== "ready" && (
        <div className="hint warning">
          {account?.status === "new"
            ? t(
                "Подключите аккаунт {label}, чтобы искать кандидатов и запускать кампанию.",
                { label: account.label },
              )
            : t(
                "Аккаунт {label} не готов: {status}. Поиск и отправка продолжатся после входа.",
                {
                  label: account?.label || t("отправителя"),
                  status:
                    labels[account?.status]?.toLowerCase() ||
                    t("проверьте вход"),
                },
              )}{" "}
          <button className="text-link" onClick={() => goTo("accounts")}>
            {t("Открыть аккаунты")}
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
              {tr(campaign.progress) ||
                t(
                  "Кампания готова. Нажмите «Найти кандидатов», чтобы начать сбор.",
                )}
            </p>
          </div>
          <Badge value={campaign.status} />
        </div>
      )}
      {tab === "people" && (
        <div className="stats compact">
          <Stat
            label={t("Найдено профилей")}
            value={detail.candidates.length}
          />
          <Stat
            label="Open to Work"
            value={detail.candidates.filter((p) => p.segment === "open").length}
          />
          <Stat
            label={t("Обычный текст")}
            value={
              detail.candidates.filter((p) => p.segment === "neutral").length
            }
          />
          {unassigned > 0 && (
            <Stat label={t("Без группы")} value={unassigned} />
          )}
          <Stat label={t("Выбрано для сообщения")} value={selected.length} />
        </div>
      )}
      <div className="tabs">
        {[
          ["people", t("Кандидаты"), Users],
          ["automation", t("Отправка"), Settings],
          ["history", t("История"), Inbox],
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
              <h2>{t("История контактов")}</h2>
              <p>
                {t(
                  "Приглашения, сообщения и ответы. Статус «Отправлено» подтверждает отправку в LinkedIn, но не прочтение.",
                )}
              </p>
            </div>
            <Button onClick={() => doExport("csv")}>
              <Download size={16} />
              {t("Список в CSV")}
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
                ? t(
                    "Пока кампания работает, список кандидатов не меняется. Поставьте её на паузу.",
                  )
                : archived
                  ? t("Кампания в архиве.")
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
                <h3 className="history-message-title">
                  {t("Другие сообщения")}
                </h3>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Получатель")}</th>
                      <th>{t("Результат")}</th>
                      <th>{t("Подробности")}</th>
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
                              <summary>{t("Текст сообщения")}</summary>
                              <p className="message-text">
                                {p.delivery[0].message}
                              </p>
                            </details>
                            {p.delivery[0].status === "unknown" && (
                              <div className="resolution">
                                <p>
                                  {t(
                                    "Откройте диалог и проверьте, появилось ли это сообщение.",
                                  )}
                                </p>
                                <Button
                                  disabled={archived || active || busy}
                                  onClick={() =>
                                    recheckAttention(
                                      "delivery:" + p.delivery[0].id,
                                    )
                                  }
                                >
                                  {t("Уточнить статус")}
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
                                  {t("Открыть LinkedIn")}
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
                                  {t("Сообщение есть")}
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
                                  {t("Сообщения нет")}
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
              <h3>{t("Обращений пока нет")}</h3>
              <p>
                {t(
                  "После запуска здесь появятся приглашения, сообщения и результаты по каждому кандидату.",
                )}
              </p>
              <Button onClick={() => setTab("automation")}>
                {t("Настроить отправку")}
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
                placeholder={t("Найти в списке")}
                aria-label={t("Найти кандидата")}
              />
            </label>
            <select
              aria-label={t("Группа кандидатов")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">{t("Все группы")}</option>
              <option value="open">Open to Work</option>
              <option value="neutral">{t("Обычный текст")}</option>
              <option value="review">{t("Без группы")}</option>
            </select>
            <div className="spacer" />
            <Button
              kind="primary"
              disabled={!selected.length || active || busy}
              onClick={() => setTab("automation")}
            >
              <MessageSquare size={17} />
              {t("Настроить отправку")}{" "}
              {selected.length > 0 && `(${selected.length})`}
            </Button>
          </div>
          {people.length > 0 && (
            <div className="selection-toolbar">
              <span>
                {t("Показано: {shown} · Доступно для выбора: {available}", {
                  shown: people.length,
                  available: people.filter(eligible).length,
                })}
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
                  {t("Выбрать доступных")}
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
                  {t("Снять выбор")}
                </button>
              </div>
            </div>
          )}
          {people.length ? (
            <div className="table-scroll">
              <table className="people">
                <thead>
                  <tr>
                    <th>{t("Выбор")}</th>
                    <th>{t("Кандидат")}</th>
                    <th>{t("Группа сообщения")}</th>
                    <th>{t("Состояние")}</th>
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
                          aria-label={t("Выбрать {name}", {
                            name: p.data.name || p.url,
                          })}
                          checked={!!p.selected && eligible(p)}
                          title={
                            tr(p.outreach_exclusion) ||
                            t("Выбрать для этой кампании")
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
                              alt={t("Аватар кандидата")}
                            />
                          ) : (
                            <div className="avatar small">
                              {initials(p.data.name)}
                            </div>
                          )}
                          <span>
                            <b>{p.data.name || t("Имя не определено")}</b>
                            <small>
                              {p.data.headline ||
                                t("Откройте профиль для проверки данных")}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <select
                          value={p.segment}
                          disabled={archived || active || busy}
                          aria-label={t("Группа {name}", {
                            name: p.data.name || p.url,
                          })}
                          onChange={(e) =>
                            review(
                              p,
                              e.target.value,
                              e.target.value === "review" ? false : p.selected,
                            )
                          }
                        >
                          <option value="review">{t("Без группы")}</option>
                          <option value="open">Open to Work</option>
                          <option value="neutral">{t("Обычный текст")}</option>
                        </select>
                      </td>
                      <td>
                        {!eligible(p) && (
                          <span className="sr-only" id={`eligibility-${p.id}`}>
                            {tr(p.outreach_exclusion)}
                          </span>
                        )}
                        {p.blocked ? (
                          <span className="badge blocked">
                            {t("Не контактировать")}
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
                              ? t("Рамка Hiring")
                              : p.segment === "review"
                                ? t("Выберите группу")
                                : eligible(p)
                                  ? t("Готов к выбору")
                                  : tr(p.outreach_exclusion)}
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon"
                          aria-label={t("Открыть в LinkedIn")}
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
                  ? t("Нет совпадений")
                  : t("Профили появятся после поиска")}
              </h3>
              {detail.candidates.length ? (
                <>
                  <p>
                    {t(
                      "Поиск и фильтр скрыли профили. Измените запрос или сбросьте фильтры.",
                    )}
                  </p>
                  <Button
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    {t("Сбросить фильтры")}
                  </Button>
                </>
              ) : (
                <p>
                  {t(
                    "Нажмите «Найти кандидатов», чтобы собрать профили по вашему запросу.",
                  )}
                </p>
              )}
            </div>
          )}
          <div className="table-footer">
            <span>
              {t("Показано: {count} {word} · Всего выбрано: {selected}", {
                count: people.length,
                word: profileWord(people.length),
                selected: selected.length,
              })}
            </span>
            <span>{t("Изменение группы сохраняется автоматически")}</span>
          </div>
        </div>
      )}
    </>
  );
}
