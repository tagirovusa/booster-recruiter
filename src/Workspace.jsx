import React, { useState } from "react";
import { ArrowRight, Check, Inbox, RefreshCw, Trash2 } from "lucide-react";
import "./workspace.css";
import { attentionKinds } from "./labels";
import { formatDateTime, t, tr } from "./i18n";

export function AttentionPanel({
  summary,
  error,
  disabled,
  onOpen,
  onReply,
  onRead,
  onCheck,
  onRepair,
  checkingItem,
  onRetry,
  onSettings,
  campaigns = [],
  accounts = [],
}) {
  const [filter, setFilter] = useState("all");
  const items = (summary?.items || []).filter(
    (item) => filter === "all" || item.kind === filter,
  );
  return (
    <section
      className="panel workspace-attention"
      aria-label={t("Требуют внимания")}
    >
      {summary?.backup_error && (
        <div className="workspace-empty" role="alert">
          <p>
            {t("Не удалось создать автоматическую резервную копию. Откройте настройки и сохраните копию вручную.")}
          </p>
          <button className="button" onClick={onSettings}>
            {t("Открыть настройки")}
          </button>
        </div>
      )}
      {error ? (
        <div className="workspace-empty" role="status">
          <p>{t("Не удалось обновить список внимания. Кампании сохранены.")}</p>
          <button className="button" onClick={onRetry}>
            <RefreshCw size={16} />
            {t("Повторить")}
          </button>
        </div>
      ) : !summary ? (
        <p className="workspace-empty">{t("Обновляем список…")}</p>
      ) : (
        <>
          <div className="attention-filters" aria-label={t("Фильтр внимания")}>
            <button
              aria-pressed={filter === "all"}
              className={filter === "all" ? "chosen" : ""}
              onClick={() => setFilter("all")}
            >
              <span>{t("Все")}</span>
              <b>{summary.items.length}</b>
            </button>
            {Object.entries(attentionKinds).map(([kind, label]) => (
              <button
                key={kind}
                aria-pressed={filter === kind}
                className={filter === kind ? "chosen" : ""}
                onClick={() => setFilter(kind)}
              >
                <span>{label}</span>
                <b>{summary.counts[kind] || 0}</b>
              </button>
            ))}
          </div>
          {!items.length ? (
            <div className="workspace-empty">
              <Inbox size={24} />
              <p>
                {filter === "all"
                  ? t("Всё в порядке. Новые ответы и действия появятся здесь.")
                  : t("В этой группе пока нет действий.")}
              </p>
            </div>
          ) : (
            <ul className="attention-list">
              {items.map((item) => (
                <li key={item.id} id={"attention-" + item.id} tabIndex={-1}>
                  <div className="attention-copy">
                    <span className="attention-kind">
                      {attentionKinds[item.kind]}
                    </span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.kind === "login"
                        ? t("Аккаунт LinkedIn")
                        : [
                            campaigns.find((c) => c.id === item.campaign_id)
                              ?.name,
                            accounts.find((a) => a.id === item.account_id)
                              ?.label,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </small>
                    <p>{tr(item.detail)}</p>
                    {item.repairing && (
                      <p role="status" className="repair-ready">
                        {t("Проверяем профиль и отправляем приглашение…")}
                      </p>
                    )}
                    {item.repair_error && (
                      <p className="hint warning">{tr(item.repair_error)}</p>
                    )}
                    {item.repair && (
                      <p className="repair-ready">
                        {t("Сейчас доступно новое приглашение. Отправьте его после проверки получателя и текста.")}
                      </p>
                    )}
                    {item.check_error && (
                      <p className="hint warning">{tr(item.check_error)}</p>
                    )}
                    {item.kind === "review" && item.can_recheck === false && (
                      <p className="hint">
                        {tr(item.recheck_unavailable_reason) ||
                          t("Для этой записи автоматическая проверка недоступна. Проверьте переписку в LinkedIn и укажите результат в истории.")}
                      </p>
                    )}
                    {item.kind === "review" &&
                      item.can_recheck !== false &&
                      !item.repair &&
                      !item.repairing && (
                        <small>
                          {t("Приложение посмотрит в LinkedIn, дошло ли сообщение. Ничего не отправит.")}
                        </small>
                      )}
                    {item.updated && (
                      <small>
                        {formatDateTime(item.updated)}
                      </small>
                    )}
                  </div>
                  <div className="attention-actions">
                    {item.repair && (
                      <button
                        className="button primary"
                        disabled={disabled || item.checking || item.repairing}
                        onClick={() => onRepair(item)}
                      >
                        {item.repairing
                          ? t("Проверяем и отправляем…")
                          : t("Отправить приглашение")}
                      </button>
                    )}
                    {item.kind === "review" &&
                      item.can_recheck !== false &&
                      !item.repair &&
                      !item.repairing && (
                        <button
                          className="button"
                          disabled={
                            disabled ||
                            !!checkingItem ||
                            item.checking ||
                            item.repairing
                          }
                          onClick={() => onCheck(item.id)}
                        >
                          <RefreshCw size={16} />
                          {checkingItem === item.id || item.checking
                            ? t("Проверяем…")
                            : t("Уточнить статус")}
                        </button>
                      )}
                    {item.kind === "reply" && item.url && onReply && (
                      <button
                        className="button primary"
                        disabled={disabled}
                        onClick={() => onReply(item)}
                      >
                        {t("Ответить в LinkedIn")}
                      </button>
                    )}
                    <button
                      className="button"
                      disabled={disabled}
                      onClick={() => onOpen(item)}
                    >
                      {item.kind === "login" || item.needs_sign_in
                        ? t("Открыть аккаунт")
                        : item.kind === "reply"
                          ? t("Открыть ответ")
                          : item.can_recheck === false
                            ? t("Посмотреть историю")
                            : t("Подробности")}
                      <ArrowRight size={16} />
                    </button>
                    {item.kind === "reply" && (
                      <button
                        className="text-button"
                        disabled={disabled}
                        onClick={() => onRead(item.id)}
                      >
                        <Check size={14} />
                        {t("Прочитано")}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function buildSearch({
  roles = "",
  industry = "",
  phrases = "",
  excluded = "",
  all = false,
}) {
  const terms = (value) => [
    ...new Set(
      value
        .split(/[\n,;]/)
        .map((v) => v.trim().replace(/["“”]/g, ""))
        .filter(Boolean),
    ),
  ];
  const quote = (value) => `"${value}"`;
  const group = (value, operator) => {
    const list = terms(value).map(quote);
    return list.length > 1 ? `(${list.join(` ${operator} `)})` : list[0] || "";
  };
  const positive = [
    group(roles, "OR"),
    group(industry, "OR"),
    group(phrases, all ? "AND" : "OR"),
  ]
    .filter(Boolean)
    .join(" AND ");
  const negative = terms(excluded)
    .map((term) => `NOT ${quote(term)}`)
    .join(" AND ");
  return positive ? [positive, negative].filter(Boolean).join(" AND ") : "";
}

export function SearchBuilder({ value, onChange, invalid, errorId }) {
  const [advanced, setAdvanced] = useState(Boolean(value));
  const [resetPending, setResetPending] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [fields, setFields] = useState({
    roles: "",
    industry: "",
    phrases: "",
    excluded: "",
    all: false,
  });
  const update = (key, v) => {
    const next = { ...fields, [key]: v };
    setFields(next);
    onChange(buildSearch(next));
  };
  return (
    <section className="search-builder" aria-label={t("Настройка поиска")}>
      <div className="workspace-inline-heading">
        <strong>{t("Кого ищем?")}</strong>
        <button
          type="button"
          className="text-link"
          onClick={() => {
            if (advanced && value !== buildSearch(fields))
              setResetPending(true);
            else setAdvanced(!advanced);
          }}
        >
          {advanced ? t("Простой поиск") : t("Запрос или ссылка")}
        </button>
      </div>
      {resetPending && (
        <div
          className="template-delete-confirm"
          role="group"
          aria-label={t("Сброс поискового запроса")}
        >
          <p>
            {t("Отредактированный запрос нельзя перенести в поля автоматически. Начать простой поиск заново?")}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setFields({
                roles: "",
                industry: "",
                phrases: "",
                excluded: "",
                all: false,
              });
              onChange("");
              setAdvanced(false);
              setResetPending(false);
            }}
          >
            {t("Начать заново")}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setResetPending(false)}
          >
            {t("Сохранить запрос")}
          </button>
        </div>
      )}
      {advanced ? (
        <label className="field">
          {t("Ключевые слова или ссылка на профиль")}
          <textarea
            name="keywords"
            aria-label={t("Ключевые слова или ссылка на профиль")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={3}
            maxLength={1000}
            aria-invalid={invalid}
            aria-describedby={invalid ? errorId : undefined}
            placeholder={t('Например: "driver recruitment" manager')}
          />
          <small>
            {t("Можно вставить ссылку на один профиль или готовый поисковый запрос LinkedIn.")}
          </small>
        </label>
      ) : (
        <>
          <label className="field">
            {t("Должности")}
            <textarea
              rows={2}
              aria-label={t("Должности")}
              aria-invalid={invalid}
              aria-describedby={invalid ? errorId : undefined}
              value={fields.roles}
              placeholder={t("Например: driver recruiter, recruitment manager")}
              onChange={(e) => update("roles", e.target.value)}
            />
            <small>{t("Несколько вариантов — через запятую.")}</small>
          </label>
          <details
            className="search-refine"
            open={refineOpen}
            onToggle={(e) => setRefineOpen(e.currentTarget.open)}
          >
            <summary>
              {t("Уточнить поиск: отрасль, ключевые фразы, исключения")}
            </summary>
            <div className="search-builder-grid">
              <label className="field">
                {t("Отрасль")}
                <textarea
                  rows={2}
                  aria-label={t("Отрасль")}
                  value={fields.industry}
                  placeholder="Trucking, transportation"
                  onChange={(e) => update("industry", e.target.value)}
                />
              </label>
              <label className="field">
                {t("Ключевые фразы")}
                <textarea
                  rows={2}
                  aria-label={t("Ключевые фразы")}
                  value={fields.phrases}
                  placeholder="Driver retention, CDL drivers"
                  onChange={(e) => update("phrases", e.target.value)}
                />
              </label>
              <label className="field">
                {t("Исключить")}
                <textarea
                  rows={2}
                  aria-label={t("Исключить")}
                  value={fields.excluded}
                  placeholder={t("Например, internship")}
                  onChange={(e) => update("excluded", e.target.value)}
                />
              </label>
              <label className="field">
                {t("Совпадение ключевых фраз")}
                <select
                  value={fields.all ? "all" : "any"}
                  onChange={(e) => update("all", e.target.value === "all")}
                >
                  <option value="any">{t("Хотя бы одна фраза")}</option>
                  <option value="all">{t("Все фразы")}</option>
                </select>
              </label>
            </div>
          </details>
          <input type="hidden" name="keywords" value={value} />
          <details className="search-query-preview">
            <summary>{t("Показать итоговый запрос")}</summary>
            <code>{value || t("Заполните хотя бы одно поле выше")}</code>
          </details>
        </>
      )}
    </section>
  );
}

export function TemplatePicker({
  templates,
  accounts,
  disabled,
  onCreate,
  onDelete,
}) {
  const [selected, setSelected] = useState("");
  const [account, setAccount] = useState(
    accounts.find((a) => a.status === "ready")?.id || accounts[0]?.id || "",
  );
  const [name, setName] = useState("");
  const valid =
    templates.some((tpl) => tpl.id === selected) &&
    accounts.some((a) => a.id === account);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="template-picker">
      <p>
        {t("Шаблон переносит поиск, тексты и расписание. Кандидатов нужно выбрать заново и подтвердить отправку.")}
      </p>
      <label className="field">
        {t("Шаблон")}
        <select
          aria-label={t("Шаблон")}
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setConfirmDelete(false);
          }}
        >
          <option value="">{t("Выберите шаблон")}</option>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {t("Аккаунт отправителя")}
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {t("Название новой кампании")}
        <input
          value={name}
          maxLength={150}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Оставьте пустым, чтобы использовать название шаблона")}
        />
      </label>
      <div className="template-footer">
        <button
          className="button primary"
          disabled={disabled || !valid}
          onClick={() =>
            onCreate({
              id: selected,
              account_id: account,
              ...(name.trim() ? { name: name.trim() } : {}),
            })
          }
        >
          {t("Создать черновик")}
          <ArrowRight size={16} />
        </button>
        {selected && (
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => setConfirmDelete(!confirmDelete)}
          >
            <Trash2 size={14} />
            {t("Удалить шаблон")}
          </button>
        )}
      </div>
      {confirmDelete && (
        <div className="template-delete-confirm">
          <p>{t("Удалить этот шаблон? Созданные кампании сохранятся.")}</p>
          <button
            className="button"
            disabled={disabled}
            onClick={async () => {
              if (await onDelete(selected)) {
                setSelected("");
                setConfirmDelete(false);
              }
            }}
          >
            {t("Подтвердить удаление")}
          </button>
          <button
            className="text-button"
            onClick={() => setConfirmDelete(false)}
          >
            {t("Отмена")}
          </button>
        </div>
      )}
    </div>
  );
}
