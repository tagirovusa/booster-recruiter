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
import { formatNumber, plural, t, tr } from "../i18n";

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
          <h1>{t("LinkedIn-аккаунты")}</h1>
          <p>
            {t(
              "Подключите аккаунт один раз. Для каждой кампании выбирайте нужного отправителя.",
            )}
          </p>
        </div>
        <Button kind="primary" onClick={() => onAdd()}>
          <Plus size={18} />
          {t("Добавить аккаунт")}
        </Button>
      </div>
      {!accounts.length ? (
        <Empty
          icon={UserPlus}
          title={t("Начните с подключения LinkedIn")}
          text={t(
            "Войдите в своём обычном окне LinkedIn. Пароль и код подтверждения вводятся на стороне LinkedIn.",
          )}
          action={
            <Button kind="primary" onClick={() => onAdd()}>
              {t("Подключить аккаунт")} <ArrowRight size={18} />
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
                  : t("Вход ещё не выполнен")}
              </p>
              {a.error && <div className="hint warning">{tr(a.error)}</div>}
              {a.status === "restricted" && (
                <div className="hint warning">
                  {t(
                    "LinkedIn ограничил действия аккаунта. Откройте LinkedIn, проверьте уведомления и выполните требования сервиса. Повторный вход сам по себе не снимает ограничение.",
                  )}
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
                    ? t("Проверить вход")
                    : a.status === "connecting"
                      ? t("Завершите вход в браузере")
                      : a.status === "new"
                        ? t("Войти в LinkedIn")
                        : t("Проверить вход")}
                </Button>
                {a.url && (
                  <button
                    className="icon"
                    title={t("Открыть профиль в обычном браузере")}
                    aria-label={t("Открыть профиль {name} в обычном браузере", {
                      name: a.label,
                    })}
                    onClick={async () => {
                      try {
                        await api.openProfile(a.url);
                      } catch (e) {
                        onError(tr(e.message));
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
                      {t("Общий баланс: {credits} {word}", {
                        credits: formatNumber(a.services.recruiter.credits),
                        word: plural(
                          a.services.recruiter.credits,
                          ["кредит", "кредита", "кредитов"], // i18n-ignore
                          ["credit", "credits"],
                        ),
                      })}
                    </p>
                  ) : (
                    <p>
                      {t("Дополнительно, если у вас есть подписка Recruiter.")}
                    </p>
                  )}
                  {a.services?.recruiter?.error && (
                    <div className="hint warning">
                      {tr(a.services.recruiter.error)}
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
                      ? t("Проверяем Recruiter…")
                      : a.services?.recruiter?.status === "ready"
                        ? t("Обновить Recruiter")
                        : t("Подключить Recruiter")}
                  </Button>
                  {a.services?.recruiter?.status === "ready" &&
                    !a.services.recruiter.manual_texts && (
                      <>
                        <p>
                          {t(
                            "LinkedIn автоматически меняет черновики. Отключите это, чтобы отправлять ваши точные тексты.",
                          )}
                        </p>
                        <Button
                          onClick={() =>
                            act("account.recruiter_prepare", {
                              id: a.id,
                            })
                          }
                          disabled={busy}
                        >
                          {t("Использовать мои тексты")}
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
                    {t("Отключить сессию")}
                  </button>
                )}
                <div className="account-removal">
                  <button
                    className="text-button account-delete"
                    disabled={busy}
                    onClick={() => onDelete(a.id)}
                  >
                    {t("Удалить аккаунт")}
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
          <h3>{t("Каждому аккаунту — отдельная сессия")}</h3>
          <p>
            {t(
              "Кампания всегда сохраняет своего отправителя. Переключение аккаунтов не меняет уже подготовленные сообщения.",
            )}
          </p>
        </div>
      </div>
    </>
  );
}
