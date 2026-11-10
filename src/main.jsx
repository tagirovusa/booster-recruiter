import React, { useState, useEffect, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutGrid,
  Users,
  Settings,
  X,
  ChevronRight,
  ShieldCheck,
  LoaderCircle,
  Inbox,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import "./style.css";
import { AttentionPanel } from "./Workspace";
import { BusyContext, Button, LoadFailure } from "./ui";
import SettingsPage from "./pages/SettingsPage";
import AccountsPage from "./pages/AccountsPage";
import CampaignsPage from "./pages/CampaignsPage";
import CampaignPage from "./pages/CampaignPage";
import WorkspaceDialogs from "./dialogs";
import { t, tr } from "./i18n";

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
  // After a language switch the window reloads and returns to Settings.
  const [page, setPage] = useState(() => {
    try {
      const back = window.sessionStorage.getItem("booster.returnPage");
      window.sessionStorage.removeItem("booster.returnPage");
      return back === "settings" ? "settings" : "campaigns";
    } catch {
      return "campaigns";
    }
  });
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
        t(
          "Не удалось сохранить черновик на компьютере. Сохраните настройки перед закрытием приложения.",
        ),
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
  // A confirmation that should survive the navigation its own action causes,
  // such as "campaign deleted" shown on the campaign list.
  const noticeAfterNavigation = useRef(null);
  useEffect(() => {
    setError("");
    setNotice(
      noticeAfterNavigation.current
        ? {
            text: noticeAfterNavigation.current,
            revision: noticeScope.current.revision,
          }
        : "",
    );
    noticeAfterNavigation.current = null;
  }, [page, cid, tab]);
  const leaveCampaign = (text) => {
    setModal(null);
    // Already elsewhere (e.g. a notification opened another screen): show it now.
    if (!cid) return notify(text, noticeScope.current.revision);
    noticeAfterNavigation.current = text;
    setCid(null);
    setDetail(null);
  };
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
      setWorkspaceError(t("Откройте Booster Recruiter как приложение."));
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
        t(
          "Проверка запущена. Активный план продолжает работу; план на паузе не возобновляется.",
        ),
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
          t("Профиль открыт в сессии отправителя."),
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
        notify(t("Список сохранён."), notificationRevision);
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
            ? t("Текущий план сохранён без изменений.")
            : t("Настройки и тексты сохранены. Кампания не запущена."),
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
            {t("Подбор")} <span>{t("персонала")}</span>
          </div>
          <nav>
            {[
              [LayoutGrid, "campaigns", t("Кампании")],
              [Inbox, "attention", t("Требует внимания")],
              [Users, "accounts", t("Аккаунты")],
              [Settings, "settings", t("Настройки")],
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
              <b>{t("Ваше рабочее пространство")}</b>
              <small>{t("Данные сохраняются на компьютере")}</small>
            </div>
          </div>
        </aside>
        <main>
          <div className="topbar">
            <span>
              {t("Подбор персонала")} <ChevronRight size={14} />{" "}
              {page === "campaigns"
                ? t("Кампании")
                : page === "attention"
                  ? t("Требует внимания")
                  : page === "accounts"
                    ? t("Аккаунты")
                    : t("Настройки")}{" "}
              {cid && (
                <>
                  <ChevronRight size={14} />
                  {campaign?.name ||
                    state.campaigns.find((c) => c.id === cid)?.name ||
                    t("Кампания")}
                </>
              )}
            </span>
          </div>
          {error && !modal && !person && !preview && !confirmation && (
            <div className="alert error app-alert" role="alert" tabIndex={-1}>
              <AlertCircle size={18} />
              <span>{tr(error)}</span>
              <button
                onClick={() => setError("")}
                aria-label={t("Скрыть ошибку")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && notice.revision === noticeScope.current.revision && (
            <div className="alert success" role="status">
              <CheckCircle2 size={18} />
              <span>{tr(notice.text)}</span>
              <button
                onClick={() => setNotice("")}
                aria-label={t("Скрыть уведомление")}
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
                  {t(
                    "Не удалось обновить данные. Показана последняя загруженная версия.",
                  )}
                </span>
                <Button onClick={retryLoad} disabled={retrying}>
                  {retrying ? t("Обновляем…") : t("Обновить данные")}
                </Button>
              </div>
            )}
          <div className="content">
            {loading ? (
              <div className="empty">
                <LoaderCircle className="spin" />
                <h2>{t("Открываем рабочее пространство…")}</h2>
              </div>
            ) : !workspaceLoaded ? (
              <LoadFailure
                title={t("Не удалось открыть рабочее пространство")}
                text={t(
                  "Не удалось загрузить аккаунты и кампании. Повторите попытку.",
                )}
                detail={workspaceError}
                onRetry={retryLoad}
                retrying={retrying}
              />
            ) : page === "attention" ? (
              <>
                <div className="page-heading">
                  <div>
                    <h1>{t("Требует внимания")}</h1>
                    <p>
                      {t(
                        "Ответы и следующие действия по всем кампаниям. Исправляйте отдельные профили, сохраняя общий план.",
                      )}
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
                      t(
                        "Профиль кандидата открыт в браузере отправителя. Нажмите «Сообщение», чтобы ответить.",
                      ),
                    )
                  }
                  onOpen={(item) => {
                    if (item.kind === "login" || item.needs_sign_in) {
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
                title={t("Не удалось открыть кампанию")}
                text={t(
                  "Данные кампании не загрузились. Повторите попытку или вернитесь к списку.",
                )}
                detail={detailError}
                onRetry={retryLoad}
                retrying={retrying}
                onBack={() => setCid(null)}
              />
            ) : !detail ? (
              <div className="empty">
                <LoaderCircle className="spin" />
                <h2>{t("Открываем кампанию…")}</h2>
              </div>
            ) : (
              <CampaignPage
                ctx={{
                  account,
                  act,
                  active,
                  archived,
                  automationDrafts,
                  busy,
                  campaign,
                  cid,
                  contactMembers,
                  detail,
                  doExport,
                  draftPersisted,
                  eligible,
                  filter,
                  goTo,
                  hasMessageHistory,
                  hasOutreachHistory,
                  liveRun,
                  openInSenderAccount,
                  people,
                  persistDraft,
                  previewing,
                  query,
                  recheckAttention,
                  review,
                  saveAutomation,
                  selectVisible,
                  selected,
                  setCampaignEdit,
                  setCid,
                  setError,
                  setFilter,
                  setInvitationRepair,
                  setModal,
                  setPerson,
                  setQuery,
                  setTab,
                  setTemplateName,
                  tab,
                  workspaceSummary,
                }}
              />
            )}
          </div>
        </main>
        <WorkspaceDialogs
          ctx={{
            act,
            leaveCampaign,
            active,
            approvedPlan,
            archived,
            busy,
            campaign,
            campaignEdit,
            cid,
            confirmation,
            deletingAccount,
            detail,
            eligible,
            error,
            invitationRepair,
            modal,
            openCampaign,
            openInSenderAccount,
            person,
            preview,
            restorePersonFocus,
            review,
            setCampaignEdit,
            setCid,
            setConfirmation,
            setDeletingAccount,
            setDetail,
            setInvitationRepair,
            setModal,
            setPage,
            setPerson,
            setPreview,
            setSuppressConfirm,
            setTemplateName,
            state,
            suppressConfirm,
            templateName,
            workspaceSummary,
          }}
        />
      </div>
    </BusyContext.Provider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
