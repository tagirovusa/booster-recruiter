// The campaign list: active and archived campaigns at a glance.
import React from "react";
import { ArrowRight, ChevronRight, Plus, Search } from "lucide-react";
import { Badge, Button, Empty, Stat } from "../ui";
import { t } from "../i18n";

export default function CampaignsPage({
  state,
  accounts,
  templates,
  showArchived,
  onShowArchived,
  campaigns,
  onOpen,
  onModal,
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("Ваши кампании")}</h1>
          <p>{t("От поискового запроса до сохранённого списка кандидатов.")}</p>
        </div>
        <Button
          kind="primary"
          onClick={() =>
            onModal(state.accounts.length ? "campaign" : "account")
          }
        >
          <Plus size={18} />
          {state.accounts.length ? t("Новая кампания") : t("Подключить LinkedIn")}
        </Button>
      </div>

      {templates.length > 0 && (
        <div className="workspace-template-shortcut">
          <Button onClick={() => onModal("template")}>
            {t("Создать из шаблона")}
          </Button>
        </div>
      )}
      <div className="archive-tabs" aria-label={t("Список кампаний")}>
        <button
          className={"button " + (!showArchived ? "primary" : "")}
          aria-pressed={!showArchived}
          onClick={() => onShowArchived(false)}
        >
          {t("Активные")}
        </button>
        <button
          className={"button " + (showArchived ? "primary" : "")}
          aria-pressed={showArchived}
          onClick={() => onShowArchived(true)}
        >
          {t("Архив · {count}", {
            count: (state.archived_campaigns || []).length,
          })}
        </button>
      </div>
      <div className="stats">
        <Stat label={t("Кампании")} value={state.campaigns.length} />
        <Stat
          label={t("Сохранённые профили")}
          value={state.campaigns.reduce((n, c) => n + c.count, 0)}
        />
        <Stat
          label={t("Готовые аккаунты")}
          value={state.accounts.filter((a) => a.status === "ready").length}
        />
      </div>
      {!campaigns.length ? (
        <Empty
          icon={Search}
          title={
            showArchived
              ? t("Архив пока пуст")
              : t("Найдите людей для вашей следующей вакансии")
          }
          text={
            showArchived
              ? t("История кампаний удалённых аккаунтов появится здесь.")
              : t("Задайте ключевые слова и подготовьте сообщения. Программа сохранит найденные профили и поможет проверить их перед отправкой.")
          }
          action={
            <Button
              kind="primary"
              onClick={() =>
                onModal(state.accounts.length ? "campaign" : "account")
              }
            >
              {state.accounts.length
                ? t("Создать первую кампанию")
                : t("Подключить LinkedIn")}
              <ArrowRight size={18} />
            </Button>
          }
        />
      ) : (
        <div className="panel">
          <div className="panel-title">
            <h2>{showArchived ? t("Архив кампаний") : t("Все кампании")}</h2>
            <span>{t("{count} всего", { count: campaigns.length })}</span>
          </div>
          <div className="table-scroll">
            <table className="campaign-table">
              <thead>
                <tr>
                  <th>{t("Кампания")}</th>
                  <th>{t("Отправитель")}</th>
                  <th>{t("Профили")}</th>
                  <th>{t("Статус")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    className="clickable"
                    key={c.id}
                    onClick={() => onOpen(c.id)}
                  >
                    <td>
                      <button
                        className="text-button campaign-entry"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(c.id);
                        }}
                      >
                        {c.name}
                      </button>
                      <small>{c.keywords}</small>
                    </td>
                    <td>
                      {accounts.find((a) => a.id === c.account_id)?.label}
                    </td>
                    <td className="number">{c.count}</td>
                    <td>
                      <Badge value={c.status} />
                    </td>
                    <td>
                      <ChevronRight size={18} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
