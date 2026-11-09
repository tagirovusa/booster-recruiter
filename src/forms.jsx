// Dialogs for adding a LinkedIn account and creating a campaign.
import React, { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Modal } from "./ui";
import { SearchBuilder } from "./Workspace";
import { labels } from "./labels";
import { t } from "./i18n";

export function AccountForm({ onClose, onSubmit, busy, error }) {
  const [label, setLabel] = useState("");
  return (
    <Modal
      error={error}
      title={t("Подключить LinkedIn")}
      subtitle={t("Отдельная сессия для каждого аккаунта")}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim() && !busy) onSubmit(label.trim());
        }}
      >
        <label className="field">
          {t("Название аккаунта")}
          <input
            required
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("Например, Recruiting · Основной")}
          />
        </label>
        <div className="steps">
          <p>
            <span>1</span>{t("Откроется окно LinkedIn.")}
          </p>
          <p>
            <span>2</span>{t("Войдите и подтвердите вход, если потребуется.")}
          </p>
          <p>
            <span>3</span>{t("Вернитесь в приложение и проверьте подключение.")}
          </p>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            {t("Отмена")}
          </Button>
          <Button kind="primary" disabled={busy || !label.trim()}>
            {t("Открыть вход")} <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function CampaignForm({ accounts, busy, onClose, onSubmit, error }) {
  const [attempted, setAttempted] = useState(false);
  const form = useRef(null);
  const [d, setD] = useState({
    name: "",
    account_id:
      accounts.find((a) => a.status === "ready")?.id || accounts[0]?.id || "",
    keywords: "",
    max_profiles: 20,
    template_open: "",
    template_neutral: "",
  });
  const change = (key, v) => setD({ ...d, [key]: v });
  const errors = {
    name: !d.name.trim() ? t("Введите название кампании.") : "",
    keywords: !d.keywords.trim()
      ? t("Введите ключевые слова или ссылку на профиль LinkedIn.")
      : d.keywords.length > 1000
        ? t("Сократите поисковый запрос до 1000 символов.")
        : "",
    account_id: !accounts.some((a) => a.id === d.account_id)
      ? t("Выберите аккаунт отправителя.")
      : "",
    max_profiles:
      !Number.isInteger(d.max_profiles) ||
      d.max_profiles < 1 ||
      d.max_profiles > 100
        ? t("Укажите целое число от 1 до 100.")
        : "",
  };
  return (
    <Modal
      error={error}
      title={t("Новая кампания")}
      subtitle={t("Начните с поиска. Сообщения можно заполнить после сбора профилей.")}
      onClose={onClose}
    >
      <form
        ref={form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          const invalid = Object.keys(errors).find((key) => errors[key]);
          if (invalid) {
            const field = form.current.elements[invalid];
            field?.focus({ preventScroll: true });
            field?.closest("label")?.scrollIntoView({ block: "nearest" });
            if (invalid === "keywords" && field?.type === "hidden") {
              const target = form.current.querySelector(
                ".search-builder textarea",
              );
              target?.focus();
              target?.scrollIntoView({ block: "nearest" });
            }
            return;
          }
          if (!busy)
            onSubmit({
              ...d,
              name: d.name.trim(),
              keywords: d.keywords.trim(),
            });
        }}
      >
        <label className="field">
          {t("Название кампании")}
          <input
            name="name"
            aria-invalid={attempted && !!errors.name}
            aria-describedby={
              attempted && errors.name ? "campaign-name-error" : undefined
            }
            required
            value={d.name}
            onChange={(e) => change("name", e.target.value)}
            placeholder={t("Например, Head of Recruitment · Logistics")}
            maxLength={150}
          />
          {attempted && errors.name && (
            <small className="field-error" id="campaign-name-error">
              {errors.name}
            </small>
          )}
        </label>
        <label className="field">
          {t("Аккаунт отправителя")}
          <select
            name="account_id"
            aria-invalid={attempted && !!errors.account_id}
            value={d.account_id}
            onChange={(e) => change("account_id", e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {labels[a.status]}
              </option>
            ))}
          </select>
          {attempted && errors.account_id && (
            <small className="field-error">{errors.account_id}</small>
          )}
        </label>
        <SearchBuilder
          value={d.keywords}
          onChange={(value) => change("keywords", value)}
          invalid={attempted && !!errors.keywords}
          errorId="campaign-keywords-error"
        />
        {attempted && errors.keywords && (
          <small className="field-error" id="campaign-keywords-error">
            {errors.keywords}
          </small>
        )}
        <label className="field">
          {t("Сколько профилей собрать")}
          <input
            name="max_profiles"
            aria-invalid={attempted && !!errors.max_profiles}
            aria-describedby={
              attempted && errors.max_profiles
                ? "campaign-count-error"
                : undefined
            }
            type="number"
            required
            min={1}
            max={100}
            value={d.max_profiles}
            onChange={(e) => change("max_profiles", Number(e.target.value))}
          />
          {attempted && errors.max_profiles && (
            <small className="field-error" id="campaign-count-error">
              {errors.max_profiles}
            </small>
          )}
        </label>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            {t("Отмена")}
          </Button>
          <Button kind="primary" disabled={busy}>
            {t("Создать кампанию")} <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
