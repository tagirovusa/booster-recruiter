"""Campaign export to Excel and CSV, written in the recruiter's words."""

from __future__ import annotations

import csv
import io
from datetime import datetime

from .store import AppError

GROUPS = {"open": "Open to Work", "neutral": "Обычный текст", "review": "Без группы"}
FRAMES = {
    "open_to_work": "Open to Work",
    "hiring": "Hiring (сам нанимает)",
    "none": "Без рамки",
    "unknown": "Не определена",
}
STATES = {
    "planned": "В плане",
    "check_pending": "В очереди",
    "waiting_acceptance": "Ждём принятия",
    "waiting_credits": "Ожидаем кредиты",
    "waiting_budget": "В очереди",
    "needs_review": "Нужна проверка",
    "sent": "Отправлено",
    "replied": "Ответ получен",
    "excluded": "Исключён",
    "unavailable": "Недоступно",
    "finished": "Завершено",
    "submitting": "Отправляем",
    "unknown": "Неясно, отправлено ли",
    "blocked": "Действие остановлено",
    "satisfied": "Проверено",
    "pending": "В очереди",
    "cancelled": "Отменено",
    "failed": "Ошибка",
}
RELATIONS = {
    "unknown": "Не подтверждена",
    "connected": "В контактах",
    "pending": "Приглашение ожидает принятия",
    "not_connected": "Нет контакта",
    "incoming": "Входящее приглашение",
    "self": "Собственный профиль",
}
CHANNELS = {"invite": "Приглашение", "message": "Сообщение", "inmail": "InMail"}

COLUMNS = [
    "Имя",
    "Профиль",
    "Заголовок",
    "Компания",
    "Местоположение",
    "Группа",
    "Рамка",
    "Проверено",
    "Статус сообщения",
    "Текст сообщения",
    "Комментарий",
    "Состояние контакта",
    "Приглашение отправлено",
    "Последняя проверка",
    "Следующая проверка",
    "Отправитель",
]
HISTORY_COLUMNS = ["Профиль", "Канал", "Результат", "Время", "Тема", "Текст", "Причина"]
SHEETS = ("Кандидаты", "История обращений")

# English interface: the same tables in English, chosen per export.
EN = {
    "groups": {
        "open": "Open to Work",
        "neutral": "Standard text",
        "review": "No group",
    },
    "frames": {
        "open_to_work": "Open to Work",
        "hiring": "Hiring (is hiring)",
        "none": "No frame",
        "unknown": "Not determined",
    },
    "states": {
        "planned": "Planned",
        "check_pending": "Queued",
        "waiting_acceptance": "Waiting for acceptance",
        "waiting_credits": "Waiting for credits",
        "waiting_budget": "Queued",
        "needs_review": "Needs review",
        "sent": "Sent",
        "replied": "Replied",
        "excluded": "Excluded",
        "unavailable": "Unavailable",
        "finished": "Finished",
        "submitting": "Sending",
        "unknown": "Unclear whether sent",
        "blocked": "Action stopped",
        "satisfied": "Checked",
        "pending": "Queued",
        "cancelled": "Cancelled",
        "failed": "Error",
    },
    "relations": {
        "unknown": "Not confirmed",
        "connected": "Connected",
        "pending": "Invitation pending",
        "not_connected": "Not connected",
        "incoming": "Incoming invitation",
        "self": "Own profile",
    },
    "channels": {"invite": "Invitation", "message": "Message", "inmail": "InMail"},
    "columns": [
        "Name",
        "Profile",
        "Headline",
        "Company",
        "Location",
        "Group",
        "Frame",
        "Checked",
        "Message status",
        "Message text",
        "Comment",
        "Contact status",
        "Invitation sent",
        "Last check",
        "Next check",
        "Sender",
    ],
    "history_columns": [
        "Profile",
        "Channel",
        "Result",
        "Time",
        "Subject",
        "Text",
        "Reason",
    ],
    "sheets": ("Candidates", "Outreach history"),
}
RU = {
    "groups": GROUPS,
    "frames": FRAMES,
    "states": STATES,
    "relations": RELATIONS,
    "channels": CHANNELS,
    "columns": COLUMNS,
    "history_columns": HISTORY_COLUMNS,
    "sheets": SHEETS,
}


def wording(language):
    return EN if language == "en" else RU


def label(table, value):
    return table.get(value, value) if value else ""


def local_time(value, language="ru"):
    """ISO timestamp in UTC → local "дд.мм.гггг чч:мм" (US "mm/dd/yyyy h:mm AM"
    in English); anything else unchanged."""
    if not value:
        return ""
    pattern = "%m/%d/%Y %I:%M %p" if language == "en" else "%d.%m.%Y %H:%M"
    try:
        return datetime.fromisoformat(value).astimezone().strftime(pattern)
    except (TypeError, ValueError):
        return value


def candidate_rows(store, data, language="ru"):
    w = wording(language)
    outreach = {}
    for run in reversed(data["outreach"]["runs"]):
        if run["status"] != "preview":
            outreach.update({m["candidate_id"]: m for m in run["members"]})
    sender = store.account(data["campaign"]["account_id"], include_deleted=True)
    for p in data["candidates"]:
        d = p["data"]
        sent = (p["delivery"] or [{}])[0]
        contact = outreach.get(p["id"], {})
        yield [
            d.get("name", ""),
            p["url"],
            d.get("headline", ""),
            d.get("company", ""),
            d.get("location", ""),
            label(w["groups"], p["segment"]),
            label(w["frames"], d.get("photo_frame", {}).get("status", "unknown")),
            local_time(p["observed"], language),
            label(w["states"], contact.get("status") or sent.get("status", "")),
            contact.get("message") or sent.get("message", ""),
            contact.get("detail") or sent.get("detail", ""),
            label(
                w["relations"],
                contact.get("relationship")
                or d.get("contact", {}).get("relationship", "unknown"),
            ),
            local_time(contact.get("invitation_at"), language),
            local_time(contact.get("checked_at"), language),
            local_time(contact.get("next_check"), language),
            sender["label"],
        ]


def history_rows(data, language="ru"):
    w = wording(language)
    for run in data["outreach"]["runs"]:
        members = {m["id"]: m for m in run["members"]}
        for action in run["actions"]:
            member = members[action["member_id"]]
            kind = action["kind"]
            text = {
                "invite": member["invitation"],
                "inmail": member["inmail_message"],
            }.get(kind, member["message"])
            yield [
                action["url"],
                label(w["channels"], kind),
                label(w["states"], action["status"]),
                local_time(action["created"], language),
                member["subject"] if kind == "inmail" else "",
                text,
                action["detail"],
            ]


def inert(value):
    """Keep spreadsheet apps from treating profile text as a formula."""
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else value


def to_csv(rows, language="ru"):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(wording(language)["columns"])
    writer.writerows([inert(c) for c in row] for row in rows)
    return stream.getvalue().encode("utf-8-sig")


def to_xlsx(rows, history, language="ru"):
    w = wording(language)
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    def sheet(ws, columns, rows, freeze, widths):
        ws.append(columns)
        for row in rows:
            ws.append(row)
            for cell in ws[ws.max_row]:
                cell.data_type = "s"
        ws.freeze_panes = freeze
        ws.auto_filter.ref = ws.dimensions
        for cell in ws[1]:
            cell.fill = PatternFill("solid", fgColor="FED700")
            cell.font = Font(bold=True)
        for index, width in enumerate(widths):
            ws.column_dimensions[chr(ord("A") + index)].width = width

    wb = Workbook()
    wb.active.title = w["sheets"][0]
    sheet(
        wb.active,
        w["columns"],
        rows,
        "C2",
        [28 if i != 9 else 70 for i in range(len(COLUMNS))],
    )
    sheet(
        wb.create_sheet(w["sheets"][1]),
        w["history_columns"],
        history,
        "B2",
        [30, 30, 30, 30, 30, 60, 60],
    )
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def export_campaign(store, cid, fmt, language="ru"):
    data = store.detail(cid)
    rows = list(candidate_rows(store, data, language))
    if fmt == "csv":
        return to_csv(rows, language)
    if fmt != "xlsx":
        raise AppError("Поддерживается Excel или CSV.")
    return to_xlsx(rows, list(history_rows(data, language)), language)
