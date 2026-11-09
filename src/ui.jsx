// Shared building blocks used by every screen.
import React, { createContext, useContext, useEffect, useRef } from "react";
import { AlertCircle, ArrowLeft, RefreshCw, X } from "lucide-react";
import { labels } from "./labels";
import { plural, locale, t, tr } from "./i18n";

export const fmt = (d) =>
  new Date(d).toLocaleString(locale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export const profileWord = (count) =>
  plural(count, ["профиль", "профиля", "профилей"], ["profile", "profiles"]); // i18n-ignore
export const initials = (name) =>
  (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("");
export function Badge({ value }) {
  return <span className={"badge " + value}>{labels[value] || value}</span>;
}
// While an action runs, dialogs must not close from Escape; otherwise its
// result or error lands out of context.
export const BusyContext = createContext(false);
export function Button({ children, kind = "secondary", ...rest }) {
  return (
    <button className={"button " + kind} {...rest}>
      {children}
    </button>
  );
}
export function Modal({
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
  const busyNow = useRef(false);
  busyNow.current = useContext(BusyContext);
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
        if (!busyNow.current) close.current();
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
          <button className="icon" aria-label={t("Закрыть")} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {error && (
          <div className="alert error" role="alert" tabIndex={-1}>
            <AlertCircle size={18} />
            <span>{tr(error)}</span>
          </div>
        )}
        {form
          ? React.cloneElement(form, { className: "modal-form" }, body)
          : body}
      </section>
    </div>
  );
}

export function LoadFailure({
  title,
  text,
  detail,
  onRetry,
  retrying,
  onBack,
}) {
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
            {t("Все кампании")}
          </Button>
        )}
        <Button kind="primary" disabled={retrying} onClick={onRetry}>
          <RefreshCw size={16} className={retrying ? "spin" : ""} />
          {retrying ? t("Загружаем…") : t("Попробовать ещё раз")}
        </Button>
      </div>
      {detail && (
        <details className="technical-details">
          <summary>{t("Технические подробности")}</summary>
          <pre>{tr(detail)}</pre>
        </details>
      )}
    </section>
  );
}
export function Empty({ icon: Icon, title, text, action }) {
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
export function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
