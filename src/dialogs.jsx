// Every dialog of the workspace: accounts, campaigns, templates, the
// candidate card, the launch preview and plan-change confirmation.
import React from "react";
import { Archive, ExternalLink, Play, Trash2 } from "lucide-react";
import { AccountForm, CampaignForm } from "./forms";
import { frameLabels, zoneNames } from "./labels";
import { describeOutreach } from "./outreach/rules";
import { plural, t, tr, hourLabel } from "./i18n";
import { Badge, Button, Modal } from "./ui";
import { TemplatePicker } from "./Workspace";

export default function WorkspaceDialogs({ ctx }) {
  const {
    act,
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
    leaveCampaign,
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
  } = ctx;
  return (
    <>
      {modal === "retry-invitation" && invitationRepair && (
        <Modal
          title={t("Отправить приглашение?")}
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
                <dt>{t("Получатель")}</dt>
                <dd>{invitationRepair.name}</dd>
                <dd>{invitationRepair.url}</dd>
              </div>
              <div>
                <dt>{t("Отправитель")}</dt>
                <dd>
                  {invitationRepair.account_label ||
                    state.accounts.find(
                      (a) => a.id === invitationRepair.account_id,
                    )?.label}
                </dd>
              </div>
            </dl>
            <div>
              <h3>{t("Текст приглашения")}</h3>
              <pre>{invitationRepair.note || t("Приглашение без заметки")}</pre>
            </div>
            <p>
              {t(
                "Результат старой попытки не подтверждён. Сейчас LinkedIn разрешает новое приглашение; перед отправкой ещё раз проверим профиль и доступность действия.",
              )}
            </p>
            <p className="hint">
              {t(
                "Запрос касается только этого получателя. После подтверждения LinkedIn его статус обновится в той же кампании. Остальные получатели сохранят свой план.",
              )}
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
              {t("Отмена")}
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
                  t(
                    "Запрос принят. Результат приглашения появится здесь и в кампании.",
                  ),
                );
                if (result) {
                  setModal(null);
                  setInvitationRepair(null);
                }
              }}
            >
              {busy ? t("Запускаем…") : t("Подтвердить приглашение")}
            </Button>
          </div>
        </Modal>
      )}
      {modal === "delete-account" && deletingAccount && (
        <Modal
          title={t("Удалить аккаунт из приложения?")}
          subtitle={deletingAccount.label}
          error={error}
          onClose={() => {
            setModal(null);
            setDeletingAccount(null);
          }}
        >
          <p>
            {t(
              "Аккаунт исчезнет из списка, его сохранённая сессия LinkedIn будет удалена с этого компьютера. Сам профиль LinkedIn сохранится.",
            )}
          </p>
          <p>
            {t("Связанных кампаний:")}{" "}
            <strong>
              {deletingAccount.campaign_count ??
                deletingAccount.campaigns?.length ??
                0}
            </strong>
            .{" "}
            {t(
              "Кампании перейдут в «Архив», их история сохранится, а обработка будет остановлена. Другие аккаунты, включая отдельные сессии того же профиля, останутся.",
            )}
          </p>
          <p className="hint">
            {t(
              "Новые обращения из сохранённой истории не запускаются автоматически.",
            )}
          </p>
          <div className="modal-footer">
            <Button
              disabled={busy}
              onClick={() => {
                setModal(null);
                setDeletingAccount(null);
              }}
            >
              {t("Отмена")}
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
              {t("Удалить аккаунт и сессию")}
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
          title={t("Кампания из шаблона")}
          subtitle={t("Начните новую кампанию с сохранёнными настройками.")}
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
            campaignEdit.armed ? t("Удалить кампанию?") : t("Изменить кампанию")
          }
          subtitle={campaign.name}
          error={error}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (campaignEdit.armed) {
                const done = await act("campaign.delete", {
                  id: cid,
                  confirm: true,
                });
                if (done) leaveCampaign(t("Кампания удалена."));
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
                t("Изменения сохранены."),
              );
              if (saved) setModal(null);
            }}
          >
            {campaignEdit.armed ? (
              <p className="modal-copy">
                {t(
                  "Кампания «{name}» и найденные профили будут удалены навсегда. Если по кампании уже были сообщения, приложение предложит перенести её в архив — так люди не получат повторное обращение.",
                  { name: campaign.name },
                )}
              </p>
            ) : (
              <>
                <label className="field">
                  {t("Название")}
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
                  {t("Сколько профилей найти (до 100)")}
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
                    {t("Запрос поиска:")} {campaign.keywords}.{" "}
                    {t(
                      "После сбора профилей запрос не меняется — для другого поиска создайте новую кампанию.",
                    )}
                  </p>
                ) : (
                  <label className="field">
                    {t("Запрос поиска")}
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
                      const done = await act("campaign.archive", { id: cid });
                      if (done) leaveCampaign(t("Кампания перенесена в архив."));
                    }}
                  >
                    <Archive size={16} />
                    {t("В архив")}
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
                    {t("Удалить кампанию")}
                  </Button>
                </div>
                {active && (
                  <p className="field-note">
                    {t(
                      "Пока кампания работает, можно изменить только название. Поставьте её на паузу, чтобы менять поиск или перенести в архив.",
                    )}
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
                  ? t("Назад")
                  : t("Отмена")}
              </Button>
              <Button
                kind={campaignEdit.armed ? "danger" : "primary"}
                disabled={busy}
              >
                {campaignEdit.armed ? t("Удалить навсегда") : t("Сохранить")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {modal === "save-template" && (
        <Modal
          title={t("Сохранить шаблон")}
          subtitle={t(
            "Сохраняются настройки кампании. Сначала сохраните изменения в автоматизации. Кандидаты и разрешение на отправку не переносятся.",
          )}
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
              {t("Название шаблона")}
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
                {t("Отмена")}
              </Button>
              <Button kind="primary" disabled={busy || !templateName.trim()}>
                {t("Сохранить шаблон")}
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
          title={person.data.name || t("Профиль кандидата")}
          subtitle={t("Проверка исходных сведений")}
          initialFocus={restorePersonFocus.current ? "select" : undefined}
          onClose={() => setPerson(null)}
          wide
        >
          <div className="profile-review">
            {person.data.photo && (
              <img
                className="profile-photo"
                src={"data:image/png;base64," + person.data.photo}
                alt={t("Фото для проверки рамки")}
              />
            )}
            <div>
              <Badge value={person.segment} />
              <h3>{person.data.headline || t("Заголовок не определён")}</h3>
              <p>
                {t("Рамка:")}{" "}
                {frameLabels[person.data.photo_frame?.status] ||
                  t("Не определена")}
                .{" "}
                {t(
                  "Отсутствие подтверждения не означает, что человек не ищет работу.",
                )}
              </p>
              {archived && (
                <p className="hint">
                  {t("Архивная запись. Ссылка откроется в обычном браузере.")}
                </p>
              )}
              <Button onClick={() => openInSenderAccount(person.url)}>
                <ExternalLink size={16} />
                {t("Открыть LinkedIn")}
              </Button>
            </div>
          </div>
          <h3>{t("Сведения, полученные из профиля")}</h3>
          <pre className="profile-text">
            {person.data.sections?.main_profile ||
              person.data.top_card_text ||
              t("Текст недоступен")}
          </pre>
          <label className="field">
            {t("Группа сообщения")}
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
              <option value="review">{t("Без группы")}</option>
              <option value="open">Open to Work</option>
              <option value="neutral">{t("Обычный текст")}</option>
            </select>
            <small>
              {archived
                ? t("Архивная запись доступна только для просмотра.")
                : person.segment === "review"
                  ? t(
                      "Проверьте сведения и выберите группу. Затем профиль можно будет включить в кампанию.",
                    )
                  : !eligible(person)
                    ? tr(person.outreach_exclusion)
                    : person.selected
                      ? t("Группа сохранена. Профиль выбран для этой кампании.")
                      : t(
                          "Группа сохранена. Выберите профиль в списке кандидатов, чтобы включить его в кампанию.",
                        )}
            </small>
          </label>
          {(suppressConfirm || person.blocked) && (
            <div className="hint warning">
              {person.blocked
                ? t(
                    "Этот профиль исключён из будущих обращений во всех кампаниях и со всех аккаунтов.",
                  )
                : t(
                    "Исключить этот профиль из будущих обращений во всех кампаниях и со всех аккаунтов? Уже отправленные сообщения и приглашения останутся в LinkedIn.",
                  )}
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
                  { url: person.url, reason: "Исключён рекрутером" }, // i18n-ignore: stored reason
                  t("Профиль исключён из будущих обращений во всех кампаниях."),
                );
                if (result) setPerson(null);
              }}
              disabled={archived || busy || person.blocked}
            >
              {person.blocked
                ? t("Контакт исключён")
                : suppressConfirm
                  ? t("Исключить во всех кампаниях")
                  : t("Не контактировать")}
            </Button>
            {suppressConfirm ? (
              <Button disabled={busy} onClick={() => setSuppressConfirm(false)}>
                {t("Отмена")}
              </Button>
            ) : (
              <Button onClick={() => setPerson(null)}>{t("Закрыть")}</Button>
            )}
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          error={error}
          title={t("Перед запуском")}
          subtitle={`${preview.messages.length} ${plural(preview.messages.length, ["получатель", "получателя", "получателей"], ["recipient", "recipients"])} · ${t("Отправитель:")} ${preview.account.label}`}
          wide
          onClose={() => setPreview(null)}
        >
          <div className="hint">{describeOutreach(preview.rules)}</div>
          {approvedPlan && (
            <div className="hint warning">
              {t(
                "Текущий утверждённый план сохранён. Он будет заменён только после нажатия «Запустить отправку».",
              )}
            </div>
          )}
          <div className="message-preview">
            <p className="preview-fact">
              {t("Профиль отправителя:")} {preview.account.url}
            </p>
            {preview.rules.allow_inmail && (
              <p>
                <strong>
                  {t("Максимальный расход InMail:")} {preview.maximum_credits}{" "}
                  {plural(
                    preview.maximum_credits,
                    ["кредит", "кредита", "кредитов"],
                    ["credit", "credits"],
                  )}
                  .
                </strong>{" "}
                {t(
                  "Только для этих получателей, если бесплатная связь недоступна. Используем доступные кредиты подписки; дополнительные не покупаем.",
                )}
              </p>
            )}
            {preview.context?.contract && (
              <p>
                {t("InMail через Recruiter:")}{" "}
                <strong>{preview.context.contract}</strong>.{" "}
                {t("Подпись отправителя включена в текст ниже.")}
              </p>
            )}
            <details className="preview-schedule">
              <summary>{t("Расписание и проверки")}</summary>
              <p>
                {t(
                  "Работа: {start}–{end} ({zone}). Проверка каждые {check} ч. · Наблюдение {days} дней.",
                  {
                    start: hourLabel(preview.rules.start_hour),
                    end: hourLabel(preview.rules.end_hour),
                    zone:
                      zoneNames[preview.rules.timezone] ||
                      preview.rules.timezone,
                    check: preview.rules.check_hours,
                    days: preview.rules.monitor_days,
                  },
                )}
                {preview.rules.allow_inmail &&
                  preview.rules.allow_invites &&
                  preview.rules.strategy === "economy" &&
                  " " +
                    t("Переход к InMail через {days} дней ожидания.", {
                      days: preview.rules.wait_days,
                    })}
              </p>
            </details>
            <p className="preview-fact">
              {t(
                "Обрабатываем только выбранных получателей. При ограничении LinkedIn остановимся и сохраним очередь.",
              )}
            </p>
            {preview.messages.map((m) => (
              <article key={m.id}>
                <h3>{m.name || m.url}</h3>
                <p>{m.url}</p>
                <pre>{m.message}</pre>
                {preview.rules.allow_invites && (
                  <>
                    <b className="preview-label">
                      {t("Если потребуется приглашение")}
                    </b>
                    <pre>{m.invitation || t("Без заметки")}</pre>
                  </>
                )}
                {preview.rules.allow_inmail && (
                  <>
                    <b className="preview-label">InMail · {m.subject}</b>
                    <pre>{m.inmail_message}</pre>
                  </>
                )}
              </article>
            ))}
          </div>
          {preview.skipped.length > 0 && (
            <p className="muted">
              {t("Исключено повторных или запрещённых контактов:")}{" "}
              {preview.skipped.length}.
            </p>
          )}
          <div className="modal-footer">
            <Button onClick={() => setPreview(null)}>
              {t("Вернуться к настройкам")}
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
              {t("Запустить отправку")}
            </Button>
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          title={t("Изменить утверждённую кампанию?")}
          subtitle={t("Текущий план будет остановлен")}
          onClose={() => {
            confirmation.resolve(false);
            setConfirmation(null);
          }}
        >
          <p>
            {t(
              "Изменение списка, правил или текстов остановит проверки принятия приглашений и дальнейшую отправку по текущему плану. Уже выполненные действия сохранятся в истории.",
            )}
          </p>
          <p className="confirmation-next">
            {t(
              "После изменений проверьте новый план и утвердите запуск в разделе «Автоматизация».",
            )}
          </p>
          <div className="modal-footer">
            <Button
              onClick={() => {
                confirmation.resolve(false);
                setConfirmation(null);
              }}
            >
              {t("Оставить текущий план")}
            </Button>
            <Button
              kind="primary"
              onClick={() => {
                confirmation.resolve(true);
                setConfirmation(null);
              }}
            >
              {t("Изменить план")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
