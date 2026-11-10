// English catalog for outreach setup, the live plan and contact history.
export const strings = {
  // rules.js — template checks
  "В шаблоне допустимо не больше 4000 символов.":
    "A template can be at most 4,000 characters.",
  "Заполните это поле для выбранных кандидатов.":
    "Fill in this field for the selected candidates.",
  "Закройте фигурную скобку в переменной шаблона.":
    "Close the curly brace in the template variable.",
  "Используйте только {first_name}, {name}, {headline} или {company}. Для обычных скобок напишите {{ и }}.":
    "Use only {first_name}, {name}, {headline} or {company}. For literal braces, type {{ and }}.",
  "Проверьте фигурные скобки в шаблоне: у закрывающей нет пары.":
    "Check the curly braces in the template: a closing brace has no match.",
  "У «{who}» нет значения {{field}}. Измените текст или выбор кандидатов.":
    "“{who}” has no value for {{field}}. Change the text or the candidate selection.",
  кандидата: "candidate",
  "После подстановки данных допустимо от 1 до {limit} символов.":
    "After filling in the data, the text must be 1 to {limit} characters.",
  "После подстановки данных должно быть не больше {limit} символов.":
    "After filling in the data, the text must be at most {limit} characters.",
  "Тема InMail должна быть одной строкой.":
    "The InMail subject must be a single line.",
  "Замените [link] или [ссылка] настоящей ссылкой.":
    "Replace [link] with a real link.",
  "Удалите служебные символы из текста, например табуляцию.":
    "Remove control characters such as tabs from the text.",
  // rules.js — plan description
  "Сначала — доступное бесплатное сообщение.":
    "First, a free message when available.",
  "Если LinkedIn предлагает InMail без списания кредита, его можно отправить без ожидания.":
    "If LinkedIn offers an InMail that uses no credit, it can be sent right away.",
  "Платный InMail — без ожидания приглашения, если есть кредиты подписки.":
    "Paid InMail is sent without waiting for an invitation if subscription credits are available.",
  "Если InMail недоступен в LinkedIn или кредитов нет, используем доступное приглашение; после принятия — сообщение.":
    "If InMail isn't available on LinkedIn or there are no credits, we send an invitation; once accepted, a message.",
  "Если бесплатно написать нельзя, отправим доступное приглашение; после принятия — сообщение.":
    "If a free message isn't possible, we send an invitation; once accepted, a message.",
  "Если приглашение не примут за {days} дн., проверим возможность InMail. Если пригласить нельзя, InMail возможен без ожидания.":
    "If the invitation isn't accepted within {days} days, we check whether InMail is possible. If an invitation can't be sent, InMail may go out right away.",
  "Приглашения выключены: если бесплатная связь недоступна, используем доступный InMail.":
    "Invitations are off: if free contact isn't available, we use InMail when available.",
  "Приглашения и InMail выключены: если бесплатное сообщение недоступно, отправки не будет.":
    "Invitations and InMail are off: if a free message isn't available, nothing is sent.",
  "После ответа кандидата автоматические обращения прекратятся.":
    "Once the candidate replies, automatic outreach stops.",
  // rules.js — next event
  "Действия аккаунта ограничены": "Account actions are restricted",
  "Требуется подключение аккаунта": "Account needs to be connected",
  "Откройте «Аккаунты» и войдите заново. Очередь сохранена.":
    "Open “Accounts” and sign in again. The queue is saved.",
  "Завершаем текущее действие": "Finishing the current action",
  "Подождите немного — после этого кампания встанет на паузу. Повторять ничего не нужно.":
    "Please wait — the campaign will pause after that. No need to repeat anything.",
  "Кампания на паузе": "Campaign paused",
  "Можно продолжить для остальных получателей ({count}). Тем, по кому результат неясен, повторно писать не будем.":
    "You can continue for the remaining recipients ({count}). Recipients with an unclear result won't be contacted again.",
  "Проверьте результат в LinkedIn": "Check the result on LinkedIn",
  "Отметьте в истории, дошло ли сообщение. Повторно писать не будем.":
    "Mark in the history whether the message was delivered. We won't write again.",
  "Нажмите «Продолжить», когда будете готовы.":
    "Click “Resume” when you're ready.",
  "Проверим в ближайшие рабочие часы.":
    "We'll check during the next working hours.",
  "Следующая проверка — не раньше {when} ({zone}).":
    "Next check: no earlier than {when} ({zone}).",
  "Ожидаем принятия приглашений: {count}":
    "Waiting for invitations to be accepted: {count}",
  "План выполняется по расписанию": "Plan is running on schedule",
  "Текущие действия завершены": "Current actions are complete",
  "Когда приглашение примут, отправим ваше сообщение.":
    "Once the invitation is accepted, we'll send your message.",
  "Пишем кандидатам и следим за ответами.":
    "Messaging candidates and watching for replies.",
  "Результаты и ответы доступны в истории.":
    "Results and replies are in the history.",
  "Требуют внимания: {count}. Остальным пишем по плану.":
    "Need attention: {count}. Everyone else is contacted as planned.",

  // parts.jsx
  "{count} / {limit} символов": "{count} / {limit} characters",
  " · максимум после подстановки": " · max after filling in data",
  " · в шаблоне": " · in template",
  "План остановлен; дальнейшие действия не выполняются.":
    "Plan stopped; no further actions will be taken.",
  " LinkedIn сообщил, что профиль уже в контактах. Новое приглашение не требуется.":
    " LinkedIn reported that this profile is already a connection. No new invitation is needed.",
  "Подробности прошлого действия": "Details of the previous action",
  "LinkedIn сообщил, что вы уже в контактах. Приглашение не требуется. Нажмите «Уточнить статус», чтобы обновить состояние без отправки.":
    "LinkedIn reported that you're already connected. No invitation is needed. Click “Refresh status” to update the state without sending anything.",
  "Проверьте приглашение в профиле LinkedIn.":
    "Check the invitation on the LinkedIn profile.",
  "Проверьте переписку в LinkedIn.": "Check the conversation on LinkedIn.",
  "Проверьте профиль и переписку в LinkedIn.":
    "Check the profile and the conversation on LinkedIn.",
  "Отправка приглашения подтверждена в LinkedIn.":
    "LinkedIn confirmed the invitation was sent.",
  "Отправка сообщения подтверждена в LinkedIn.":
    "LinkedIn confirmed the message was sent.",
  "Получен ответ кандидата. Автоматические обращения прекращены.":
    "The candidate replied. Automatic outreach has stopped.",
  "Результат отправки не подтверждён. {check} Не повторяйте отправку до проверки, чтобы избежать дубликата.":
    "Delivery isn't confirmed. {check} Don't resend until you've checked, to avoid a duplicate.",
  "Результат требует ручной проверки. {check} Не повторяйте действие до проверки.":
    "The result needs a manual check. {check} Don't repeat the action until you've checked.",
  "Действие остановлено. {check} Перед новой попыткой изучите технические подробности ниже.":
    "Action stopped. {check} Review the technical details below before trying again.",
  "Действие сейчас недоступно. {check} Технические подробности сохранены ниже.":
    "This action isn't available right now. {check} Technical details are saved below.",
  "Действие выполняется. Дождитесь результата и не запускайте его повторно.":
    "The action is in progress. Wait for the result and don't start it again.",
  "Приглашение ожидает принятия. Его состояние можно проверить в LinkedIn.":
    "The invitation is awaiting acceptance. You can check its status on LinkedIn.",
  "Для продолжения проверьте доступные InMail-кредиты аккаунта.":
    "To continue, check the account's available InMail credits.",
  "Проверьте сохранённую причину остановки перед продолжением кампании.":
    "Review the saved reason for stopping before resuming the campaign.",
  "Кандидат исключён из этого плана. Подробности сохранены ниже.":
    "The candidate was excluded from this plan. Details are saved below.",
  "Наблюдение за кандидатом завершено. Подробности сохранены ниже.":
    "Tracking of this candidate has ended. Details are saved below.",
  "План остановлен. Подробности сохранены ниже.":
    "Plan stopped. Details are saved below.",
  "План приостановлен. Проверьте подробности перед возобновлением.":
    "Plan paused. Review the details before resuming.",
  "{check} Подробности сохранены ниже.": "{check} Details are saved below.",
  "Технические подробности": "Technical details",
  "План остановлен": "Plan stopped",
  "Наблюдение завершено": "Tracking ended",
  "Приглашение уже было отправлено. Проверки принятия и последующие сообщения остановлены.":
    "The invitation was already sent. Acceptance checks and follow-up messages have stopped.",
  "Этот план больше не выполняется. Для новых обращений подготовьте новый план.":
    "This plan is no longer running. Prepare a new plan for new outreach.",
  "Автоматические проверки продолжатся после возобновления плана.":
    "Automatic checks will continue once the plan is resumed.",
  "Проверено: {when}": "Checked: {when}",

  // ContactModeStep.jsx
  "Как связываться с кандидатами?": "How should we contact candidates?",
  "Доступное бесплатное сообщение всегда используется первым.":
    "A free message is always used first when available.",
  "Способ связи": "Contact method",
  "Когда отправлять InMail": "When to send InMail",
  "Дополнительные кредиты не покупаем. Если кредиты закончатся, оставшиеся кандидаты подождут в очереди.":
    "We never buy extra credits. If credits run out, the remaining candidates wait in the queue.",
  "Подписка для InMail": "InMail subscription",
  "Подключите Recruiter и разрешите отправку ваших текстов в аккаунте отправителя.":
    "Connect Recruiter and allow sending your texts in the sender account.",
  "Открыть аккаунты": "Open accounts",
  "Ждать принятия · дней": "Wait for acceptance · days",
  "Приглашения в контакты": "Connection invitations",
  "Проверьте текст": "Check the text",
  "С вашей заметкой": "With your note",
  "Без заметки": "Without a note",
  Выключены: "Off",
  "Приглашать в контакты": "Send connection invitations",
  "После принятия программа отправит утверждённый текст.":
    "Once accepted, the app sends your approved text.",
  "Текст приглашения · необязательно": "Invitation note · optional",
  "Можно оставить пустым": "Can be left blank",
  "Дополнительные настройки": "Advanced settings",
  "Когда работать": "Working hours",
  "Часовой пояс": "Time zone",
  "Начинать в": "Start at",
  "Заканчивать в": "End at",
  "Когда проверять контакты и ответы": "When to check connections and replies",
  "Проверять контакты каждые · ч": "Check connections every · hours",
  "Следить за ответами · дней": "Watch for replies · days",

  // Automation.jsx
  "Без InMail": "Without InMail",
  Рекомендуем: "Recommended",
  "Бесплатное сообщение, а если нельзя — приглашение в контакты.":
    "A free message, or a connection invitation if that's not possible.",
  "Только бесплатное сообщение. Приглашения выключены.":
    "Free message only. Invitations are off.",
  "С InMail": "With InMail",
  "Расходует кредиты": "Uses credits",
  "Если бесплатно написать нельзя, используем InMail вашей подписки.":
    "If a free message isn't possible, we use your subscription's InMail.",
  "Экономить кредиты": "Save credits",
  "Сначала приглашение. InMail — если не примут или пригласить нельзя.":
    "Invitation first. InMail if it isn't accepted or can't be sent.",
  "InMail, если бесплатно написать нельзя.":
    "InMail if a free message isn't possible.",
  "Связаться быстрее": "Reach out faster",
  "Сразу InMail, без ожидания приглашения.":
    "InMail right away, without waiting on an invitation.",
  "Текст приглашения": "Invitation note",
  "Обычный текст": "Standard text",
  "Тема InMail · {label}": "InMail subject · {label}",
  "InMail · {label}": "InMail · {label}",
  "Бесплатное сообщение": "Free message",
  "Обычное сообщение или доступный InMail без списания кредита.":
    "A regular message or an available InMail that uses no credit.",
  "Если можно написать бесплатно — используем ваш текст.":
    "If a free message is possible, we use your text.",
  "Платный InMail": "Paid InMail",
  "Без ожидания приглашения, если есть кредиты подписки.":
    "Without waiting on an invitation, if subscription credits are available.",
  "Пригласить в контакты": "Invite to connect",
  "Если InMail недоступен в LinkedIn или кредитов нет. После принятия — сообщение.":
    "If InMail isn't available on LinkedIn or there are no credits. Once accepted, a message.",
  "После принятия автоматически отправить сообщение.":
    "Send a message automatically once accepted.",
  "Подождать {days} дн. и отправить InMail":
    "Wait {days} days, then send InMail",
  "Отправить InMail": "Send InMail",
  "Если пригласить нельзя — проверим InMail без ожидания.":
    "If an invitation can't be sent, we check InMail right away.",
  "Если бесплатная связь недоступна и есть кредиты подписки.":
    "If free contact isn't available and subscription credits remain.",
  "Дождаться ответа": "Wait for a reply",
  "Ответ появится в истории. Дальнейшие обращения остановятся.":
    "The reply appears in the history. Further outreach stops.",
  "НАСТРОЙКА ОТПРАВКИ": "OUTREACH SETUP",
  "Как связаться": "How to reach out",
  "Тексты сообщений": "Message texts",
  "Шаги настройки отправки": "Outreach setup steps",
  Тексты: "Texts",
  Запуск: "Launch",
  Назад: "Back",
  "Сохранить настройки": "Save settings",
  "Сохранить без запуска": "Save without launching",
  "Готовим тексты…": "Preparing texts…",
  "Посмотреть перед запуском": "Review before launch",
  "Далее: сообщения": "Next: messages",
  "Готовим тексты для каждого получателя. Обычно это занимает несколько секунд, с Recruiter — до пары минут.":
    "Preparing texts for each recipient. This usually takes a few seconds, or up to a couple of minutes with Recruiter.",
  "Срок наблюдения за ответами должен быть больше срока ожидания принятия приглашения.":
    "The reply-watching period must be longer than the wait for an invitation to be accepted.",
  "Время окончания должно быть позже начала в пределах суток.":
    "The end time must be later than the start time within the same day.",
  "«{label}»: укажите целое число от {min} до {max}.":
    "“{label}”: enter a whole number from {min} to {max}.",
  "«{label}»: {error}": "“{label}”: {error}",
  "Сократите шаблоны до 4000 символов, чтобы сохранить настройки.":
    "Shorten the templates to 4,000 characters to save the settings.",
  "Подключите аккаунт отправителя на вкладке «Аккаунты».":
    "Connect the sender account on the “Accounts” tab.",
  "Сначала выберите кандидатов для этой кампании.":
    "Select candidates for this campaign first.",
  "Откройте «Способ связи»: подключите Recruiter и разрешите отправку ваших текстов в аккаунте отправителя.":
    "Open “Contact method”: connect Recruiter and allow sending your texts in the sender account.",
  "Проверьте настройки способа связи.": "Check the contact method settings.",

  // PlanSummary.jsx
  "ВАШ ПЛАН": "YOUR PLAN",
  "Черновик сохранён на этом компьютере": "Draft saved on this computer",
  "Есть несохранённые изменения": "Unsaved changes",
  Сохранено: "Saved",
  "С InMail · {how}": "With InMail · {how}",
  быстрее: "faster",
  экономно: "economy",
  "Изменить выбор": "Change selection",
  "Выбрать кандидатов": "Select candidates",
  "Последовательность действий": "Sequence of actions",
  "Отправитель:": "Sender:",
  "Не выбран": "Not selected",
  "Кредиты InMail: до": "InMail credits: up to",
  "Оставьте приложение запущенным, а компьютер — включённым.":
    "Keep the app running and the computer on.",
  "Обрабатываем только выбранных кандидатов. При ограничении LinkedIn остановимся и сохраним очередь.":
    "Only selected candidates are processed. If LinkedIn limits the account, we stop and keep the queue.",

  // LivePlanPanel.jsx
  КАМПАНИЯ: "CAMPAIGN",
  "Дождитесь завершения": "Wait for completion",
  Посмотреть: "View",
  Пауза: "Pause",
  Продолжить: "Resume",
  "Ждём принятия": "Awaiting acceptance",
  "Сообщения отправлены": "Messages sent",
  "Ответы получены": "Replies received",
  "Требуют внимания": "Need attention",
  "Приложение посмотрит в LinkedIn текущие статусы. Ничего не отправит.":
    "The app will check current statuses on LinkedIn. Nothing will be sent.",
  "Обновить статусы контактов": "Refresh connection statuses",
  "Есть действия с неподтверждённым результатом. Проверьте их в LinkedIn и укажите результат в истории.":
    "Some actions have an unconfirmed result. Check them on LinkedIn and record the result in the history.",
  "Причины остановки каждого контакта доступны в истории.":
    "The reason each contact stopped is in the history.",
  "Открыть историю": "Open history",
  "Проверить сейчас": "Check now",
  "Скрыть настройки": "Hide settings",
  "Изменить настройки кампании": "Edit campaign settings",

  // TextsStep.jsx
  "Что получат кандидаты?": "What will candidates receive?",
  "Для каждой группы — свой текст. Программа подставит имя и покажет итог перед запуском.":
    "Each group gets its own text. The app fills in the name and shows the result before launch.",
  "{count} выбрано": "{count} selected",
  "Для людей с подтверждённой рамкой.": "For people with a confirmed frame.",
  "Для остальных выбранных профилей.": "For the other selected profiles.",
  "Тема InMail ·": "InMail subject ·",
  нейтральное: "standard",
  "Например: Recruitment opportunity": "For example: Recruitment opportunity",
  "Сообщение ·": "Message ·",
  "заменится на имя кандидата": "is replaced with the candidate's first name",
  "Другой текст для InMail": "Different text for InMail",
  "Настроен отдельно": "Set separately",
  "Используем основной": "Using the main text",
  "Оставьте поля пустыми, чтобы использовать сообщения выше.":
    "Leave these fields blank to use the messages above.",
  "Обычный InMail": "Standard InMail",
  "Подпись Recruiter входит в лимит 1900 символов. Точный текст вместе с подписью проверим перед запуском.":
    "The Recruiter signature counts toward the 1,900-character limit. We check the exact text with the signature before launch.",
  "Сохранение изменений заменит текущий план. Запуск нужно будет подтвердить заново.":
    "Saving changes replaces the current plan. You'll need to confirm the launch again.",

  // OutreachHistory.jsx
  "Приглашения и сообщения": "Invitations and messages",
  "Получателей: {count}": "Recipients: {count}",
  "Учтено InMail-кредитов: {count}": "InMail credits counted: {count}",
  "Продолжить кампанию": "Resume campaign",
  Человек: "Person",
  Состояние: "Status",
  "Следующая проверка": "Next check",
  Причина: "Reason",
  "После возобновления": "After resuming",
  "Отправить приглашение": "Send invitation",
  "Уточнить статус": "Refresh status",
  "Старая попытка": "Earlier attempt",
  "Исход старой попытки не подтверждён. Новая проверка подтвердила актуальное состояние приглашения или связи; повторная проверка этой старой записи не требуется.":
    "The outcome of the earlier attempt wasn't confirmed. A new check confirmed the current invitation or connection state; this old record doesn't need another check.",
  "Тема:": "Subject:",
  "Приглашение без заметки": "Invitation without a note",
  "Эту старую отправку InMail нельзя надёжно проверить автоматически. Откройте переписку в LinkedIn и укажите результат вручную.":
    "This earlier InMail can't be reliably checked automatically. Open the conversation on LinkedIn and record the result manually.",
  "Открыть LinkedIn": "Open LinkedIn",
  "Проверено: приглашение отправлено": "Checked: invitation sent",
  "Проверено: сообщение отправлено": "Checked: message sent",
  "Проверено: не отправлено": "Checked: not sent",
};
export const templates = {};
