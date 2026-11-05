// LinkedIn sender accounts: sign-in, optional Recruiter and removal.
import React from "react";
import {
  ArrowRight,
  ExternalLink,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { Badge, Button, Empty, initials } from "../ui";

const api = window.booster;

export default function AccountsPage({
  accounts,
  busy,
  act,
  onAdd,
  onDelete,
  onError,
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>LinkedIn-аккаунты</h1>
          <p>
            Подключите аккаунт один раз. Для каждой кампании выбирайте нужного
            отправителя.
          </p>
        </div>
        <Button kind="primary" onClick={() => onAdd()}>
          <Plus size={18} />
          Добавить аккаунт
        </Button>
      </div>
      {!accounts.length ? (
        <Empty
          icon={UserPlus}
          title="Начните с подключения LinkedIn"
          text="Войдите в своём обычном окне LinkedIn. Пароль и код подтверждения вводятся на стороне LinkedIn."
          action={
            <Button kind="primary" onClick={() => onAdd()}>
              Подключить аккаунт <ArrowRight size={18} />
            </Button>
          }
        />
      ) : (
        <div className="account-grid">
          {accounts.map((a) => (
            <section
              className="account-card"
              key={a.id}
              id={"account-" + a.id}
              tabIndex={-1}
            >
              <div className="row">
                <div className="avatar">{initials(a.label)}</div>
                <Badge value={a.status} />
              </div>
              <h2>{a.label}</h2>
              <p>
                {a.url
                  ? a.url.replace("https://www.linkedin.com/in/", "")
                  : "Вход ещё не выполнен"}
              </p>
              {a.error && <div className="hint warning">{a.error}</div>}
              {a.status === "restricted" && (
                <div className="hint warning">
                  LinkedIn ограничил действия аккаунта. Откройте LinkedIn,
                  проверьте уведомления и выполните требования сервиса.
                  Повторный вход сам по себе не снимает ограничение.
                </div>
              )}
              <div className="account-actions">
                <Button
                  kind={a.status === "ready" ? "secondary" : "primary"}
                  disabled={busy || a.status === "connecting"}
                  onClick={() => act("account.login", { id: a.id })}
                >
                  <RefreshCw size={16} />
                  {a.status === "ready"
                    ? "Проверить вход"
                    : a.status === "connecting"
                      ? "Завершите вход в браузере"
                      : a.status === "new"
                        ? "Войти в LinkedIn"
                        : "Проверить вход"}
                </Button>
                {a.url && (
                  <button
                    className="icon"
                    title="Открыть профиль в обычном браузере"
                    aria-label={
                      "Открыть профиль " + a.label + " в обычном браузере"
                    }
                    onClick={async () => {
                      try {
                        await api.openProfile(a.url);
                      } catch (e) {
                        onError(e.message);
                      }
                    }}
                  >
                    <ExternalLink size={18} />
                  </button>
                )}
              </div>
              {a.status === "ready" && (
                <div className="recruiter-connection">
                  <strong>LinkedIn Recruiter</strong>
                  {a.services?.recruiter?.status === "ready" ? (
                    <p>
                      {a.services.recruiter.contract}
                      <br />
                      Общий баланс:{" "}
                      {a.services.recruiter.credits.toLocaleString(
                        "ru-RU",
                      )}{" "}
                      кредитов
                    </p>
                  ) : (
                    <p>Дополнительно, если у вас есть подписка Recruiter.</p>
                  )}
                  {a.services?.recruiter?.error && (
                    <div className="hint warning">
                      {a.services.recruiter.error}
                    </div>
                  )}
                  <Button
                    disabled={
                      busy || a.services?.recruiter?.status === "connecting"
                    }
                    onClick={() => act("account.recruiter", { id: a.id })}
                  >
                    <RefreshCw size={15} />
                    {a.services?.recruiter?.status === "connecting"
                      ? "Проверяем Recruiter…"
                      : a.services?.recruiter?.status === "ready"
                        ? "Обновить Recruiter"
                        : "Подключить Recruiter"}
                  </Button>
                  {a.services?.recruiter?.status === "ready" &&
                    !a.services.recruiter.manual_texts && (
                      <>
                        <p>
                          LinkedIn автоматически меняет черновики. Отключите
                          это, чтобы отправлять ваши точные тексты.
                        </p>
                        <Button
                          onClick={() =>
                            act("account.recruiter_prepare", {
                              id: a.id,
                            })
                          }
                          disabled={busy}
                        >
                          Использовать мои тексты
                        </Button>
                      </>
                    )}
                </div>
              )}
              <div className="account-session-controls">
                {a.status === "ready" && (
                  <button
                    className="button small"
                    disabled={busy}
                    onClick={() => act("account.disconnect", { id: a.id })}
                  >
                    Отключить сессию
                  </button>
                )}
                <div className="account-removal">
                  <button
                    className="text-button account-delete"
                    disabled={busy}
                    onClick={() => onDelete(a.id)}
                  >
                    Удалить аккаунт
                  </button>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="info-card">
        <ShieldCheck />
        <div>
          <h3>Каждому аккаунту — отдельная сессия</h3>
          <p>
            Кампания всегда сохраняет своего отправителя. Переключение аккаунтов
            не меняет уже подготовленные сообщения.
          </p>
        </div>
      </div>
    </>
  );
}
