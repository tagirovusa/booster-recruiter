// Settings and help: background work, notifications, backups and a short
// reminder of the everyday flow.
import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import DataSafety, { NotificationsSettings } from "../DataSafety";
import { DesktopPreferences } from "../DesktopPreferences";
import { Button } from "../ui";
import { getLang, LANGUAGES, setLang, t, tr } from "../i18n";

const api = window.booster;

function LanguageSettings() {
  const [pending, setPending] = useState(false);
  return (
    <section
      className="panel settings-card"
      aria-labelledby="language-settings-title"
    >
      <header className="settings-card-heading">
        <h2 id="language-settings-title">{t("Язык интерфейса")}</h2>
        <p>{t("Окно перезагрузится, кампании продолжат работу.")}</p>
      </header>
      <label className="field">
        {t("Язык")}
        <select
          value={getLang()}
          disabled={pending}
          onChange={(e) => {
            setPending(true);
            setLang(e.target.value);
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

export default function SettingsPage({ onRestored, onError }) {
  const [config, setConfig] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("Настройки и помощь")}</h1>
          <p>{t("Основные функции работают без подключения ИИ.")}</p>
        </div>
      </div>
      <div className="settings-layout">
        <LanguageSettings />
        <DesktopPreferences />
        <NotificationsSettings />
        <DataSafety onRestored={onRestored} />
        <div className="settings-help-grid">
          <section className="panel settings-card">
            <header className="settings-card-heading">
              <h2>{t("Как начать работу")}</h2>
              <p>{t("От подключения аккаунта до первого результата.")}</p>
            </header>
            <ol className="quickstart-list">
              <li>
                <div>
                  <strong>{t("Подключите LinkedIn")}</strong>
                  <p>
                    {t("«Аккаунты» → «Добавить аккаунт», войдите и нажмите «Проверить вход».")}
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>{t("Создайте кампанию")}</strong>
                  <p>
                    {t("«Кампании» → «Новая кампания». Укажите, кого ищете, и нажмите «Найти кандидатов».")}
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>{t("Выберите кандидатов")}</strong>
                  <p>{t("Отметьте нужных людей и нажмите «Настроить отправку».")}</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>{t("Напишите тексты и запустите")}</strong>
                  <p>
                    {t("На вкладке «Отправка» выберите способ связи, напишите тексты и нажмите «Посмотреть перед запуском».")}
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>{t("Отвечайте кандидатам")}</strong>
                  <p>
                    {t("Новые ответы — в разделе «Требует внимания». Список можно выгрузить в Excel.")}
                  </p>
                </div>
              </li>
            </ol>
          </section>
          <section className="panel settings-card">
            <header className="settings-card-heading">
              <h2>{t("Работа с кампаниями")}</h2>
              <p>{t("Что происходит после запуска.")}</p>
            </header>
            <div className="settings-help-item">
              <h3>{t("Приглашения и сообщения")}</h3>
              <p>
                {t("Программа следует выбранному плану связи. После принятия приглашения отправляет утверждённое сообщение. Ответ кандидата останавливает дальнейшие обращения.")}
              </p>
            </div>
            <div className="settings-help-item">
              <h3>{t("Пауза и проверка результата")}</h3>
              <p>
                {t("«Пауза» дожидается текущего действия и сохраняет план. Если результат отправки неизвестен, сначала проверьте переписку в LinkedIn — повтор может создать дубль.")}
              </p>
            </div>
            <div className="settings-help-item">
              <h3>{t("Что означает рамка")}</h3>
              <p>
                {t("Open to Work помогает выбрать текст обращения. Отсутствие рамки не подтверждает занятость человека или его нежелание менять работу.")}
              </p>
            </div>
          </section>
        </div>
        <details className="panel settings-card settings-disclosure">
          <summary>
            <div>
              <h2>{t("Для разработчиков: ИИ-агент")}</h2>
              <p>
                {t("Необязательно. Нужно, только если вы подключаете ИИ-ассистента.")}
              </p>
            </div>
            <ChevronRight size={20} aria-hidden="true" />
          </summary>
          <div className="settings-integration">
            <p>
              {t("Агент может работать с теми же кампаниями через MCP, пока приложение работает, в том числе в фоне. Подтверждение новой рассылки остаётся за вами.")}
            </p>
            <Button
              onClick={async () => {
                try {
                  setConfig(await api.mcpConfig());
                } catch (e) {
                  onError(tr(e.message));
                }
              }}
            >
              {t("Показать настройки подключения")}
            </Button>
            {config && (
              <textarea
                className="code"
                readOnly
                rows={8}
                value={config}
                aria-label={t("Настройки MCP")}
              />
            )}
          </div>
        </details>
      </div>
    </>
  );
}
