import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutGrid,
  Users,
  Settings,
  Plus,
  ArrowRight,
  ArrowLeft,
  Search,
  Play,
  Pause,
  Download,
  ExternalLink,
  Check,
  X,
  ChevronRight,
  MessageSquare,
  ShieldCheck,
  RefreshCw,
  LoaderCircle,
  Inbox,
  UserPlus,
  SlidersHorizontal,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import "./style.css";
import {
  Automation,
  ContactState,
  OutreachHistory,
  DesktopPreferences,
} from "./Outreach";

const api = window.booster;
const labels = {
  new: "Не подключён",
  ready: "Готово",
  needs_login: "Требуется вход",
  connecting: "Ожидаем вход",
  identity_mismatch: "Другой профиль",
  disconnected: "Отключён",
  draft: "Черновик",
  collecting: "Собираем профили",
  sending: "Отправляем сообщения",
  paused: "На паузе",
  open: "Open to Work",
  neutral: "Нейтральное сообщение",
  review: "Нужно проверить",
  sent: "Отправлено",
  unknown: "Нужно проверить отправку",
  blocked: "Сообщение недоступно",
  cancelled: "Предпросмотр отменён",
  pending: "В очереди",
  replied: "Ответ получен",
  failed: "Ошибка",
  waiting: "Ожидаем расписания",
  automating: "Обрабатываем кампанию",
  checking: "Проверяем контакты",
};
const fmt = (d) =>
  new Date(d).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const initials = (name) =>
  (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("");
function Badge({ value }) {
  return <span className={"badge " + value}>{labels[value] || value}</span>;
}
function Button({ children, kind = "secondary", ...rest }) {
  return (
    <button className={"button " + kind} {...rest}>
      {children}
    </button>
  );
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const container = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const controls = () => [
      ...container.current.querySelectorAll(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
      ),
    ];
    (container.current.querySelector("[autofocus]") || controls()[0])?.focus();
    const listener = (e) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const items = controls();
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
      previous?.focus();
    };
  }, []);
  return (
    <div className="veil">
      <section
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon" aria-label="Закрыть" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function App() {
  const [state, setState] = useState({
    accounts: [],
    campaigns: [],
    events: [],
  });
  const [page, setPage] = useState("campaigns");
  const [cid, setCid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [modal, setModal] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("people");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [person, setPerson] = useState(null);
  const [preview, setPreview] = useState(null);
  const [config, setConfig] = useState("");
  const refresh = useCallback(async () => {
    if (!api) {
      setLoading(false);
      setError("Откройте Booster Recruiter как приложение.");
      return;
    }
    try {
      setState(await api.command("state"));
      if (cid) setDetail(await api.command("campaign.detail", { id: cid }));
      setLoading(false);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }, [cid]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = async (op, p = {}, success = "") => {
    setError("");
    setBusy(true);
    try {
      const r = await api.command(op, p);
      await refresh();
      if (success) setNotice(success);
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const selected =
    detail?.candidates.filter(
      (p) =>
        p.selected &&
        !p.excluded &&
        !p.blocked &&
        !["sent", "unknown", "sending", "replied"].includes(
          p.delivery[0]?.status,
        ),
    ) || [];
  const campaign = detail?.campaign;
  const active = ["collecting", "sending", "automating", "checking"].includes(
    campaign?.status,
  );
  const liveRun = detail?.outreach?.runs.find((r) => r.status === "active");
  const contactMembers = new Map();
  for (const r of (detail?.outreach?.runs || [])
    .filter((r) => r.status !== "preview")
    .slice()
    .reverse()) {
    for (const m of r.members) contactMembers.set(m.candidate_id, m);
  }
  const account = state.accounts.find((a) => a.id === campaign?.account_id);
  const openInSenderAccount = (url) =>
    act(
      "account.open_profile",
      { id: campaign.account_id, url },
      "Профиль открыт в сессии отправителя.",
    );
  const openCampaign = (id) => {
    setCid(id);
    setDetail(null);
    setPage("campaigns");
    setTab("people");
    setFilter("all");
    setQuery("");
  };
  const doExport = async (format) => {
    try {
      if (await api.export(cid, format)) setNotice("Список сохранён.");
    } catch (e) {
      setError(e.message);
    }
  };
  const review = async (p, segment, checked = p.selected) => {
    setDetail((d) => ({
      ...d,
      candidates: d.candidates.map((item) =>
        item.id === p.id ? { ...item, segment, selected: !!checked } : item,
      ),
    }));
    const result = await act("candidate.review", {
      id: p.id,
      segment,
      selected: !!checked,
      excluded: !!p.excluded,
    });
    if (!result) await refresh();
    return result;
  };
  const saveAutomation = async (rules, texts, reviewAfterSave = false) => {
    setError("");
    setBusy(true);
    try {
      if (JSON.stringify(rules) !== JSON.stringify(detail.outreach.rules))
        await api.command("campaign.automation", { id: cid, rules });
      if (
        texts.open !== campaign.template_open ||
        texts.neutral !== campaign.template_neutral
      )
        await api.command("campaign.templates", {
          id: cid,
          template_open: texts.open,
          template_neutral: texts.neutral,
        });
      await refresh();
      if (reviewAfterSave)
        setPreview(await api.command("outreach.preview", { id: cid }));
      else setNotice("");
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const people = (detail?.candidates || []).filter(
    (p) =>
      (filter === "all" || p.segment === filter) &&
      ((p.data.name || "") + " " + (p.data.headline || ""))
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <img className="brand" src="/brand/logo.svg" alt="Business Booster" />
        <div className="product">
          RECRUITER <span>WORKSPACE</span>
        </div>
        <nav>
          {[
            [LayoutGrid, "campaigns", "Кампании"],
            [Users, "accounts", "Аккаунты"],
            [Settings, "settings", "Настройки"],
          ].map(([Icon, id, text]) => (
            <button
              key={id}
              className={page === id ? "nav-item chosen" : "nav-item"}
              onClick={() => {
                setPage(id);
                setCid(null);
                setDetail(null);
              }}
            >
              <Icon size={19} />
              {text}
              {id === "campaigns" && <span>{state.campaigns.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={19} />
          <div>
            <b>Ваше рабочее пространство</b>
            <small>Данные сохраняются на компьютере</small>
          </div>
        </div>
      </aside>
      <main>
        <div className="topbar">
          <span>
            Подбор персонала <ChevronRight size={14} />{" "}
            {page === "campaigns"
              ? "Кампании"
              : page === "accounts"
                ? "Аккаунты"
                : "Настройки"}{" "}
            {cid && (
              <>
                <ChevronRight size={14} />
                {campaign?.name || "Загрузка…"}
              </>
            )}
          </span>
          <span className="connection">
            <i />
            Локальное приложение
          </span>
        </div>
        {error && (
          <div className="alert error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Скрыть ошибку">
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button
              onClick={() => setNotice("")}
              aria-label="Скрыть уведомление"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="content">
          {loading ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              <h2>Открываем рабочее пространство…</h2>
            </div>
          ) : page === "accounts" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ОТПРАВИТЕЛИ</p>
                  <h1>LinkedIn-аккаунты</h1>
                  <p>
                    Подключите аккаунт один раз. Для каждой кампании выбирайте
                    нужного отправителя.
                  </p>
                </div>
                <Button kind="primary" onClick={() => setModal("account")}>
                  <Plus size={18} />
                  Добавить аккаунт
                </Button>
              </div>
              {!state.accounts.length ? (
                <Empty
                  icon={UserPlus}
                  title="Начните с подключения LinkedIn"
                  text="Войдите в своём обычном окне LinkedIn. Пароль и код подтверждения вводятся на стороне LinkedIn."
                  action={
                    <Button kind="primary" onClick={() => setModal("account")}>
                      Подключить аккаунт <ArrowRight size={18} />
                    </Button>
                  }
                />
              ) : (
                <div className="account-grid">
                  {state.accounts.map((a) => (
                    <section className="account-card" key={a.id}>
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
                      <div className="account-actions">
                        <Button
                          kind={a.status === "ready" ? "secondary" : "primary"}
                          disabled={busy || a.status === "connecting"}
                          onClick={() => act("account.login", { id: a.id })}
                        >
                          <RefreshCw size={16} />
                          {a.status === "ready"
                            ? "Проверить подключение"
                            : a.status === "connecting"
                              ? "Завершите вход в браузере"
                              : a.status === "new"
                                ? "Войти в LinkedIn"
                                : "Проверить вход"}
                        </Button>
                        {a.url && (
                          <button
                            className="icon"
                            title="Открыть профиль"
                            onClick={() => api.openProfile(a.url)}
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
                            <p>
                              Дополнительно, если у вас есть подписка Recruiter.
                            </p>
                          )}
                          {a.services?.recruiter?.error && (
                            <div className="hint warning">
                              {a.services.recruiter.error}
                            </div>
                          )}
                          <Button
                            disabled={
                              busy ||
                              a.services?.recruiter?.status === "connecting"
                            }
                            onClick={() =>
                              act("account.recruiter", { id: a.id })
                            }
                          >
                            <RefreshCw size={15} />
                            {a.services?.recruiter?.status === "connecting"
                              ? "Проверяем Recruiter…"
                              : a.services?.recruiter?.status === "ready"
                                ? "Проверить Recruiter"
                                : "Подключить Recruiter"}
                          </Button>
                          {a.services?.recruiter?.status === "ready" &&
                            !a.services.recruiter.manual_texts && (
                              <>
                                <p>
                                  LinkedIn автоматически меняет черновики.
                                  Отключите это, чтобы отправлять ваши точные
                                  тексты.
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
                      {a.status === "ready" && (
                        <button
                          className="text-button muted"
                          onClick={() =>
                            act("account.disconnect", { id: a.id })
                          }
                        >
                          Отключить сессию
                        </button>
                      )}
                    </section>
                  ))}
                </div>
              )}
              <div className="info-card">
                <ShieldCheck />
                <div>
                  <h3>Каждому аккаунту — отдельная сессия</h3>
                  <p>
                    Кампания всегда сохраняет своего отправителя. Переключение
                    аккаунтов не меняет уже подготовленные сообщения.
                  </p>
                </div>
              </div>
            </>
          ) : page === "settings" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
                  <h1>Настройки и помощь</h1>
                  <p>Основные функции работают без подключения ИИ.</p>
                </div>
              </div>
              <DesktopPreferences />
              <section className="panel settings">
                <h2>Как начать работу</h2>
                <ol>
                  <li>Подключите аккаунт на вкладке «Аккаунты».</li>
                  <li>Создайте кампанию и укажите ключевые слова.</li>
                  <li>Запустите сбор и проверьте найденные профили.</li>
                  <li>
                    Выберите получателей, проверьте тексты и подтвердите
                    отправку.
                  </li>
                  <li>Сохраните список в Excel или CSV.</li>
                </ol>
                <h2>Подключение ИИ-агента</h2>
                <p>
                  Необязательный способ управления теми же кампаниями через MCP.
                  Приложение должно быть открыто. Агент не может самостоятельно
                  подтвердить новую рассылку.
                </p>
                <Button onClick={async () => setConfig(await api.mcpConfig())}>
                  Показать настройки подключения
                </Button>
                {config && (
                  <textarea
                    className="code"
                    readOnly
                    rows={12}
                    value={config}
                    aria-label="Настройки MCP"
                  />
                )}
                <h2>Сохранение и остановка</h2>
                <p>
                  Данные сохраняются после каждой операции. Кнопка «Пауза»
                  дожидается текущего действия. При закрытии приложения
                  незавершённая отправка отмечается для проверки, чтобы избежать
                  дублей.
                </p>
                <h2>Поддерживаемые сообщения</h2>
                <p>
                  Отправляются обычные сообщения, доступные выбранному аккаунту.
                  Если нужен InMail или сначала приглашение, профиль останется в
                  списке с причиной пропуска. Open to Work и текущая занятость —
                  разные признаки.
                </p>
              </section>
            </>
          ) : !cid ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">ПОИСК. КОНТАКТ. РЕЗУЛЬТАТ.</p>
                  <h1>Ваши кампании</h1>
                  <p>
                    От поискового запроса до сохранённого списка кандидатов.
                  </p>
                </div>
                <Button
                  kind="primary"
                  onClick={() =>
                    setModal(state.accounts.length ? "campaign" : "account")
                  }
                >
                  <Plus size={18} />
                  Новая кампания
                </Button>
              </div>
              <div className="stats">
                <Stat label="Кампании" value={state.campaigns.length} />
                <Stat
                  label="Сохранённые профили"
                  value={state.campaigns.reduce((n, c) => n + c.count, 0)}
                />
                <Stat
                  label="Готовые аккаунты"
                  value={
                    state.accounts.filter((a) => a.status === "ready").length
                  }
                />
              </div>
              {!state.campaigns.length ? (
                <Empty
                  icon={Search}
                  title="Найдите людей для вашей следующей вакансии"
                  text="Задайте ключевые слова и подготовьте сообщения. Программа сохранит найденные профили и поможет проверить их перед отправкой."
                  action={
                    <Button
                      kind="primary"
                      onClick={() =>
                        setModal(state.accounts.length ? "campaign" : "account")
                      }
                    >
                      {state.accounts.length
                        ? "Создать первую кампанию"
                        : "Подключить LinkedIn"}
                      <ArrowRight size={18} />
                    </Button>
                  }
                />
              ) : (
                <div className="panel">
                  <div className="panel-title">
                    <h2>Все кампании</h2>
                    <span>{state.campaigns.length} всего</span>
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th>Кампания</th>
                        <th>Отправитель</th>
                        <th>Профили</th>
                        <th>Статус</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {state.campaigns.map((c) => (
                        <tr
                          className="clickable"
                          key={c.id}
                          onClick={() => openCampaign(c.id)}
                        >
                          <td>
                            <b>{c.name}</b>
                            <small>{c.keywords}</small>
                          </td>
                          <td>
                            {
                              state.accounts.find((a) => a.id === c.account_id)
                                ?.label
                            }
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
              )}
            </>
          ) : !detail ? (
            <div className="empty">
              <LoaderCircle className="spin" />
            </div>
          ) : (
            <>
              <button
                className="text-button muted"
                onClick={() => setCid(null)}
              >
                <ArrowLeft size={16} />
                Все кампании
              </button>
              <div className="page-heading detail">
                <div>
                  <p className="eyebrow">КАМПАНИЯ · {account?.label}</p>
                  <h1>{campaign.name}</h1>
                  <p>{campaign.keywords}</p>
                </div>
                <div className="actions">
                  <Button
                    disabled={active || busy}
                    onClick={() => doExport("xlsx")}
                  >
                    <Download size={17} />
                    Excel
                  </Button>
                  {active || liveRun ? (
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
                <div className="stats">
                  <Stat
                    label="Найдено профилей"
                    value={detail.candidates.length}
                  />
                  <Stat
                    label="Open to Work"
                    value={
                      detail.candidates.filter((p) => p.segment === "open")
                        .length
                    }
                  />
                  <Stat
                    label="Нужно проверить"
                    value={
                      detail.candidates.filter((p) => p.segment === "review")
                        .length
                    }
                  />
                  <Stat label="Выбрано для сообщения" value={selected.length} />
                </div>
              )}
              <div className="tabs">
                {[
                  ["people", "Кандидаты", Users],
                  ["automation", "Автоматизация", Settings],
                  ["history", "История", Inbox],
                ].map(([id, name, Icon]) => (
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
                  data={detail.outreach}
                  campaign={campaign}
                  account={account}
                  selected={selected}
                  disabled={active || busy}
                  onSave={saveAutomation}
                  onPeople={() => setTab("people")}
                  onAccounts={() => setPage("accounts")}
                  onCheck={() => act("campaign.check", { id: cid })}
                  onResume={(id) => act("outreach.resume", { id })}
                  onCheckNow={(id) => act("outreach.check_now", { id })}
                  onPause={() => act("campaign.pause", { id: cid })}
                />
              ) : tab === "history" ? (
                <div className="panel">
                  <OutreachHistory
                    runs={detail.outreach.runs}
                    disabled={active || busy}
                    onResolve={(id, confirmed) =>
                      act("outreach.resolve", { id, confirmed })
                    }
                    onResume={(id) => act("outreach.resume", { id })}
                    onOpen={openInSenderAccount}
                  />
                  <div className="panel-title">
                    <h2>Результаты сообщений</h2>
                    <Button onClick={() => doExport("csv")}>
                      <Download size={16} />
                      CSV
                    </Button>
                  </div>
                  {detail.batches
                    .filter((b) => b.status === "approved" && b.pending > 0)
                    .map((b) => (
                      <div className="toolbar" key={b.id}>
                        <p>
                          В подтверждённой очереди осталось: {b.pending}.
                          {b.unknown > 0
                            ? " Сначала проверьте результат последней отправки ниже."
                            : " Отправитель и тексты сохранены."}
                        </p>
                        <Button
                          disabled={active || busy || b.unknown > 0}
                          onClick={() => act("batch.resume", { id: b.id })}
                        >
                          <Play size={16} />
                          Продолжить очередь
                        </Button>
                      </div>
                    ))}
                  {detail.candidates.some((p) => p.delivery.length) ? (
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
                            <tr key={p.id}>
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
                                {p.delivery[0].detail}
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
                                      Откройте диалог и проверьте, появилось ли
                                      это сообщение.
                                    </p>
                                    <Button
                                      onClick={() => openInSenderAccount(p.url)}
                                    >
                                      Открыть LinkedIn
                                    </Button>
                                    <Button
                                      disabled={active || busy}
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
                                      disabled={active || busy}
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
                  ) : (
                    <div className="empty compact">
                      <Inbox />
                      <h3>Здесь появится история обработки</h3>
                      <p>
                        У каждого получателя сохраняются точный текст и
                        результат попытки.
                      </p>
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
                      <option value="neutral">Нейтральное сообщение</option>
                      <option value="review">Нужно проверить</option>
                    </select>
                    <div className="spacer" />
                    <Button
                      kind="primary"
                      disabled={!selected.length || active || busy}
                      onClick={() => setTab("automation")}
                    >
                      <MessageSquare size={17} />
                      Настроить отправку{" "}
                      {selected.length > 0 && `(${selected.length})`}
                    </Button>
                  </div>
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
                              className={p.selected ? "selected" : ""}
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={
                                    "Выбрать " + (p.data.name || p.url)
                                  }
                                  checked={!!p.selected}
                                  disabled={
                                    active ||
                                    busy ||
                                    p.segment === "review" ||
                                    p.blocked ||
                                    [
                                      "sent",
                                      "unknown",
                                      "sending",
                                      "replied",
                                    ].includes(p.delivery[0]?.status)
                                  }
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
                                      src={
                                        "data:image/png;base64," + p.data.photo
                                      }
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
                                  disabled={active || busy}
                                  aria-label={
                                    "Группа " + (p.data.name || p.url)
                                  }
                                  onChange={(e) =>
                                    review(
                                      p,
                                      e.target.value,
                                      e.target.value === "review"
                                        ? false
                                        : p.selected,
                                    )
                                  }
                                >
                                  <option value="review">
                                    Нужно проверить
                                  </option>
                                  <option value="open">Open to Work</option>
                                  <option value="neutral">
                                    Нейтральное сообщение
                                  </option>
                                </select>
                              </td>
                              <td>
                                {p.blocked ? (
                                  <span className="badge blocked">
                                    Не контактировать
                                  </span>
                                ) : contactMembers.has(p.id) ||
                                  p.data.contact ? (
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
                                        ? "Нужна проверка"
                                        : "Готов к выбору"}
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
                      <p>
                        Профили без подтверждённого Open to Work получат
                        нейтральное сообщение.
                      </p>
                    </div>
                  )}
                  <div className="table-footer">
                    <span>
                      {people.length} профилей · Выбрано {selected.length}
                    </span>
                    <span>Изменение группы сохраняется автоматически</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {modal === "account" && (
        <AccountForm
          onClose={() => setModal(null)}
          busy={busy}
          onSubmit={async (label) => {
            const a = await act("account.create", { label });
            if (a) {
              setModal(null);
              setPage("accounts");
              setCid(null);
              await act("account.login", { id: a.id });
            }
          }}
        />
      )}
      {modal === "campaign" && (
        <CampaignForm
          accounts={state.accounts}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (data) => {
            const c = await act("campaign.create", data);
            if (c) {
              await act("campaign.automation", {
                id: c.id,
                rules: {
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
              });
              setModal(null);
              openCampaign(c.id);
            }
          }}
        />
      )}
      {person && (
        <Modal
          title={person.data.name || "Профиль кандидата"}
          subtitle="Проверка исходных сведений"
          onClose={() => setPerson(null)}
          wide
        >
          <div className="profile-review">
            {person.data.photo && (
              <img
                className="profile-photo"
                src={"data:image/png;base64," + person.data.photo}
                alt="Фото для проверки рамки"
              />
            )}
            <div>
              <Badge value={person.segment} />
              <h3>{person.data.headline || "Заголовок не определён"}</h3>
              <p>
                Рамка: {person.data.photo_frame?.status || "unknown"}.
                Отсутствие подтверждения не означает, что человек не ищет
                работу.
              </p>
              <Button onClick={() => openInSenderAccount(person.url)}>
                <ExternalLink size={16} />
                Открыть LinkedIn
              </Button>
            </div>
          </div>
          <h3>Сведения, полученные из профиля</h3>
          <pre className="profile-text">
            {person.data.sections?.main_profile ||
              person.data.top_card_text ||
              "Текст недоступен"}
          </pre>
          <div className="modal-footer">
            <Button
              kind="danger"
              onClick={async () => {
                await act(
                  "candidate.suppress",
                  { url: person.url, reason: "Исключён рекрутером" },
                  "Профиль исключён из будущих отправок.",
                );
                setPerson(null);
              }}
            >
              Не контактировать
            </Button>
            <Button onClick={() => setPerson(null)}>Готово</Button>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          title="Проверьте отправку"
          subtitle={`${preview.messages.length} получателей · Отправитель: ${preview.account.label}`}
          wide
          onClose={() => setPreview(null)}
        >
          <div className="hint">
            Утверждаются эти получатели, тексты и дальнейшие действия по
            правилам кампании. Приглашения:{" "}
            {preview.rules.allow_invites ? "разрешены" : "выключены"}. InMail:{" "}
            {preview.rules.allow_inmail
              ? `${preview.rules.strategy === "economy" ? "экономный режим" : "быстрый режим"}, не более ${preview.maximum_credits} кредитов`
              : "выключен"}
            . Работа: {preview.rules.start_hour}:00–{preview.rules.end_hour}:00
            ({preview.rules.timezone}). После принятия приглашения сообщение
            отправится автоматически. Любой ответ остановит обращения.
          </div>
          <div className="message-preview">
            <p>Профиль отправителя: {preview.account.url}</p>
            {preview.context?.contract && (
              <p>
                InMail через Recruiter:{" "}
                <strong>{preview.context.contract}</strong>. Подпись отправителя
                включена в текст ниже.
              </p>
            )}
            <p>
              Проверка каждые {preview.rules.check_hours} ч. · Наблюдение{" "}
              {preview.rules.monitor_days} дней.
              {preview.rules.allow_inmail &&
                preview.rules.strategy === "economy" &&
                ` Переход к InMail через ${preview.rules.wait_days} дней ожидания.`}{" "}
              Бюджеты попыток на отправителя за сутки UTC:{" "}
              {preview.rules.daily_invites} приглашений,{" "}
              {preview.rules.daily_messages} сообщений,{" "}
              {preview.rules.daily_inmails} InMail.
            </p>
            {preview.messages.map((m) => (
              <article key={m.id}>
                <h3>{m.name || m.url}</h3>
                <p>{m.url}</p>
                <pre>{m.message}</pre>
                {preview.rules.allow_invites && (
                  <>
                    <b>Если потребуется приглашение</b>
                    <pre>{m.invitation || "Без заметки"}</pre>
                  </>
                )}
                {preview.rules.allow_inmail && (
                  <>
                    <b>InMail · {m.subject}</b>
                    <pre>{m.inmail_message}</pre>
                  </>
                )}
              </article>
            ))}
          </div>
          {preview.skipped.length > 0 && (
            <p className="muted">
              Исключено повторных или запрещённых контактов:{" "}
              {preview.skipped.length}.
            </p>
          )}
          <div className="modal-footer">
            <Button onClick={() => setPreview(null)}>Вернуться к списку</Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={async () => {
                const r = await act("outreach.approve", {
                  id: preview.run_id,
                  digest: preview.digest,
                });
                if (r) setPreview(null);
              }}
            >
              <Play size={16} />
              Утвердить и запустить кампанию
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Empty({ icon: Icon, title, text, action }) {
  return (
    <section className="empty">
      <div className="empty-icon">
        <Icon size={30} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </section>
  );
}
function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function AccountForm({ onClose, onSubmit, busy }) {
  const [label, setLabel] = useState("");
  return (
    <Modal
      title="Подключить LinkedIn"
      subtitle="Отдельная сессия для каждого аккаунта"
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(label);
        }}
      >
        <label className="field">
          Название аккаунта
          <input
            autoFocus
            required
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Например, Наталья · Recruiting"
          />
        </label>
        <div className="steps">
          <p>
            <span>1</span>Откроется окно LinkedIn.
          </p>
          <p>
            <span>2</span>Войдите и подтвердите вход, если потребуется.
          </p>
          <p>
            <span>3</span>Вернитесь в приложение и проверьте подключение.
          </p>
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button kind="primary" disabled={busy || !label.trim()}>
            Открыть вход <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CampaignForm({ accounts, busy, onClose, onSubmit }) {
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
  return (
    <Modal
      title="Новая кампания"
      subtitle="Начните с поиска. Сообщения можно заполнить после сбора профилей."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(d);
        }}
      >
        <label className="field">
          Название кампании
          <input
            autoFocus
            required
            value={d.name}
            onChange={(e) => change("name", e.target.value)}
            placeholder="Например, Head of Recruitment · Logistics"
            maxLength={150}
          />
        </label>
        <label className="field">
          Аккаунт отправителя
          <select
            value={d.account_id}
            onChange={(e) => change("account_id", e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {labels[a.status]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Ключевые слова
          <textarea
            required
            rows={3}
            value={d.keywords}
            onChange={(e) => change("keywords", e.target.value)}
            placeholder='Например: "driver recruitment" manager'
            maxLength={1000}
          />
          <small>
            Используйте название роли и отрасль. Можно использовать AND, OR и
            кавычки.
          </small>
        </label>
        <label className="field">
          Сколько профилей собрать
          <input
            type="number"
            required
            min={1}
            max={100}
            value={d.max_profiles}
            onChange={(e) => change("max_profiles", Number(e.target.value))}
          />
        </label>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button kind="primary" disabled={busy}>
            Создать кампанию <ArrowRight size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
createRoot(document.getElementById("root")).render(<App />);
