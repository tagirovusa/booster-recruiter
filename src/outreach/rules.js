// Pure outreach rules: template checks, plan descriptions and next-step
// guidance. No React; shared by the UI and its tests.

export const TEMPLATE_FIELDS = new Set([
  "name",
  "first_name",
  "headline",
  "company",
]);
export const characterCount = (value) => [...value].length;
export const retiredQuotaFields = new Set([
  "daily_invites",
  "daily_messages",
  "daily_inmails",
  "inmail_budget",
]);
export const currentRules = (rules) =>
  Object.fromEntries(
    Object.entries(rules).filter(([key]) => !retiredQuotaFields.has(key)),
  );
export function draftMatchesRules(snapshot, rules) {
  try {
    const fingerprint = (value) =>
      JSON.stringify(
        Object.entries(currentRules(value)).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    return fingerprint(JSON.parse(snapshot)) === fingerprint(rules);
  } catch {
    return false;
  }
}

// This catches editing mistakes early. The backend still validates every exact
// recipient text, including the current Recruiter signature, before approval.
export function validateTemplate(
  template,
  recipients,
  { limit = 1900, required = false, singleLine = false } = {},
) {
  const source = String(template || "");
  const result = {
    count: characterCount(source),
    rendered: false,
    error: "",
  };
  const fail = (error) => ({ ...result, error });
  if (characterCount(source) > 4000)
    return fail("В шаблоне допустимо не больше 4000 символов.");
  if (!source.trim())
    return required && recipients.length
      ? fail("Заполните это поле для выбранных кандидатов.")
      : { ...result, count: 0 };
  const parts = [];
  let literal = "";
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if ((char === "{" || char === "}") && source[index + 1] === char) {
      literal += char;
      index++;
    } else if (char === "{") {
      parts.push({ literal });
      literal = "";
      const end = source.indexOf("}", index + 1);
      if (end < 0)
        return fail("Закройте фигурную скобку в переменной шаблона.");
      const field = source.slice(index + 1, end).replace(/:$/, "");
      if (!TEMPLATE_FIELDS.has(field))
        return fail(
          "Используйте только {first_name}, {name}, {headline} или {company}. Для обычных скобок напишите {{ и }}.",
        );
      parts.push({ field });
      index = end;
    } else if (char === "}") {
      return fail(
        "Проверьте фигурные скобки в шаблоне: у закрывающей нет пары.",
      );
    } else literal += char;
  }
  parts.push({ literal });
  const evaluate = (values) =>
    parts
      .map((part) => (part.field ? values[part.field] : part.literal))
      .join("");
  const texts = [];
  for (const recipient of recipients) {
    const person = recipient.data || recipient;
    const values = Object.fromEntries(
      [...TEMPLATE_FIELDS].map((key) => [
        key,
        String(person[key] || "").trim(),
      ]),
    );
    values.first_name = values.name.split(" ")[0];
    const missing = parts.find((part) => part.field && !values[part.field]);
    if (missing)
      return fail(
        `У «${person.name || recipient.url || "кандидата"}» нет значения {${missing.field}}. Измените текст или выбор кандидатов.`,
      );
    texts.push(evaluate(values).trim());
  }
  // Without recipients the counter describes the template, not an invented
  // rendered name. Literal-only templates can already be checked in full.
  if (!recipients.length && !parts.some((part) => part.field))
    texts.push(evaluate({}).trim());
  if (texts.length) {
    result.rendered = recipients.length > 0;
    result.count = Math.max(...texts.map(characterCount));
    for (const text of texts) {
      if (!text || characterCount(text) > 1900)
        return fail(
          `После подстановки данных допустимо от 1 до ${limit} символов.`,
        );
      const normalized = text.replace(/\r\n?/g, "\n");
      if (characterCount(normalized) > limit)
        return fail(
          `После подстановки данных должно быть не больше ${limit} символов.`,
        );
      if (singleLine && normalized.includes("\n"))
        return fail("Тема InMail должна быть одной строкой.");
      if (/\[(?:link|ссылка)\]/i.test(text))
        return fail("Замените [link] или [ссылка] настоящей ссылкой.");
      if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f]/.test(text))
        return fail("Удалите служебные символы из текста, например табуляцию.");
    }
    if (limit < 1900)
      result.count = Math.max(
        ...texts.map((text) => characterCount(text.replace(/\r\n?/g, "\n"))),
      );
  }
  return result;
}

export function describeOutreach(rules) {
  const steps = ["Сначала — доступное бесплатное сообщение."];
  if (rules.allow_inmail)
    steps.push(
      "Если LinkedIn предлагает InMail без списания кредита, его можно отправить без ожидания.",
    );
  if (rules.allow_inmail && rules.strategy === "fast") {
    steps.push(
      "Платный InMail — без ожидания приглашения, если есть кредиты подписки.",
    );
    if (rules.allow_invites)
      steps.push(
        "Если InMail недоступен в LinkedIn или кредитов нет, используем доступное приглашение; после принятия — сообщение.",
      );
  } else if (rules.allow_invites) {
    steps.push(
      "Если бесплатно написать нельзя, отправим доступное приглашение; после принятия — сообщение.",
    );
    if (rules.allow_inmail)
      steps.push(
        `Если приглашение не примут за ${rules.wait_days} дн., проверим возможность InMail. Если пригласить нельзя, InMail возможен без ожидания.`,
      );
  } else if (rules.allow_inmail) {
    steps.push(
      "Приглашения выключены: если бесплатная связь недоступна, используем доступный InMail.",
    );
  } else {
    steps.push(
      "Приглашения и InMail выключены: если бесплатное сообщение недоступно, отправки не будет.",
    );
  }
  steps.push("После ответа кандидата автоматические обращения прекратятся.");
  return steps.join(" ");
}

export function outreachCounts(run) {
  if (!run) return null;
  const confirmed = new Set(
    run.actions
      .filter(
        (action) =>
          action.status === "sent" &&
          ["message", "inmail"].includes(action.kind),
      )
      .map((action) => action.member_id),
  );
  return {
    waiting: run.members.filter(
      (member) => member.status === "waiting_acceptance",
    ).length,
    // Confirmation is stored before the member timestamp is updated. Count
    // each recipient once, including those who have subsequently replied.
    sent: run.members.filter(
      (member) => member.sent_at || confirmed.has(member.id),
    ).length,
    replied: run.members.filter((member) => member.status === "replied").length,
  };
}

export function campaignNextEvent(run, account, at = Date.now()) {
  if (!run) return null;
  if (account?.status !== "ready")
    return {
      kind: "account",
      title:
        account?.status === "restricted"
          ? "Действия аккаунта ограничены"
          : "Требуется подключение аккаунта",
      text: "Откройте «Аккаунты» и войдите заново. Очередь сохранена.",
    };
  if (
    run.status === "paused" &&
    (run.actions || []).some((a) => a.status === "submitting")
  )
    return {
      kind: "busy",
      title: "Завершаем текущее действие",
      text: "Подождите немного — после этого кампания встанет на паузу. Повторять ничего не нужно.",
    };
  const uncertain = (run.actions || []).some(
    (a) => a.status === "unknown" && !a.repair_replaced_by,
  );
  const members = run.members || [];
  const otherRecipients = members.filter((m) =>
    [
      "planned",
      "waiting_acceptance",
      "waiting_credits",
      "check_pending",
      "sent",
    ].includes(m.status),
  ).length;
  if (run.status === "paused" && uncertain && otherRecipients > 0)
    return {
      kind: "paused",
      title: "Кампания на паузе",
      text: `Можно продолжить для остальных получателей (${otherRecipients}). Тем, по кому результат неясен, повторно писать не будем.`,
    };
  if (run.status === "paused")
    return {
      kind: uncertain ? "review" : "paused",
      title: uncertain ? "Проверьте результат в LinkedIn" : "Кампания на паузе",
      text: uncertain
        ? "Отметьте в истории, дошло ли сообщение. Повторно писать не будем."
        : "Нажмите «Продолжить», когда будете готовы.",
    };
  const waiting = members.filter(
    (m) => m.status === "waiting_acceptance",
  ).length;
  const pending = members.filter((m) =>
    [
      "planned",
      "waiting_acceptance",
      "waiting_credits",
      "check_pending",
      "sent",
    ].includes(m.status),
  );
  const next = pending
    .map((m) => Date.parse(m.next_check))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0];
  const parked = members.filter((m) => m.status === "needs_review").length;
  const zone = run.rules?.timezone || "UTC";
  const schedule =
    next === undefined
      ? ""
      : next <= at
        ? "Проверим в ближайшие рабочие часы."
        : `Следующая проверка — не раньше ${new Intl.DateTimeFormat("ru-RU", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(next)} (${zone}).`;
  return {
    kind: "scheduled",
    title: waiting
      ? `Ожидаем принятия приглашений: ${waiting}`
      : pending.length
        ? "План выполняется по расписанию"
        : "Текущие действия завершены",
    text: [
      waiting
        ? "Когда приглашение примут, отправим ваше сообщение."
        : pending.length
          ? "Пишем кандидатам и следим за ответами."
          : "Результаты и ответы доступны в истории.",
      schedule,
      parked ? `Требуют внимания: ${parked}. Остальным пишем по плану.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
