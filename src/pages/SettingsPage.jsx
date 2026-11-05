// Settings and help: background work, notifications, backups and a short
// reminder of the everyday flow.
import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import DataSafety, { NotificationsSettings } from "../DataSafety";
import { DesktopPreferences } from "../DesktopPreferences";
import { Button } from "../ui";

const api = window.booster;

export default function SettingsPage({ onRestored, onError }) {
  const [config, setConfig] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Настройки и помощь</h1>
          <p>Основные функции работают без подключения ИИ.</p>
        </div>
      </div>
      <div className="settings-layout">
        <DesktopPreferences />
        <NotificationsSettings />
        <DataSafety onRestored={onRestored} />
        <div className="settings-help-grid">
          <section className="panel settings-card">
            <header className="settings-card-heading">
              <h2>Как начать работу</h2>
              <p>От подключения аккаунта до первого результата.</p>
            </header>
            <ol className="quickstart-list">
              <li>
                <div>
                  <strong>Подключите LinkedIn</strong>
                  <p>
                    «Аккаунты» → «Добавить аккаунт», войдите и нажмите
                    «Проверить вход».
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Создайте кампанию</strong>
                  <p>
                    «Кампании» → «Новая кампания». Укажите, кого ищете, и
                    нажмите «Найти кандидатов».
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Выберите кандидатов</strong>
                  <p>Отметьте нужных людей и нажмите «Настроить отправку».</p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Напишите тексты и запустите</strong>
                  <p>
                    На вкладке «Отправка» выберите способ связи, напишите тексты
                    и нажмите «Посмотреть перед запуском».
                  </p>
                </div>
              </li>
              <li>
                <div>
                  <strong>Отвечайте кандидатам</strong>
                  <p>
                    Новые ответы — в разделе «Требует внимания». Список можно
                    выгрузить в Excel.
                  </p>
                </div>
              </li>
            </ol>
          </section>
          <section className="panel settings-card">
            <header className="settings-card-heading">
              <h2>Работа с кампаниями</h2>
              <p>Что происходит после запуска.</p>
            </header>
            <div className="settings-help-item">
              <h3>Приглашения и сообщения</h3>
              <p>
                Программа следует выбранному плану связи. После принятия
                приглашения отправляет утверждённое сообщение. Ответ кандидата
                останавливает дальнейшие обращения.
              </p>
            </div>
            <div className="settings-help-item">
              <h3>Пауза и проверка результата</h3>
              <p>
                «Пауза» дожидается текущего действия и сохраняет план. Если
                результат отправки неизвестен, сначала проверьте переписку в
                LinkedIn — повтор может создать дубль.
              </p>
            </div>
            <div className="settings-help-item">
              <h3>Что означает рамка</h3>
              <p>
                Open to Work помогает выбрать текст обращения. Отсутствие рамки
                не подтверждает занятость человека или его нежелание менять
                работу.
              </p>
            </div>
          </section>
        </div>
        <details className="panel settings-card settings-disclosure">
          <summary>
            <div>
              <h2>Для разработчиков: ИИ-агент</h2>
              <p>
                Необязательно. Нужно, только если вы подключаете ИИ-ассистента.
              </p>
            </div>
            <ChevronRight size={20} aria-hidden="true" />
          </summary>
          <div className="settings-integration">
            <p>
              Агент может работать с теми же кампаниями через MCP, пока
              приложение работает, в том числе в фоне. Подтверждение новой
              рассылки остаётся за вами.
            </p>
            <Button
              onClick={async () => {
                try {
                  setConfig(await api.mcpConfig());
                } catch (e) {
                  onError(e.message);
                }
              }}
            >
              Показать настройки подключения
            </Button>
            {config && (
              <textarea
                className="code"
                readOnly
                rows={8}
                value={config}
                aria-label="Настройки MCP"
              />
            )}
          </div>
        </details>
      </div>
    </>
  );
}
