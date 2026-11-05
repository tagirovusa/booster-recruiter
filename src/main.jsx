import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutGrid,
  Users,
  Settings,
  ArrowLeft,
  Search,
  Play,
  Pause,
  Download,
  ExternalLink,
  X,
  ChevronRight,
  MessageSquare,
  ShieldCheck,
  LoaderCircle,
  Inbox,
  CheckCircle2,
  AlertCircle,
  Pencil,
  Archive,
  Trash2,
  RotateCcw,
} from "lucide-react";
import "./style.css";
import { AttentionPanel, TemplatePicker } from "./Workspace";
import { frameLabels } from "./labels";
import { plural } from "./text";
import {
  Badge,
  BusyContext,
  Button,
  LoadFailure,
  Modal,
  Stat,
  fmt,
  initials,
  profileWord,
} from "./ui";
import { AccountForm, CampaignForm } from "./forms";
import SettingsPage from "./pages/SettingsPage";
import AccountsPage from "./pages/AccountsPage";
import CampaignsPage from "./pages/CampaignsPage";
import {
  Automation,
  ContactState,
  OutreachHistory,
  describeOutreach,
  DetailMessage,
} from "./Outreach";

const api = window.booster;
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
  const [previewing, setPreviewing] = useState(false);
  const [campaignEdit, setCampaignEdit] = useState(null);
  // Background refresh: newer requests win, polls never overlap, and one
  // failed poll does not flash a warning.
  const refreshSeq = useRef(0);
  const polling = useRef(false);
  const refreshFailures = useRef(0);
  const loadedOnce = useRef(false);
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
    const seq = ++refreshSeq.current;
    // A slower, older request must not overwrite data loaded after an action.
    const stale = () => seq !== refreshSeq.current;
    try {
      const nextState = await api.command("state");
      if (stale()) return;
      setState(nextState);
      await refreshWorkspace();
      setWorkspaceLoaded(true);
      loadedOnce.current = true;
      setWorkspaceError("");
      refreshFailures.current = 0;
    } catch (e) {
      if (stale()) return;
      refreshFailures.current += 1;
      // Show the warning only after repeated failures, or when nothing has
      // been loaded yet; a single slow poll is not worth alarming anyone.
      if (refreshFailures.current >= 3 || !loadedOnce.current)
        setWorkspaceError(e.message);
      setLoading(false);
      return;
    }
    setLoading(false);
    if (cid) {
      try {
        const result = await api.command("campaign.detail", { id: cid });
        if (currentCampaign.current === cid && !stale()) {
          setDetail(result);
          setDetailError("");
        }
      } catch (e) {
        if (currentCampaign.current === cid && !stale())
          setDetailError(e.message);
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
    const timer = setInterval(() => {
      if (polling.current || document.hidden) return;
      polling.current = true;
      refresh().finally(() => {
        polling.current = false;
      });
    }, 2500);
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
  const goTo = (target) => {
    setPage(target);
    setCid(null);
    setDetail(null);
  };
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
        setPreviewing(true);
        const nextPreview = await api
          .command("outreach.preview", { id: cid })
          .finally(() => setPreviewing(false));
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
    <BusyContext.Provider value={busy}>
      <div className="app">
        <aside className="sidebar">
          <img className="brand" src="/brand/logo.svg" alt="Business Booster" />
          <div className="product">
            Подбор <span>персонала</span>
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
                  onSettings={() => goTo("settings")}
                  checkingItem={checkingItem}
                  onCheck={recheckAttention}
                  onRepair={(item) => {
                    setInvitationRepair({ id: item.id, ...item.repair });
                    setModal("retry-invitation");
                  }}
                  onRetry={refreshWorkspace}
                  onRead={(id) => act("workspace.acknowledge", { id })}
                  onReply={(item) =>
                    act(
                      "account.open_profile",
                      { id: item.account_id, url: item.url },
                      "Профиль кандидата открыт в браузере отправителя. Нажмите «Сообщение», чтобы ответить.",
                    )
                  }
                  onOpen={(item) => {
                    if (item.kind === "login") {
                      goTo("accounts");
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
              <AccountsPage
                accounts={state.accounts}
                busy={busy}
                act={act}
                onAdd={() => setModal("account")}
                onDelete={prepareAccountDeletion}
                onError={setError}
              />
            ) : page === "settings" ? (
              <SettingsPage
                onError={setError}
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
            ) : !cid ? (
              <CampaignsPage
                state={state}
                accounts={allAccounts}
                templates={workspaceSummary?.templates || []}
                showArchived={showArchived}
                onShowArchived={setShowArchived}
                campaigns={visibleCampaigns}
                onOpen={openCampaign}
                onModal={setModal}
              />
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
                    <h1>{campaign.name}</h1>
                    <p>
                      {campaign.keywords}
                      {account?.label && (
                        <span className="muted-inline">
                          {" "}
                          · отправитель: {account.label}
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
                                "Кампания возвращена из архива.",
                              )
                            }
                          >
                            <RotateCcw size={17} />
                            Вернуть из архива
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
                          Удалить
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setCampaignEdit({
                            name: campaign.name,
                            max_profiles: campaign.max_profiles,
                            keywords: campaign.keywords,
                            armed: false,
                          });
                          setModal("edit-campaign");
                        }}
                      >
                        <Pencil size={17} />
                        Изменить
                      </Button>
                    )}
                    <Button
                      disabled={archived || active || busy}
                      title={
                        active
                          ? "Шаблон можно сохранить, когда кампания на паузе."
                          : archived
                            ? "Кампания в архиве."
                            : undefined
                      }
                      onClick={() => {
                        setTemplateName(campaign.name);
                        setModal("save-template");
                      }}
                    >
                      Сохранить шаблон
                    </Button>
                    <Button
                      disabled={active || busy}
                      title={
                        active
                          ? "Выгрузка доступна, когда кампания на паузе или завершена."
                          : undefined
                      }
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
                      <span
                        className="search-complete"
                        title="Чтобы найти больше людей, нажмите «Изменить» и увеличьте число профилей."
                      >
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
                    {account?.status === "deleted"
                      ? "Аккаунт удалён. История и экспорт сохранены; новые отправки из этой кампании недоступны."
                      : "Кампания в архиве. История и экспорт сохранены. Чтобы продолжить работу, верните её из архива."}
                  </div>
                )}
                {!archived && account?.status !== "ready" && (
                  <div className="hint warning">
                    Подключите аккаунт отправителя, чтобы искать кандидатов и
                    запускать кампанию.{" "}
                    <button
                      className="text-link"
                      onClick={() => goTo("accounts")}
                    >
                      Открыть аккаунты
                    </button>
                  </div>
                )}
                {(tab === "people" ||
                  active ||
                  campaign.status === "paused") && (
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
                  <div className="stats compact">
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
                      label="Без группы"
                      value={
                        detail.candidates.filter((p) => p.segment === "review")
                          .length
                      }
                    />
                    <Stat
                      label="Выбрано для сообщения"
                      value={selected.length}
                    />
                  </div>
                )}
                <div className="tabs">
                  {[
                    ["people", "Кандидаты", Users],
                    ["automation", "Отправка", Settings],
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
                      title={
                        active
                          ? "Пока кампания работает, список кандидатов не меняется. Поставьте её на паузу."
                          : archived
                            ? "Кампания в архиве."
                            : undefined
                      }
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
                                      <small>
                                        {fmt(p.delivery[0].updated)}
                                      </small>
                                      <details>
                                        <summary>Текст сообщения</summary>
                                        <p className="message-text">
                                          {p.delivery[0].message}
                                        </p>
                                      </details>
                                      {p.delivery[0].status === "unknown" && (
                                        <div className="resolution">
                                          <p>
                                            Откройте диалог и проверьте,
                                            появилось ли это сообщение.
                                          </p>
                                          <Button
                                            disabled={
                                              archived || active || busy
                                            }
                                            onClick={() =>
                                              recheckAttention(
                                                "delivery:" + p.delivery[0].id,
                                              )
                                            }
                                          >
                                            Уточнить статус
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
                                            disabled={
                                              archived || active || busy
                                            }
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
                                            disabled={
                                              archived || active || busy
                                            }
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
                        <option value="neutral">Обычный текст</option>
                        <option value="review">Без группы</option>
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
                                          "data:image/png;base64," +
                                          p.data.photo
                                        }
                                        alt="Аватар кандидата"
                                      />
                                    ) : (
                                      <div className="avatar small">
                                        {initials(p.data.name)}
                                      </div>
                                    )}
                                    <span>
                                      <b>
                                        {p.data.name || "Имя не определено"}
                                      </b>
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
                                    <option value="review">Без группы</option>
                                    <option value="open">Open to Work</option>
                                    <option value="neutral">
                                      Обычный текст
                                    </option>
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
                Результат старой попытки не подтверждён. Сейчас LinkedIn
                разрешает новое приглашение; перед отправкой ещё раз проверим
                профиль и доступность действия.
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
              будет остановлена. Другие аккаунты, включая отдельные сессии того
              же профиля, останутся.
            </p>
            <p className="hint">
              Новые обращения из сохранённой истории не запускаются
              автоматически.
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
                kind="danger"
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
        {modal === "edit-campaign" && campaignEdit && campaign && (
          <Modal
            title={
              campaignEdit.armed ? "Удалить кампанию?" : "Изменить кампанию"
            }
            subtitle={campaign.name}
            error={error}
            onClose={() => setModal(null)}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (campaignEdit.armed) {
                  const done = await act(
                    "campaign.delete",
                    { id: cid, confirm: true },
                    "Кампания удалена.",
                  );
                  if (done) {
                    setModal(null);
                    setCid(null);
                    setDetail(null);
                  }
                  return;
                }
                const saved = await act(
                  "campaign.update",
                  {
                    id: cid,
                    name: campaignEdit.name.trim(),
                    max_profiles: Number(campaignEdit.max_profiles),
                    keywords: campaignEdit.keywords.trim(),
                  },
                  "Изменения сохранены.",
                );
                if (saved) setModal(null);
              }}
            >
              {campaignEdit.armed ? (
                <p className="modal-copy">
                  Кампания «{campaign.name}» и найденные профили будут удалены
                  навсегда. Если по кампании уже были сообщения, приложение
                  предложит перенести её в архив — так люди не получат повторное
                  обращение.
                </p>
              ) : (
                <>
                  <label className="field">
                    Название
                    <input
                      autoFocus
                      required
                      maxLength={150}
                      value={campaignEdit.name}
                      onChange={(e) =>
                        setCampaignEdit({
                          ...campaignEdit,
                          name: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    Сколько профилей найти (до 100)
                    <input
                      type="number"
                      min={1}
                      max={100}
                      required
                      disabled={active}
                      value={campaignEdit.max_profiles}
                      onChange={(e) =>
                        setCampaignEdit({
                          ...campaignEdit,
                          max_profiles: e.target.value,
                        })
                      }
                    />
                  </label>
                  {detail.candidates.length ? (
                    <p className="field-note">
                      Запрос поиска: {campaign.keywords}. После сбора профилей
                      запрос не меняется — для другого поиска создайте новую
                      кампанию.
                    </p>
                  ) : (
                    <label className="field">
                      Запрос поиска
                      <textarea
                        required
                        maxLength={1000}
                        disabled={active}
                        value={campaignEdit.keywords}
                        onChange={(e) =>
                          setCampaignEdit({
                            ...campaignEdit,
                            keywords: e.target.value,
                          })
                        }
                      />
                    </label>
                  )}
                  <div className="edit-campaign-secondary">
                    <Button
                      type="button"
                      disabled={busy || active}
                      onClick={async () => {
                        const done = await act(
                          "campaign.archive",
                          { id: cid },
                          "Кампания перенесена в архив.",
                        );
                        if (done) {
                          setModal(null);
                          setCid(null);
                          setDetail(null);
                        }
                      }}
                    >
                      <Archive size={16} />В архив
                    </Button>
                    <Button
                      type="button"
                      kind="danger-link"
                      disabled={busy || active}
                      onClick={() =>
                        setCampaignEdit({ ...campaignEdit, armed: true })
                      }
                    >
                      <Trash2 size={16} />
                      Удалить кампанию
                    </Button>
                  </div>
                  {active && (
                    <p className="field-note">
                      Пока кампания работает, можно изменить только название.
                      Поставьте её на паузу, чтобы менять поиск или перенести в
                      архив.
                    </p>
                  )}
                </>
              )}
              <div className="modal-footer">
                <Button
                  type="button"
                  onClick={() =>
                    campaignEdit.armed && !campaignEdit.deleteOnly
                      ? setCampaignEdit({ ...campaignEdit, armed: false })
                      : setModal(null)
                  }
                >
                  {campaignEdit.armed && !campaignEdit.deleteOnly
                    ? "Назад"
                    : "Отмена"}
                </Button>
                <Button
                  kind={campaignEdit.armed ? "danger" : "primary"}
                  disabled={busy}
                >
                  {campaignEdit.armed ? "Удалить навсегда" : "Сохранить"}
                </Button>
              </div>
            </form>
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
              // One call: the campaign is created together with the
              // recruiter's time zone, so nothing can fail silently after it.
              const c = await act("campaign.create", {
                ...data,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              });
              if (c) {
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
                <option value="review">Без группы</option>
                <option value="open">Open to Work</option>
                <option value="neutral">Обычный текст</option>
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
                <Button
                  disabled={busy}
                  onClick={() => setSuppressConfirm(false)}
                >
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
            title="Перед запуском"
            subtitle={`${preview.messages.length} ${plural(preview.messages.length, ["получатель", "получателя", "получателей"])} · Отправитель: ${preview.account.label}`}
            wide
            onClose={() => setPreview(null)}
          >
            <div className="hint">{describeOutreach(preview.rules)}</div>
            {approvedPlan && (
              <div className="hint warning">
                Текущий утверждённый план сохранён. Он будет заменён только
                после нажатия «Запустить отправку».
              </div>
            )}
            <div className="message-preview">
              <p>Профиль отправителя: {preview.account.url}</p>
              {preview.rules.allow_inmail && (
                <p>
                  <strong>
                    Максимальный расход InMail: {preview.maximum_credits}{" "}
                    {plural(preview.maximum_credits, [
                      "кредит",
                      "кредита",
                      "кредитов",
                    ])}
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
                  <strong>{preview.context.contract}</strong>. Подпись
                  отправителя включена в текст ниже.
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
                Запустить отправку
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
              приглашений и дальнейшую отправку по текущему плану. Уже
              выполненные действия сохранятся в истории.
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
    </BusyContext.Provider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
