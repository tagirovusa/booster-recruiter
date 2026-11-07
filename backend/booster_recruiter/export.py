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
    "needs_review": "Требует внимания",
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


def label(table, value):
    return table.get(value, value) if value else ""


def local_time(value):
    """ISO timestamp in UTC → local "дд.мм.гггг чч:мм"; anything else unchanged."""
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value).astimezone().strftime("%d.%m.%Y %H:%M")
    except (TypeError, ValueError):
        return value


def candidate_rows(store, data):
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
            label(GROUPS, p["segment"]),
            label(FRAMES, d.get("photo_frame", {}).get("status", "unknown")),
            local_time(p["observed"]),
            label(STATES, contact.get("status") or sent.get("status", "")),
            contact.get("message") or sent.get("message", ""),
            contact.get("detail") or sent.get("detail", ""),
            label(
                RELATIONS,
                contact.get("relationship")
                or d.get("contact", {}).get("relationship", "unknown"),
            ),
            local_time(contact.get("invitation_at")),
            local_time(contact.get("checked_at")),
            local_time(contact.get("next_check")),
            sender["label"],
        ]


def history_rows(data):
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
                label(CHANNELS, kind),
                label(STATES, action["status"]),
                local_time(action["created"]),
                member["subject"] if kind == "inmail" else "",
                text,
                action["detail"],
            ]


def inert(value):
    """Keep spreadsheet apps from treating profile text as a formula."""
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else value


def to_csv(rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(COLUMNS)
    writer.writerows([inert(c) for c in row] for row in rows)
    return stream.getvalue().encode("utf-8-sig")


def to_xlsx(rows, history):
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
    wb.active.title = "Кандидаты"
    sheet(
        wb.active,
        COLUMNS,
        rows,
        "C2",
        [28 if i != 9 else 70 for i in range(len(COLUMNS))],
    )
    sheet(
        wb.create_sheet("История обращений"),
        HISTORY_COLUMNS,
        history,
        "B2",
        [30, 30, 30, 30, 30, 60, 60],
    )
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def export_campaign(store, cid, fmt):
    data = store.detail(cid)
    rows = list(candidate_rows(store, data))
    if fmt == "csv":
        return to_csv(rows)
    if fmt != "xlsx":
        raise AppError("Поддерживается Excel или CSV.")
    return to_xlsx(rows, list(history_rows(data)))
