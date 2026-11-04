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
import { AttentionPanel, SearchBuilder, TemplatePicker } from "./Workspace";
import DataSafety, { NotificationsSettings } from "./DataSafety";
import {
  Automation,
  ContactState,
  OutreachHistory,
  DesktopPreferences,
  describeOutreach,
  DetailMessage,
} from "./Outreach";

const api = window.booster;
const frameLabels = {
  open_to_work: "Open to Work",
  hiring: "Hiring — нанимает сотрудников",
  none: "Без рамки",
  unknown: "Не определена",
};
const labels = {
  new: "Не подключён",
  ready: "Готово",
  needs_login: "Требуется вход",
  connecting: "Ожидаем вход",
  identity_mismatch: "Другой профиль",
  restricted: "Ограничение LinkedIn",
  disconnected: "Отключён",
  deleted: "Удалён",
  archived: "В архиве",
  satisfied: "Состояние подтверждено",
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
  cancelled: "Отменено",
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
const profileWord = (count) =>
  ({ one: "профиль", few: "профиля", many: "профилей", other: "профиля" })[
    new Intl.PluralRules("ru").select(count)
  ];
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
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  error,
  initialFocus,
}) {
  const parts = React.Children.toArray(children);
  const form = parts.length === 1 && parts[0].type === "form" ? parts[0] : null;
  const bodyParts = form ? React.Children.toArray(form.props.children) : parts;
  const footer = bodyParts.find(
    (child) => child.props?.className === "modal-footer",
  );
  const body = (
    <>
      <div className="modal-body">
        {bodyParts.filter((child) => child !== footer)}
      </div>
      {footer}
    </>
  );
  const container = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const controls = () =>
      [
        ...container.current.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,a[href],[tabindex="0"]',
        ),
      ].filter(
        (item) => item.getClientRects().length && !item.closest("[inert]"),
      );
    const background = [
      ...document.querySelectorAll(".app > aside, .app > main"),
    ];
    background.forEach((item) => {
      item.inert = true;
    });
    (
      (initialFocus && controls().find((item) => item.matches(initialFocus))) ||
      (form &&
        controls().find((item) => item.matches("input,textarea,select"))) ||
      controls()[0] ||
      container.current
    )?.focus({ preventScroll: !initialFocus });
    const listener = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      }
      if (e.key === "Tab") {
        const items = controls();
        const first = items[0],
          last = items[items.length - 1];
        if (!items.length) {
          e.preventDefault();
          container.current.focus();
        } else if (!container.current.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
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
      background.forEach((item) => {
        item.inert = false;
      });
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (error) {
      const alert = container.current?.querySelector('[role="alert"]');
      alert?.focus();
      alert?.scrollIntoView({ block: "nearest" });
    }
  }, [error]);
  return (
    <div className="veil">
      <section
        ref={container}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
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
        {error && (
          <div className="alert error" role="alert" tabIndex={-1}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        {form
          ? React.cloneElement(form, { className: "modal-form" }, body)
          : body}
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
  const [workspaceSummary, setWorkspaceSummary] = useState(null);
  const [attentionError, setAttentionError] = useState("");
  const [focusTarget, setFocusTarget] = useState(null);
  const [attentionNavigation, setAttentionNavigation] = useState(0);
  const [templateName, setTemplateName] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(null);
  const [checkingItem, setCheckingItem] = useState(null);
  const [invitationRepair, setInvitationRepair] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState("campaigns");
  const [cid, setCid] = useState(null);
  const currentCampaign = useRef(cid);
  currentCampaign.current = cid;
  const [detail, setDetail] = useState(null);
  const [modal, setModalValue] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [tab, setTab] = useState("people");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [personSnapshot, setPersonValue] = useState(null);
  const restorePersonFocus = useRef(false);
  const setModal = (value) => {
    setError("");
    setModalValue(value);
  };
  const setPerson = (value) => {
    setError("");
    restorePersonFocus.current = false;
    setPersonValue(value);
  };
  const person =
    detail?.candidates.find((p) => p.id === personSnapshot?.id) ||
    personSnapshot;
  const [suppressConfirm, setSuppressConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [preview, setPreview] = useState(null);
  const [config, setConfig] = useState("");
  const automationDrafts = useRef(null);
  const [draftPersisted, setDraftPersisted] = useState(true);
  if (automationDrafts.current === null) {
    try {
      const saved = JSON.parse(
        localStorage.getItem("booster.automation-drafts.v1") || "{}",
      );
      automationDrafts.current =
        saved && typeof saved === "object" && !Array.isArray(saved)
          ? saved
          : {};
    } catch {
      automationDrafts.current = {};
    }
  }
  const persistDraft = (id, draft) => {
    if (draft) automationDrafts.current[id] = draft;
    else delete automationDrafts.current[id];
    try {
      localStorage.setItem(
        "booster.automation-drafts.v1",
        JSON.stringify(automationDrafts.current),
      );
      setDraftPersisted(true);
    } catch {
      setDraftPersisted(false);
      setError(
        "Не удалось сохранить черновик на компьютере. Сохраните настройки перед закрытием приложения.",
      );
    }
  };
  const viewKey = JSON.stringify([page, cid, tab]);
  const noticeScope = useRef({ key: viewKey, revision: 0 });
  if (noticeScope.current.key !== viewKey)
    noticeScope.current = {
      key: viewKey,
      revision: noticeScope.current.revision + 1,
    };
  const notify = (text, revision) => {
    if (revision === noticeScope.current.revision)
      setNotice({ text, revision });
  };
  useEffect(() => {
    setNotice("");
    setError("");
  }, [page, cid, tab]);
  useEffect(() => {
    setSuppressConfirm(false);
  }, [person?.id]);
  useEffect(() => {
    if (error && !modal && !person && !preview && !confirmation) {
      const alert = document.querySelector(".app-alert");
      alert?.focus();
      alert?.scrollIntoView({ block: "nearest" });
    }
  }, [error, modal, person?.id, preview?.run_id, confirmation]);
  const refreshWorkspace = useCallback(async () => {
    try {
      setWorkspaceSummary(await api.command("workspace.summary"));
      setAttentionError("");
    } catch (e) {
      setAttentionError(e.message);
    }
  }, []);
  useEffect(() => {
    const unsubscribe = api?.onAttention?.((id) => {
      setPage("attention");
      setCid(null);
      setDetail(null);
      setModal(null);
      setPerson(null);
      setPreview(null);
      setConfirmation((current) => {
        current?.resolve?.(false);
        return null;
      });
      setAttentionNavigation((v) => v + 1);
      setFocusTarget(id ? "attention-" + id : null);
      refreshWorkspace();
    });
    return () => unsubscribe?.();
  }, [refreshWorkspace]);
  useEffect(() => {
    if (!focusTarget) return;
    const target = document.getElementById(focusTarget);
    if (target) {
      if (target.tagName === "DETAILS") target.open = true;
      target.scrollIntoView({ block: "center" });
      target.focus({ preventScroll: true });
      setFocusTarget(null);
    }
  }, [focusTarget, detail, page, tab, workspaceSummary]);
  const refresh = useCallback(async () => {
    if (!api) {
      setLoading(false);
      setWorkspaceError("Откройте Booster Recruiter как приложение.");
      return;
    }
    try {
      setState(await api.command("state"));
      await refreshWorkspace();
      setWorkspaceLoaded(true);
      setWorkspaceError("");
    } catch (e) {
      setWorkspaceError(e.message);
      setLoading(false);
      return;
    }
    setLoading(false);
    if (cid) {
      try {
        const result = await api.command("campaign.detail", { id: cid });
        if (currentCampaign.current === cid) {
          setDetail(result);
          setDetailError("");
        }
      } catch (e) {
        if (currentCampaign.current === cid) setDetailError(e.message);
      }
    }
  }, [cid, refreshWorkspace]);
  const retryLoad = async () => {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  };
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  const act = async (op, p = {}, success = "") => {
    const notificationRevision = noticeScope.current.revision;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const r = await api.command(op, p);
      await refresh();
      if (success) notify(success, notificationRevision);
      return r;
    } catch (e) {
      if (notificationRevision === noticeScope.current.revision)
        setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const recheckAttention = async (id) => {
    setCheckingItem(id);
    try {
      await act(
        "workspace.recheck",
        { id },
        "Проверка запущена. Активный план продолжает работу; план на паузе не возобновляется.",
      );
    } finally {
      setCheckingItem(null);
    }
  };
  const prepareAccountDeletion = async (id) => {
    const result = await act("account.deletion_preview", { id });
    if (result) {
      setDeletingAccount(result);
      setModal("delete-account");
    }
  };
  const eligible = (p) => p.outreach_eligible === true;
  const selected =
    detail?.candidates.filter((p) => p.selected && eligible(p)) || [];
  const campaign = detail?.campaign;
  const active = ["collecting", "sending", "automating", "checking"].includes(
    campaign?.status,
  );
  const liveRun = detail?.outreach?.runs.find((r) => r.status === "active");
  const approvedPlan =
    detail?.outreach?.runs.some((r) =>
      ["active", "paused"].includes(r.status),
    ) || detail?.batches.some((b) => b.status === "approved" && b.pending > 0);
  const confirmPlanChange = () =>
    !approvedPlan
      ? Promise.resolve(true)
      : new Promise((resolve) => {
          restorePersonFocus.current = Boolean(person);
          setConfirmation({ resolve });
        });
  const hasOutreachHistory = detail?.outreach?.runs.some(
    (r) => r.status !== "preview",
  );
  const hasMessageHistory = detail?.candidates.some((p) => p.delivery.length);
  const contactMembers = new Map();
  for (const p of detail?.candidates || [])
    if (p.outreach_member) contactMembers.set(p.id, p.outreach_member);
  const allAccounts = [...state.accounts, ...(state.archived_accounts || [])];
  const account = allAccounts.find((a) => a.id === campaign?.account_id);
  const archived =
    campaign?.status === "archived" || account?.status === "deleted";
  const visibleCampaigns = showArchived
    ? state.archived_campaigns || []
    : state.campaigns;
  const openInSenderAccount = (url) =>
    archived
      ? api.openProfile(url).catch((e) => setError(e.message))
      : act(
          "account.open_profile",
          { id: campaign.account_id, url },
          "Профиль открыт в сессии отправителя.",
        );
  const openCampaign = (id) => {
    setCid(id);
    setDetail(null);
    setDetailError("");
    setPage("campaigns");
    setTab(
      (state.archived_campaigns || []).some((c) => c.id === id)
        ? "history"
        : "people",
    );
    setFilter("all");
    setQuery("");
  };
  const doExport = async (format) => {
    const notificationRevision = noticeScope.current.revision;
    try {
      if (await api.export(cid, format))
        notify("Список сохранён.", notificationRevision);
    } catch (e) {
      if (notificationRevision === noticeScope.current.revision)
        setError(e.message);
    }
  };
  const review = async (p, segment, checked = p.selected) => {
    if (p.segment === segment && !!p.selected === !!checked) return true;
    if (!(await confirmPlanChange())) return false;
    const result = await act("candidate.review", {
      id: p.id,
      segment,
      selected: !!checked,
      excluded: !!p.excluded,
    });
    return result;
  };
  const selectVisible = async (checked) => {
    const ids = people
      .filter((p) => eligible(p) && !!p.selected !== checked)
      .map((p) => p.id);
    if (!ids.length || !(await confirmPlanChange())) return;
    await act("candidate.select_many", {
      campaign_id: cid,
      ids,
      selected: checked,
    });
  };
  const saveAutomation = async (rules, texts, reviewAfterSave = false) => {
    const changed =
      JSON.stringify(rules) !== JSON.stringify(detail.outreach.rules) ||
      texts.open !== campaign.template_open ||
      texts.neutral !== campaign.template_neutral;
    if (changed && !(await confirmPlanChange())) return false;
    const notificationRevision = noticeScope.current.revision;
    setError("");
    setBusy(true);
    try {
      if (changed)
        await api.command("campaign.save_automation", {
          id: cid,
          rules,
          template_open: texts.open,
          template_neutral: texts.neutral,
        });
      persistDraft(cid, null);
      if (reviewAfterSave) {
        const nextPreview = await api.command("outreach.preview", { id: cid });
        if (
          notificationRevision === noticeScope.current.revision &&
          currentCampaign.current === cid
        )
          setPreview(nextPreview);
      } else
        notify(
          !changed && approvedPlan
            ? "Текущий план сохранён без изменений."
            : "Настройки и тексты сохранены. Кампания не запущена.",
          notificationRevision,
        );
      await refresh();
      return true;
    } catch (e) {
      if (notificationRevision === noticeScope.current.revision)
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
            [Inbox, "attention", "Требует внимания"],
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
              {id === "attention" &&
                workspaceSummary &&
                workspaceSummary.items.length > 0 && (
                  <span>{workspaceSummary.items.length}</span>
                )}
              {id === "campaigns" && workspaceLoaded && (
                <span>{state.campaigns.length}</span>
              )}
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
              : page === "attention"
                ? "Требует внимания"
                : page === "accounts"
                  ? "Аккаунты"
                  : "Настройки"}{" "}
            {cid && (
              <>
                <ChevronRight size={14} />
                {campaign?.name ||
                  state.campaigns.find((c) => c.id === cid)?.name ||
                  "Кампания"}
              </>
            )}
          </span>
          <span className="connection">
            <i />
            Локальное приложение
          </span>
        </div>
        {error && !modal && !person && !preview && !confirmation && (
          <div className="alert error app-alert" role="alert" tabIndex={-1}>
            <AlertCircle size={18} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="Скрыть ошибку">
              <X size={16} />
            </button>
          </div>
        )}
        {notice && notice.revision === noticeScope.current.revision && (
          <div className="alert success" role="status">
            <CheckCircle2 size={18} />
            <span>{notice.text}</span>
            <button
              onClick={() => setNotice("")}
              aria-label="Скрыть уведомление"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {workspaceLoaded &&
          (workspaceError || (cid && detail && detailError)) && (
            <div className="alert warning refresh-warning" role="status">
              <AlertCircle size={18} />
              <span>
                Не удалось обновить данные. Показана последняя загруженная
                версия.
              </span>
              <Button onClick={retryLoad} disabled={retrying}>
                {retrying ? "Обновляем…" : "Обновить данные"}
              </Button>
            </div>
          )}
        <div className="content">
          {loading ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              <h2>Открываем рабочее пространство…</h2>
            </div>
          ) : !workspaceLoaded ? (
            <LoadFailure
              title="Не удалось открыть рабочее пространство"
              text="Не удалось загрузить аккаунты и кампании. Повторите попытку."
              detail={workspaceError}
              onRetry={retryLoad}
              retrying={retrying}
            />
          ) : page === "attention" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</p>
                  <h1>Требует внимания</h1>
                  <p>
                    Ответы и следующие действия по всем кампаниям. Исправляйте
                    отдельные профили, сохраняя общий план.
                  </p>
                </div>
              </div>
              <AttentionPanel
                key={attentionNavigation}
                campaigns={state.campaigns}
                accounts={state.accounts}
                summary={workspaceSummary}
                error={attentionError}
                disabled={busy}
                onSettings={() => {
                  setPage("settings");
                  setCid(null);
                  setDetail(null);
                }}
                checkingItem={checkingItem}
                onCheck={recheckAttention}
                onRepair={(item) => {
                  setInvitationRepair({ id: item.id, ...item.repair });
                  setModal("retry-invitation");
                }}
                onRetry={refreshWorkspace}
                onRead={(id) => act("workspace.acknowledge", { id })}
                onOpen={(item) => {
                  if (item.kind === "login") {
                    setPage("accounts");
                    setCid(null);
                    setDetail(null);
                    setFocusTarget("account-" + item.account_id);
                  } else {
                    openCampaign(item.campaign_id);
                    setTab("history");
                    setFocusTarget(
                      item.action_id
                        ? "action-" + item.action_id
                        : "member-" + item.member_id,
                    );
                  }
                }}
              />
            </>
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
                          LinkedIn ограничил действия аккаунта. Откройте
                          LinkedIn, проверьте уведомления и выполните требования
                          сервиса. Повторный вход сам по себе не снимает
                          ограничение.
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
                            title="Открыть профиль в обычном браузере"
                            aria-label={
                              "Открыть профиль " +
                              a.label +
                              " в обычном браузере"
                            }
                            onClick={async () => {
                              try {
                                await api.openProfile(a.url);
                              } catch (e) {
                                setError(e.message);
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
                      <div className="account-session-controls">
                        {a.status === "ready" && (
                          <button
                            className="button small"
                            disabled={busy}
                            onClick={() =>
                              act("account.disconnect", { id: a.id })
                            }
                          >
                            Отключить сессию
                          </button>
                        )}
                        <div className="account-removal">
                          <button
                            className="text-button account-delete"
                            disabled={busy}
                            onClick={() => prepareAccountDeletion(a.id)}
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
              <div className="settings-layout">
                <DesktopPreferences />
                <NotificationsSettings />
                <DataSafety
                  onRestored={async () => {
                    setCid(null);
                    setDetail(null);
                    setPreview(null);
                    setPerson(null);
                    setConfirmation(null);
                    automationDrafts.current = {};
                    try {
                      localStorage.removeItem("booster.automation-drafts.v1");
                    } catch {}
                    await refresh();
                  }}
                />
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
                            Добавьте отправителя на вкладке «Аккаунты» и
                            выполните вход.
                          </p>
                        </div>
                      </li>
                      <li>
                        <div>
                          <strong>Создайте кампанию</strong>
                          <p>
                            Укажите ключевые слова и число профилей для поиска.
                          </p>
                        </div>
                      </li>
                      <li>
                        <div>
                          <strong>Выберите кандидатов</strong>
                          <p>
                            Проверьте группы сообщений и отметьте нужные
                            профили.
                          </p>
                        </div>
                      </li>
                      <li>
                        <div>
                          <strong>Проверьте и запустите</strong>
                          <p>
                            В «Автоматизации» задайте способ связи и тексты.
                            Проверьте получателей перед подтверждением.
                          </p>
                        </div>
                      </li>
                      <li>
                        <div>
                          <strong>Сохраните результат</strong>
                          <p>
                            Профили и текущие статусы — в CSV или Excel. Полная
                            история действий — на отдельном листе Excel.
                          </p>
                        </div>
                      </li>
                    </ol>
                  </section>
                  <section className="panel settings-card">
                    <header className="settings-card-heading">
                      <h2>Работа с кампаниями</h2>
                      <p>Что происходит после подтверждения запуска.</p>
                    </header>
                    <div className="settings-help-item">
                      <h3>Приглашения и сообщения</h3>
                      <p>
                        Программа следует выбранному плану связи. После принятия
                        приглашения отправляет утверждённое сообщение. Ответ
                        кандидата останавливает дальнейшие обращения.
                      </p>
                    </div>
                    <div className="settings-help-item">
                      <h3>Пауза и проверка результата</h3>
                      <p>
                        «Пауза» дожидается текущего действия и сохраняет план.
                        Если результат отправки неизвестен, сначала проверьте
                        переписку в LinkedIn — повтор может создать дубль.
                      </p>
                    </div>
                    <div className="settings-help-item">
                      <h3>Что означает рамка</h3>
                      <p>
                        Open to Work помогает выбрать текст обращения.
                        Отсутствие рамки не подтверждает занятость человека или
                        его нежелание менять работу.
                      </p>
                    </div>
                  </section>
                </div>
                <details className="panel settings-card settings-disclosure">
                  <summary>
                    <div>
                      <h2>Подключение ИИ-агента</h2>
                      <p>Дополнительно · управление через MCP</p>
                    </div>
                    <ChevronRight size={20} aria-hidden="true" />
                  </summary>
                  <div className="settings-integration">
                    <p>
                      Агент может работать с теми же кампаниями через MCP, пока
                      приложение работает, в том числе в фоне. Подтверждение
                      новой рассылки остаётся за вами.
                    </p>
                    <Button
                      onClick={async () => {
                        try {
                          setConfig(await api.mcpConfig());
                        } catch (e) {
                          setError(e.message);
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
                  {state.accounts.length
                    ? "Новая кампания"
                    : "Подключить LinkedIn"}
                </Button>
              </div>

              {(workspaceSummary?.templates || []).length > 0 && (
                <div className="workspace-template-shortcut">
                  <Button onClick={() => setModal("template")}>
                    Создать из шаблона
                  </Button>
                </div>
              )}
              <div className="archive-tabs" aria-label="Список кампаний">
                <button
                  className={"button " + (!showArchived ? "primary" : "")}
                  aria-pressed={!showArchived}
                  onClick={() => setShowArchived(false)}
                >
                  Активные
                </button>
                <button
                  className={"button " + (showArchived ? "primary" : "")}
                  aria-pressed={showArchived}
                  onClick={() => setShowArchived(true)}
                >
                  Архив · {(state.archived_campaigns || []).length}
                </button>
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
              {!visibleCampaigns.length ? (
                <Empty
                  icon={Search}
                  title={
                    showArchived
                      ? "Архив пока пуст"
                      : "Найдите людей для вашей следующей вакансии"
                  }
                  text={
                    showArchived
                      ? "История кампаний удалённых аккаунтов появится здесь."
                      : "Задайте ключевые слова и подготовьте сообщения. Программа сохранит найденные профили и поможет проверить их перед отправкой."
                  }
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
                    <h2>{showArchived ? "Архив кампаний" : "Все кампании"}</h2>
                    <span>{visibleCampaigns.length} всего</span>
                  </div>
                  <div className="table-scroll">
                    <table className="campaign-table">
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
                        {visibleCampaigns.map((c) => (
                          <tr
                            className="clickable"
                            key={c.id}
                            onClick={() => openCampaign(c.id)}
                          >
                            <td>
                              <button
                                className="text-button campaign-entry"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openCampaign(c.id);
                                }}
                              >
                                {c.name}
                              </button>
                              <small>{c.keywords}</small>
                            </td>
                            <td>
                              {
                                allAccounts.find((a) => a.id === c.account_id)
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
                </div>
              )}
            </>
          ) : !detail && detailError ? (
            <LoadFailure
              title="Не удалось открыть кампанию"
              text="Данные кампании не загрузились. Повторите попытку или вернитесь к списку."
              detail={detailError}
              onRetry={retryLoad}
              retrying={retrying}
              onBack={() => setCid(null)}
            />
          ) : !detail ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              <h2>Открываем кампанию…</h2>
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
                    disabled={archived || active || busy}
                    onClick={() => {
                      setTemplateName(campaign.name);
                      setModal("save-template");
                    }}
                  >
                    Сохранить шаблон
                  </Button>
                  <Button
                    disabled={active || busy}
                    onClick={() => doExport("xlsx")}
                  >
                    <Download size={17} />
                    Excel
                  </Button>
                  {archived ? (
                    <span className="search-complete">
                      В архиве · только история
                    </span>
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
                    <span className="search-complete">
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
                  Аккаунт удалён. История и экспорт сохранены; новые отправки из
                  этой кампании недоступны.
                </div>
              )}
              {!archived && account?.status !== "ready" && (
                <div className="hint warning">
                  Подключите аккаунт отправителя, чтобы искать кандидатов и
                  запускать кампанию.{" "}
                  <button
                    className="text-link"
                    onClick={() => {
                      setPage("accounts");
                      setCid(null);
                      setDetail(null);
                    }}
                  >
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
                  onSave={saveAutomation}
                  onPeople={() => setTab("people")}
                  onHistory={() => setTab("history")}
                  onAccounts={() => {
                    setPage("accounts");
                    setCid(null);
                    setDetail(null);
                  }}
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
                    onResolve={(id, confirmed) =>
                      act("outreach.resolve", { id, confirmed })
                    }
                    onResume={(id) => act("outreach.resume", { id })}
                    onOpen={
                      archived
                        ? (url) =>
                            api
                              .openProfile(url)
                              .catch((e) => setError(e.message))
                        : openInSenderAccount
                    }
                    onCheck={
                      archived
                        ? undefined
                        : (id) => recheckAttention("review:" + id)
                    }
                  />
                  {detail.batches
                    .filter((b) => b.status === "approved" && b.pending > 0)
                    .map((b) => (
                      <div className="toolbar" key={b.id}>
                        <p>
                          В подтверждённой очереди осталось: {b.pending}.
                          {b.unknown > 0
                            ? " Неподтверждённые отправки отложены для проверки. Очередь продолжится только для остальных получателей."
                            : " Отправитель и тексты сохранены."}
                        </p>
                        <Button
                          disabled={active || busy}
                          onClick={() => act("batch.resume", { id: b.id })}
                        >
                          <Play size={16} />
                          Продолжить очередь
                        </Button>
                      </div>
                    ))}
                  {hasMessageHistory && (
                    <>
                      {hasOutreachHistory && (
                        <h3 className="history-message-title">
                          Другие сообщения
                        </h3>
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
                                      p.delivery.find(
                                        (d) => d.status === "unknown",
                                      ) || p.delivery[0]
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
                                          Откройте диалог и проверьте, появилось
                                          ли это сообщение.
                                        </p>
                                        <Button
                                          disabled={archived || active || busy}
                                          onClick={() =>
                                            recheckAttention(
                                              "delivery:" + p.delivery[0].id,
                                            )
                                          }
                                        >
                                          Проверить автоматически
                                        </Button>
                                        <Button
                                          onClick={() =>
                                            archived
                                              ? api
                                                  .openProfile(p.url)
                                                  .catch((e) =>
                                                    setError(e.message),
                                                  )
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
                        После запуска здесь появятся приглашения, сообщения и
                        результаты по каждому кандидату.
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
                              className={
                                p.selected && eligible(p) ? "selected" : ""
                              }
                            >
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={
                                    "Выбрать " + (p.data.name || p.url)
                                  }
                                  checked={!!p.selected && eligible(p)}
                                  title={
                                    p.outreach_exclusion ||
                                    "Выбрать для этой кампании"
                                  }
                                  aria-describedby={
                                    !eligible(p)
                                      ? `eligibility-${p.id}`
                                      : undefined
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
                                  disabled={archived || active || busy}
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
                                  <option value="neutral">Нейтральное</option>
                                </select>
                              </td>
                              <td>
                                {!eligible(p) && (
                                  <span
                                    className="sr-only"
                                    id={`eligibility-${p.id}`}
                                  >
                                    {p.outreach_exclusion}
                                  </span>
                                )}
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
                      {detail.candidates.length ? (
                        <>
                          <p>
                            Поиск и фильтр скрыли профили. Измените запрос или
                            сбросьте фильтры.
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
                          Нажмите «Найти кандидатов», чтобы собрать профили по
                          вашему запросу.
                        </p>
                      )}
                    </div>
                  )}
                  <div className="table-footer">
                    <span>
                      Показано: {people.length} {profileWord(people.length)} ·
                      Всего выбрано: {selected.length}
                    </span>
                    <span>Изменение группы сохраняется автоматически</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      {modal === "retry-invitation" && invitationRepair && (
        <Modal
          title="Отправить приглашение?"
          subtitle={invitationRepair.name}
          error={error}
          onClose={() => {
            setModal(null);
            setInvitationRepair(null);
          }}
        >
          <div className="repair-confirm-details">
            <dl>
              <div>
                <dt>Получатель</dt>
                <dd>{invitationRepair.name}</dd>
                <dd>{invitationRepair.url}</dd>
              </div>
              <div>
                <dt>Отправитель</dt>
                <dd>
                  {invitationRepair.account_label ||
                    state.accounts.find(
                      (a) => a.id === invitationRepair.account_id,
                    )?.label}
                </dd>
              </div>
            </dl>
            <div>
              <h3>Текст приглашения</h3>
              <pre>{invitationRepair.note || "Приглашение без заметки"}</pre>
            </div>
            <p>
              Результат старой попытки не подтверждён. Сейчас LinkedIn разрешает
              новое приглашение; перед отправкой ещё раз проверим профиль и
              доступность действия.
            </p>
            <p className="hint">
              Запрос касается только этого получателя. После подтверждения
              LinkedIn его статус обновится в той же кампании. Остальные
              получатели сохранят свой план.
            </p>
          </div>
          <div className="modal-footer">
            <Button
              disabled={busy}
              onClick={() => {
                setModal(null);
                setInvitationRepair(null);
              }}
            >
              Отмена
            </Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={async () => {
                const result = await act(
                  "workspace.retry_invitation",
                  {
                    id: invitationRepair.id,
                    digest: invitationRepair.digest,
                    confirm: true,
                  },
                  "Запрос принят. Результат приглашения появится здесь и в кампании.",
                );
                if (result) {
                  setModal(null);
                  setInvitationRepair(null);
                }
              }}
            >
              {busy ? "Запускаем…" : "Подтвердить приглашение"}
            </Button>
          </div>
        </Modal>
      )}
      {modal === "delete-account" && deletingAccount && (
        <Modal
          title="Удалить аккаунт из приложения?"
          subtitle={deletingAccount.label}
          error={error}
          onClose={() => {
            setModal(null);
            setDeletingAccount(null);
          }}
        >
          <p>
            Аккаунт исчезнет из списка, его сохранённая сессия LinkedIn будет
            удалена с этого компьютера. Сам профиль LinkedIn сохранится.
          </p>
          <p>
            Связанных кампаний:{" "}
            <strong>
              {deletingAccount.campaign_count ??
                deletingAccount.campaigns?.length ??
                0}
            </strong>
            . Кампании перейдут в «Архив», их история сохранится, а обработка
            будет остановлена. Другие аккаунты, включая отдельные сессии того же
            профиля, останутся.
          </p>
          <p className="hint">
            Новые обращения из сохранённой истории не запускаются автоматически.
          </p>
          <div className="modal-footer">
            <Button
              disabled={busy}
              onClick={() => {
                setModal(null);
                setDeletingAccount(null);
              }}
            >
              Отмена
            </Button>
            <Button
              kind="primary"
              disabled={busy}
              onClick={async () => {
                const result = await act("account.delete", {
                  id: deletingAccount.id,
                  confirm: true,
                });
                if (result) {
                  setModal(null);
                  setDeletingAccount(null);
                  setCid(null);
                  setDetail(null);
                }
              }}
            >
              Удалить аккаунт и сессию
            </Button>
          </div>
        </Modal>
      )}
      {modal === "account" && (
        <AccountForm
          error={error}
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
      {modal === "template" && (
        <Modal
          title="Кампания из шаблона"
          subtitle="Начните новую кампанию с сохранёнными настройками."
          error={error}
          onClose={() => setModal(null)}
        >
          <TemplatePicker
            templates={workspaceSummary?.templates || []}
            accounts={state.accounts}
            disabled={busy}
            onDelete={(id) => act("template.delete", { id })}
            onCreate={async (params) => {
              const c = await act("template.create", params);
              if (c) {
                setModal(null);
                openCampaign(c.id);
              }
            }}
          />
        </Modal>
      )}
      {modal === "save-template" && (
        <Modal
          title="Сохранить шаблон"
          subtitle="Сохраняются настройки кампании. Сначала сохраните изменения в автоматизации. Кандидаты и разрешение на отправку не переносятся."
          error={error}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const saved = await act("template.save", {
                campaign_id: cid,
                name: templateName.trim(),
              });
              if (saved) setModal(null);
            }}
          >
            <label className="field">
              Название шаблона
              <input
                autoFocus
                required
                maxLength={150}
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </label>
            <div className="modal-footer">
              <Button type="button" onClick={() => setModal(null)}>
                Отмена
              </Button>
              <Button kind="primary" disabled={busy || !templateName.trim()}>
                Сохранить шаблон
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "campaign" && (
        <CampaignForm
          error={error}
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
      {person && !confirmation && (
        <Modal
          error={error}
          title={person.data.name || "Профиль кандидата"}
          subtitle="Проверка исходных сведений"
          initialFocus={restorePersonFocus.current ? "select" : undefined}
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
                Рамка:{" "}
                {frameLabels[person.data.photo_frame?.status] ||
                  "Не определена"}
                . Отсутствие подтверждения не означает, что человек не ищет
                работу.
              </p>
              {archived && (
                <p className="hint">
                  Архивная запись. Ссылка откроется в обычном браузере.
                </p>
              )}
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
          <label className="field">
            Группа сообщения
            <select
              value={person.segment}
              disabled={archived || active || busy}
              onChange={(e) =>
                review(
                  person,
                  e.target.value,
                  e.target.value === "review" ? false : person.selected,
                )
              }
            >
              <option value="review">Нужно проверить</option>
              <option value="open">Open to Work</option>
              <option value="neutral">Нейтральное сообщение</option>
            </select>
            <small>
              {archived
                ? "Архивная запись доступна только для просмотра."
                : person.segment === "review"
                  ? "Проверьте сведения и выберите группу. Затем профиль можно будет включить в кампанию."
                  : !eligible(person)
                    ? person.outreach_exclusion
                    : person.selected
                      ? "Группа сохранена. Профиль выбран для этой кампании."
                      : "Группа сохранена. Выберите профиль в списке кандидатов, чтобы включить его в кампанию."}
            </small>
          </label>
          {(suppressConfirm || person.blocked) && (
            <div className="hint warning">
              {person.blocked
                ? "Этот профиль исключён из будущих обращений во всех кампаниях и со всех аккаунтов."
                : "Исключить этот профиль из будущих обращений во всех кампаниях и со всех аккаунтов? Уже отправленные сообщения и приглашения останутся в LinkedIn."}
            </div>
          )}
          <div className="modal-footer">
            <Button
              kind="danger"
              onClick={async () => {
                if (!suppressConfirm) {
                  setSuppressConfirm(true);
                  return;
                }
                const result = await act(
                  "candidate.suppress",
                  { url: person.url, reason: "Исключён рекрутером" },
                  "Профиль исключён из будущих обращений во всех кампаниях.",
                );
                if (result) setPerson(null);
              }}
              disabled={archived || busy || person.blocked}
            >
              {person.blocked
                ? "Контакт исключён"
                : suppressConfirm
                  ? "Исключить во всех кампаниях"
                  : "Не контактировать"}
            </Button>
            {suppressConfirm ? (
              <Button disabled={busy} onClick={() => setSuppressConfirm(false)}>
                Отмена
              </Button>
            ) : (
              <Button onClick={() => setPerson(null)}>Закрыть</Button>
            )}
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          error={error}
          title="Проверьте отправку"
          subtitle={`${preview.messages.length} ${{ one: "получатель", few: "получателя", many: "получателей", other: "получателя" }[new Intl.PluralRules("ru").select(preview.messages.length)]} · Отправитель: ${preview.account.label}`}
          wide
          onClose={() => setPreview(null)}
        >
          <div className="hint">{describeOutreach(preview.rules)}</div>
          {approvedPlan && (
            <div className="hint warning">
              Текущий утверждённый план сохранён. Он будет заменён только после
              нажатия «Утвердить и запустить кампанию».
            </div>
          )}
          <div className="message-preview">
            <p>Профиль отправителя: {preview.account.url}</p>
            {preview.rules.allow_inmail && (
              <p>
                <strong>
                  Максимальный расход InMail: {preview.maximum_credits}{" "}
                  {
                    {
                      one: "кредит",
                      few: "кредита",
                      many: "кредитов",
                      other: "кредита",
                    }[
                      new Intl.PluralRules("ru").select(preview.maximum_credits)
                    ]
                  }
                  .
                </strong>{" "}
                Только для этих получателей, если бесплатная связь недоступна.
                Используем доступные кредиты подписки; дополнительные не
                покупаем.
              </p>
            )}
            {preview.context?.contract && (
              <p>
                InMail через Recruiter:{" "}
                <strong>{preview.context.contract}</strong>. Подпись отправителя
                включена в текст ниже.
              </p>
            )}
            <details>
              <summary>Расписание и проверки</summary>
              <p>
                Работа: {preview.rules.start_hour}:00–{preview.rules.end_hour}
                :00 ({preview.rules.timezone}). Проверка каждые{" "}
                {preview.rules.check_hours} ч. · Наблюдение{" "}
                {preview.rules.monitor_days} дней.
                {preview.rules.allow_inmail &&
                  preview.rules.allow_invites &&
                  preview.rules.strategy === "economy" &&
                  ` Переход к InMail через ${preview.rules.wait_days} дней ожидания.`}
              </p>
            </details>
            <p>
              Обрабатываем только выбранных получателей. При ограничении
              LinkedIn остановимся и сохраним очередь.
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
            <Button onClick={() => setPreview(null)}>
              Вернуться к настройкам
            </Button>
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
      {confirmation && (
        <Modal
          title="Изменить утверждённую кампанию?"
          subtitle="Текущий план будет остановлен"
          onClose={() => {
            confirmation.resolve(false);
            setConfirmation(null);
          }}
        >
          <p>
            Изменение списка, правил или текстов остановит проверки принятия
            приглашений и дальнейшую отправку по текущему плану. Уже выполненные
            действия сохранятся в истории.
          </p>
          <p className="confirmation-next">
            После изменений проверьте новый план и утвердите запуск в разделе
            «Автоматизация».
          </p>
          <div className="modal-footer">
            <Button
              onClick={() => {
                confirmation.resolve(false);
                setConfirmation(null);
              }}
            >
              Оставить текущий план
            </Button>
            <Button
              kind="primary"
              onClick={() => {
                confirmation.resolve(true);
                setConfirmation(null);
              }}
            >
              Изменить план
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function LoadFailure({ title, text, detail, onRetry, retrying, onBack }) {
  return (
    <section className="empty load-failure" role="alert">
      <div className="empty-icon">
        <AlertCircle size={30} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="load-failure-actions">
        {onBack && (
          <Button onClick={onBack}>
            <ArrowLeft size={16} />
            Все кампании
          </Button>
        )}
        <Button kind="primary" disabled={retrying} onClick={onRetry}>
          <RefreshCw size={16} className={retrying ? "spin" : ""} />
          {retrying ? "Загружаем…" : "Попробовать ещё раз"}
        </Button>
      </div>
      {detail && (
        <details className="technical-details">
          <summary>Технические подробности</summary>
          <pre>{detail}</pre>
        </details>
      )}
    </section>
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
function AccountForm({ onClose, onSubmit, busy, error }) {
  const [label, setLabel] = useState("");
  return (
    <Modal
      error={error}
      title="Подключить LinkedIn"
      subtitle="Отдельная сессия для каждого аккаунта"
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
          Название аккаунта
          <input
            required
            maxLength={100}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Например, Recruiting · Основной"
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
function CampaignForm({ accounts, busy, onClose, onSubmit, error }) {
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
    name: !d.name.trim() ? "Введите название кампании." : "",
    keywords: !d.keywords.trim()
      ? "Введите ключевые слова или ссылку на профиль LinkedIn."
      : d.keywords.length > 1000
        ? "Сократите поисковый запрос до 1000 символов."
        : "",
    account_id: !accounts.some((a) => a.id === d.account_id)
      ? "Выберите аккаунт отправителя."
      : "",
    max_profiles:
      !Number.isInteger(d.max_profiles) ||
      d.max_profiles < 1 ||
      d.max_profiles > 100
        ? "Укажите целое число от 1 до 100."
        : "",
  };
  return (
    <Modal
      error={error}
      title="Новая кампания"
      subtitle="Начните с поиска. Сообщения можно заполнить после сбора профилей."
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
          Название кампании
          <input
            name="name"
            aria-invalid={attempted && !!errors.name}
            aria-describedby={
              attempted && errors.name ? "campaign-name-error" : undefined
            }
            required
            value={d.name}
            onChange={(e) => change("name", e.target.value)}
            placeholder="Например, Head of Recruitment · Logistics"
            maxLength={150}
          />
          {attempted && errors.name && (
            <small className="field-error" id="campaign-name-error">
              {errors.name}
            </small>
          )}
        </label>
        <label className="field">
          Аккаунт отправителя
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
          Сколько профилей собрать
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
