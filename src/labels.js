// Every status word the recruiter sees, in one place.
import { t } from "./i18n";

export const frameLabels = {
  open_to_work: "Open to Work",
  hiring: t("Hiring (сам нанимает)"),
  none: t("Без рамки"),
  unknown: t("Не определена"),
};
export const labels = {
  new: t("Не подключён"),
  ready: t("Готово"),
  needs_login: t("Требуется вход"),
  connecting: t("Ждём входа"),
  identity_mismatch: t("Вошли в другой профиль"),
  restricted: t("Ограничение LinkedIn"),
  disconnected: t("Отключён"),
  deleted: t("Удалён"),
  archived: t("В архиве"),
  satisfied: t("Проверено"),
  draft: t("Черновик"),
  collecting: t("Ищем кандидатов"),
  sending: t("Идёт отправка"),
  paused: t("На паузе"),
  open: "Open to Work",
  neutral: t("Обычный текст"),
  review: t("Без группы"),
  sent: t("Отправлено"),
  unknown: t("Неясно, отправлено ли"),
  blocked: t("Сообщение недоступно"),
  cancelled: t("Отменено"),
  pending: t("В очереди"),
  replied: t("Ответ получен"),
  failed: t("Ошибка"),
  waiting: t("По расписанию"),
  automating: t("Идёт отправка"),
  checking: t("Обновляем статусы"),
};
export const personStates = {
  planned: t("В плане"),
  check_pending: t("В очереди"),
  waiting_acceptance: t("Ждём принятия"),
  waiting_credits: t("Ожидаем кредиты"),
  waiting_budget: t("В очереди"),
  needs_review: t("Нужна проверка"),
  sent: t("Отправлено"),
  replied: t("Ответ получен"),
  excluded: t("Исключён"),
  unavailable: t("Недоступно"),
  finished: t("Завершено"),
  preview: t("Черновик плана"),
  active: t("Работает по расписанию"),
  paused: t("На паузе"),
  completed: t("Завершено"),
  cancelled: t("Отменено"),
  submitting: t("Отправляем…"),
  unknown: t("Неясно, отправлено ли"),
  blocked: t("Действие остановлено"),
  satisfied: t("Проверено"),
};
export const relations = {
  unknown: t("Связь ещё не подтверждена"),
  connected: t("В контактах · 1-й уровень"),
  pending: t("Приглашение ожидает принятия"),
  not_connected: t("Нет контакта"),
  incoming: t("Входящее приглашение"),
  self: t("Собственный профиль"),
};
export const actionKinds = {
  invite: t("Приглашение"),
  message: t("Обычное сообщение"),
  inmail: "InMail",
};

export const attentionKinds = {
  reply: t("Новые ответы"),
  review: t("Нужно проверить"),
  login: t("Нужен вход"),
};

export const zoneNames = {
  "America/Chicago": t("Чикаго"),
  "America/New_York": t("Нью-Йорк"),
  "America/Los_Angeles": t("Лос-Анджелес"),
  "Europe/Kyiv": t("Киев"),
  "Europe/Warsaw": t("Варшава"),
  "Asia/Tbilisi": t("Тбилиси"),
  UTC: "UTC",
};
