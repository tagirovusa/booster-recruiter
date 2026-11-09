// The "Ваш план" card beside the setup steps.
import React from "react";
import { t } from "../i18n";
import {
  CheckCircle2,
  Clock3,
  Monitor,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";

export function PlanSummary({ ctx }) {
  const {
    account,
    dirty,
    draftPersisted,
    flow,
    mode,
    onPeople,
    peopleLabel,
    rules,
    selected,
    times,
    zoneNames,
  } = ctx;
  return (
    <aside className="automation-plan">
      <section className="panel plan-card">
        <div className="plan-heading">
          <span className="eyebrow">{t("ВАШ ПЛАН")}</span>
          <span
            role="status"
            className={"save-indicator " + (dirty ? "unsaved" : "")}
          >
            {dirty
              ? draftPersisted
                ? t("Черновик сохранён на этом компьютере")
                : t("Есть несохранённые изменения")
              : t("Сохранено")}
          </span>
        </div>
        <h3>
          {mode === "free"
            ? t("Без InMail")
            : t("С InMail · {how}", {
                how: mode === "fast" ? t("быстрее") : t("экономно"),
              })}
        </h3>
        <div className="plan-account">
          <Users size={16} />
          <div>
            <strong>
              {selected.length} {peopleLabel}
            </strong>
            <button className="text-link" onClick={onPeople}>
              {selected.length ? t("Изменить выбор") : t("Выбрать кандидатов")}
            </button>
          </div>
        </div>
        <details className="plan-sequence">
          <summary>{t("Последовательность действий")}</summary>
          <ol className="plan-flow">
            {flow.map((item, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                <div>
                  <b>{item.title}</b>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </details>
        <div className="plan-meta">
          <p>
            <UserRound size={14} />
            <span>
              {t("Отправитель:")} <b>{account?.label || t("Не выбран")}</b>
            </span>
          </p>
          <p>
            <Clock3 size={14} />
            <span>
              {times(rules.start_hour)}–{times(rules.end_hour)} ·{" "}
              {zoneNames[rules.timezone] || rules.timezone}
            </span>
          </p>
          {rules.allow_inmail && (
            <p>
              <Wallet size={14} />
              <span>
                {t("Кредиты InMail: до")} <b>{selected.length}</b>
              </span>
            </p>
          )}
        </div>
      </section>
      <p className="plan-note">
        <Monitor size={15} />
        <span>
          {t("Оставьте приложение запущенным, а компьютер — включённым.")}
        </span>
      </p>
      <p className="plan-note">
        <CheckCircle2 size={15} />
        <span>
          {t("Обрабатываем только выбранных кандидатов. При ограничении LinkedIn остановимся и сохраним очередь.")}
        </span>
      </p>
    </aside>
  );
}
