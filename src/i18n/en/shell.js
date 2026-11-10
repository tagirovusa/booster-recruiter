// English catalog: Russian source string → English. "templates" hold
// strings with {placeholders} that are matched against dynamic messages.
// Area: app shell, navigation, attention panel, search builder, accounts,
// campaign list, settings, backups, notifications and status labels.
export const strings = {
  // Common
  Отмена: "Cancel",
  Закрыть: "Close",
  Повторить: "Retry",
  "Попробовать ещё раз": "Try again",
  "Загружаем…": "Loading…",
  "Технические подробности": "Technical details",
  Подробности: "Details",
  "Все кампании": "All campaigns",
  Кампании: "Campaigns",
  Кампания: "Campaign",
  Аккаунты: "Accounts",
  Настройки: "Settings",
  "Требует внимания": "Needs attention",
  "Нужна проверка": "Needs review",
  "Требуют внимания": "Needs attention",
  Отправитель: "Sender",
  Профили: "Profiles",
  Статус: "Status",
  Шаблон: "Template",
  "Аккаунт отправителя": "Sender account",
  "Скрыть ошибку": "Dismiss error",
  "Скрыть уведомление": "Dismiss notification",

  // Shell
  Подбор: "Talent",
  персонала: "Acquisition",
  "Подбор персонала": "Talent Acquisition",
  "Ваше рабочее пространство": "Your workspace",
  "Данные сохраняются на компьютере": "Data is stored on this computer",
  "Не удалось сохранить черновик на компьютере. Сохраните настройки перед закрытием приложения.":
    "Couldn't save the draft on this computer. Save your settings before closing the app.",
  "Откройте Booster Recruiter как приложение.":
    "Open Booster Recruiter as the desktop app.",
  "Проверка запущена. Активный план продолжает работу; план на паузе не возобновляется.":
    "Check started. An active plan keeps running; a paused plan stays paused.",
  "Профиль открыт в сессии отправителя.":
    "Profile opened in the sender's session.",
  "Список сохранён.": "List saved.",
  "Текущий план сохранён без изменений.":
    "The current plan was kept unchanged.",
  "Настройки и тексты сохранены. Кампания не запущена.":
    "Settings and messages saved. The campaign has not been started.",
  "Не удалось обновить данные. Показана последняя загруженная версия.":
    "Couldn't refresh data. Showing the last loaded version.",
  "Обновляем…": "Refreshing…",
  "Обновить данные": "Refresh data",
  "Открываем рабочее пространство…": "Opening your workspace…",
  "Не удалось открыть рабочее пространство": "Couldn't open the workspace",
  "Не удалось загрузить аккаунты и кампании. Повторите попытку.":
    "Couldn't load accounts and campaigns. Please try again.",
  "Ответы и следующие действия по всем кампаниям. Исправляйте отдельные профили, сохраняя общий план.":
    "Replies and next steps across all campaigns. Fix individual profiles while keeping the overall plan.",
  "Профиль кандидата открыт в браузере отправителя. Нажмите «Сообщение», чтобы ответить.":
    "The candidate's profile is open in the sender's browser. Click “Message” to reply.",
  "Не удалось открыть кампанию": "Couldn't open the campaign",
  "Данные кампании не загрузились. Повторите попытку или вернитесь к списку.":
    "Campaign data didn't load. Try again or go back to the list.",
  "Открываем кампанию…": "Opening campaign…",

  // Attention panel
  "Не удалось создать автоматическую резервную копию. Откройте настройки и сохраните копию вручную.":
    "Couldn't create the automatic backup. Open Settings and save a backup manually.",
  "Открыть настройки": "Open Settings",
  "Не удалось обновить список внимания. Кампании сохранены.":
    "Couldn't refresh the attention list. Your campaigns are saved.",
  "Обновляем список…": "Refreshing the list…",
  "Фильтр внимания": "Attention filter",
  Все: "All",
  "Всё в порядке. Новые ответы и действия появятся здесь.":
    "All clear. New replies and actions will appear here.",
  "В этой группе пока нет действий.": "Nothing in this group yet.",
  "Аккаунт LinkedIn": "LinkedIn account",
  "Проверяем профиль и отправляем приглашение…":
    "Checking the profile and sending the invitation…",
  "Сейчас доступно новое приглашение. Отправьте его после проверки получателя и текста.":
    "A new invitation is available now. Send it after checking the recipient and the text.",
  "Для этой записи автоматическая проверка недоступна. Проверьте переписку в LinkedIn и укажите результат в истории.":
    "Automatic checking isn't available for this entry. Check the conversation in LinkedIn and record the result in the history.",
  "Приложение посмотрит в LinkedIn, дошло ли сообщение. Ничего не отправит.":
    "The app will check in LinkedIn whether the message was delivered. Nothing will be sent.",
  "Проверяем и отправляем…": "Checking and sending…",
  "Отправить приглашение": "Send invitation",
  "Проверяем…": "Checking…",
  "Уточнить статус": "Check status",
  "Ответить в LinkedIn": "Reply in LinkedIn",
  "Открыть аккаунт": "Open account",
  "Открыть ответ": "Open reply",
  "Посмотреть историю": "View history",
  Прочитано: "Mark as read",

  // Search builder
  "Настройка поиска": "Search setup",
  "Кого ищем?": "Who are you looking for?",
  "Простой поиск": "Simple search",
  "Запрос или ссылка": "Query or link",
  "Сброс поискового запроса": "Reset search query",
  "Отредактированный запрос нельзя перенести в поля автоматически. Начать простой поиск заново?":
    "An edited query can't be moved back into the fields automatically. Start a simple search over?",
  "Начать заново": "Start over",
  "Сохранить запрос": "Keep query",
  "Ключевые слова или ссылка на профиль": "Keywords or profile link",
  'Например: "driver recruitment" manager':
    'For example: "driver recruitment" manager',
  "Можно вставить ссылку на один профиль или готовый поисковый запрос LinkedIn.":
    "You can paste a link to a single profile or a ready-made LinkedIn search query.",
  Должности: "Job titles",
  "Например: driver recruiter, recruitment manager":
    "For example: driver recruiter, recruitment manager",
  "Несколько вариантов — через запятую.":
    "Separate several options with commas.",
  "Уточнить поиск: отрасль, ключевые фразы, исключения":
    "Refine search: industry, key phrases, exclusions",
  Отрасль: "Industry",
  "Ключевые фразы": "Key phrases",
  Исключить: "Exclude",
  "Например, internship": "For example, internship",
  "Совпадение ключевых фраз": "Key phrase matching",
  "Хотя бы одна фраза": "At least one phrase",
  "Все фразы": "All phrases",
  "Показать итоговый запрос": "Show final query",
  "Заполните хотя бы одно поле выше": "Fill in at least one field above",

  // Templates
  "Шаблон переносит поиск, тексты и расписание. Кандидатов нужно выбрать заново и подтвердить отправку.":
    "A template carries over the search, messages and schedule. You'll need to pick candidates again and confirm sending.",
  "Выберите шаблон": "Choose a template",
  "Название новой кампании": "New campaign name",
  "Оставьте пустым, чтобы использовать название шаблона":
    "Leave empty to use the template name",
  "Создать черновик": "Create draft",
  "Удалить шаблон": "Delete template",
  "Удалить этот шаблон? Созданные кампании сохранятся.":
    "Delete this template? Campaigns created from it will be kept.",
  "Подтвердить удаление": "Confirm deletion",

  // Forms
  "Подключить LinkedIn": "Connect LinkedIn",
  "Отдельная сессия для каждого аккаунта":
    "A separate session for each account",
  "Название аккаунта": "Account name",
  "Например, Recruiting · Основной": "For example, Recruiting · Main",
  "Откроется окно LinkedIn.": "A LinkedIn window will open.",
  "Войдите и подтвердите вход, если потребуется.":
    "Sign in and confirm the sign-in if asked.",
  "Вернитесь в приложение и проверьте подключение.":
    "Come back to the app and check the connection.",
  "Открыть вход": "Open sign-in",
  "Введите название кампании.": "Enter a campaign name.",
  "Введите ключевые слова или ссылку на профиль LinkedIn.":
    "Enter keywords or a LinkedIn profile link.",
  "Сократите поисковый запрос до 1000 символов.":
    "Shorten the search query to 1,000 characters.",
  "Выберите аккаунт отправителя.": "Choose a sender account.",
  "Укажите целое число от 1 до 100.": "Enter a whole number from 1 to 100.",
  "Новая кампания": "New campaign",
  "Начните с поиска. Сообщения можно заполнить после сбора профилей.":
    "Start with the search. You can write messages after profiles are collected.",
  "Название кампании": "Campaign name",
  "Например, Head of Recruitment · Logistics":
    "For example, Head of Recruitment · Logistics",
  "Сколько профилей собрать": "How many profiles to collect",
  "Создать кампанию": "Create campaign",

  // Accounts page
  "LinkedIn-аккаунты": "LinkedIn accounts",
  "Подключите аккаунт один раз. Для каждой кампании выбирайте нужного отправителя.":
    "Connect an account once, then choose the right sender for each campaign.",
  "Добавить аккаунт": "Add account",
  "Начните с подключения LinkedIn": "Start by connecting LinkedIn",
  "Войдите в своём обычном окне LinkedIn. Пароль и код подтверждения вводятся на стороне LinkedIn.":
    "Sign in through the regular LinkedIn window. Your password and verification code are entered on LinkedIn's side.",
  "Подключить аккаунт": "Connect account",
  "Вход ещё не выполнен": "Not signed in yet",
  "LinkedIn ограничил действия аккаунта. Откройте LinkedIn, проверьте уведомления и выполните требования сервиса. Повторный вход сам по себе не снимает ограничение.":
    "LinkedIn has restricted this account. Open LinkedIn, check your notifications and complete what LinkedIn asks. Signing in again doesn't lift the restriction by itself.",
  "Проверить вход": "Check sign-in",
  "Завершите вход в браузере": "Finish signing in in the browser",
  "Войти в LinkedIn": "Sign in to LinkedIn",
  "Открыть профиль в обычном браузере": "Open profile in your regular browser",
  "Открыть профиль {name} в обычном браузере":
    "Open {name}'s profile in your regular browser",
  "Общий баланс: {credits} {word}": "Total balance: {credits} {word}",
  "Дополнительно, если у вас есть подписка Recruiter.":
    "Optional, if you have a Recruiter subscription.",
  "Проверяем Recruiter…": "Checking Recruiter…",
  "Обновить Recruiter": "Refresh Recruiter",
  "Подключить Recruiter": "Connect Recruiter",
  "LinkedIn автоматически меняет черновики. Отключите это, чтобы отправлять ваши точные тексты.":
    "LinkedIn rewrites drafts automatically. Turn this off to send your exact messages.",
  "Использовать мои тексты": "Use my messages",
  "Отключить сессию": "Disconnect session",
  "Удалить аккаунт": "Delete account",
  "Каждому аккаунту — отдельная сессия": "Each account gets its own session",
  "Кампания всегда сохраняет своего отправителя. Переключение аккаунтов не меняет уже подготовленные сообщения.":
    "A campaign always keeps its sender. Switching accounts doesn't change messages that are already prepared.",

  // Campaigns page
  "Ваши кампании": "Your campaigns",
  "От поискового запроса до сохранённого списка кандидатов.":
    "From a search query to a saved list of candidates.",
  "Создать из шаблона": "Create from template",
  "Список кампаний": "Campaign list",
  Активные: "Active",
  "Архив · {count}": "Archive · {count}",
  "Сохранённые профили": "Saved profiles",
  "Готовые аккаунты": "Ready accounts",
  "Архив пока пуст": "The archive is empty",
  "Найдите людей для вашей следующей вакансии":
    "Find people for your next opening",
  "История кампаний удалённых аккаунтов появится здесь.":
    "Campaign history of deleted accounts will appear here.",
  "Задайте ключевые слова и подготовьте сообщения. Программа сохранит найденные профили и поможет проверить их перед отправкой.":
    "Set keywords and prepare messages. The app saves the profiles it finds and helps you review them before sending.",
  "Создать первую кампанию": "Create your first campaign",
  "Архив кампаний": "Campaign archive",
  "{count} всего": "{count} total",

  // Settings page
  "Язык интерфейса": "Interface language",
  Язык: "Language",
  "Окно перезагрузится, кампании продолжат работу.":
    "The window will reload; campaigns keep running.",
  "Настройки и помощь": "Settings and help",
  "Основные функции работают без подключения ИИ.":
    "Core features work without connecting AI.",
  "Как начать работу": "Getting started",
  "От подключения аккаунта до первого результата.":
    "From connecting an account to your first result.",
  "Подключите LinkedIn": "Connect LinkedIn",
  "«Аккаунты» → «Добавить аккаунт», войдите и нажмите «Проверить вход».":
    "“Accounts” → “Add account”, sign in and click “Check sign-in”.",
  "Создайте кампанию": "Create a campaign",
  "«Кампании» → «Новая кампания». Укажите, кого ищете, и нажмите «Найти кандидатов».":
    "“Campaigns” → “New campaign”. Describe who you're looking for and click “Find candidates”.",
  "Выберите кандидатов": "Choose candidates",
  "Отметьте нужных людей и нажмите «Настроить отправку».":
    "Select the people you want and click “Set up sending”.",
  "Напишите тексты и запустите": "Write messages and launch",
  "На вкладке «Отправка» выберите способ связи, напишите тексты и нажмите «Посмотреть перед запуском».":
    "On the “Outreach” tab, choose how to contact people, write your messages and click “Review before launch”.",
  "Отвечайте кандидатам": "Reply to candidates",
  "Новые ответы — в разделе «Требует внимания». Список можно выгрузить в Excel.":
    "New replies are in “Needs attention”. You can export the list to Excel.",
  "Работа с кампаниями": "Working with campaigns",
  "Что происходит после запуска.": "What happens after launch.",
  "Приглашения и сообщения": "Invitations and messages",
  "Программа следует выбранному плану связи. После принятия приглашения отправляет утверждённое сообщение. Ответ кандидата останавливает дальнейшие обращения.":
    "The app follows the chosen contact plan. Once an invitation is accepted, it sends the approved message. A reply from the candidate stops any further outreach.",
  "Пауза и проверка результата": "Pausing and checking results",
  "«Пауза» дожидается текущего действия и сохраняет план. Если результат отправки неизвестен, сначала проверьте переписку в LinkedIn — повтор может создать дубль.":
    "“Pause” waits for the current action to finish and keeps the plan. If a send result is unknown, check the conversation in LinkedIn first — retrying may create a duplicate.",
  "Что означает рамка": "What the photo frame means",
  "Open to Work помогает выбрать текст обращения. Отсутствие рамки не подтверждает занятость человека или его нежелание менять работу.":
    "Open to Work helps you choose the message. No frame doesn't mean the person is employed or unwilling to change jobs.",
  "Для разработчиков: ИИ-агент": "For developers: AI agent",
  "Необязательно. Нужно, только если вы подключаете ИИ-ассистента.":
    "Optional. Only needed if you connect an AI assistant.",
  "Агент может работать с теми же кампаниями через MCP, пока приложение работает, в том числе в фоне. Подтверждение новой рассылки остаётся за вами.":
    "An agent can work with the same campaigns over MCP while the app is running, including in the background. Approving new outreach stays with you.",
  "Показать настройки подключения": "Show connection settings",
  "Настройки MCP": "MCP settings",

  // Background work
  "Работа в фоне": "Background work",
  "Выберите, когда приложение должно продолжать работу.":
    "Choose when the app should keep working.",
  "Загружаем настройки…": "Loading settings…",
  "Не удалось подтвердить сохранение. Обновите настройки и проверьте переключатель.":
    "Couldn't confirm the save. Refresh the settings and check the switch.",
  "Не удалось загрузить настройки. Попробуйте ещё раз.":
    "Couldn't load settings. Please try again.",
  "Обновить настройки": "Refresh settings",
  "Продолжать работу после закрытия окна":
    "Keep working after the window is closed",
  "При включении этой настройки кампании продолжатся в фоне. Открыть окно можно через значок приложения.":
    "When this is on, campaigns keep running in the background. You can reopen the window from the app icon.",
  "Запускать при входе в систему": "Launch at login",
  "Приложение откроется автоматически после входа в компьютер.":
    "The app opens automatically when you sign in to your computer.",
  "Автозапуск доступен в установленной версии приложения.":
    "Launch at login is available in the installed version of the app.",
  "Сохраняем настройку…": "Saving setting…",
  "Настройки сохранены.": "Settings saved.",
  "Выполняются только утверждённые кампании и только в выбранные часы, пока компьютер включён и не спит. Чтобы полностью остановить приложение, выберите «Завершить работу» в меню его значка.":
    "Only approved campaigns run, and only during the chosen hours while the computer is on and awake. To stop the app completely, choose “Quit” in its icon menu.",

  // Notifications
  Уведомления: "Notifications",
  "Только новые ответы и ситуации, где нужна ваша помощь.":
    "Only new replies and situations that need your help.",
  "Загружаем настройку…": "Loading setting…",
  "Показывать уведомления на компьютере": "Show desktop notifications",
  "Имена и тексты сообщений в уведомления не попадают. Если они не появляются, разрешите уведомления Booster Recruiter в настройках системы.":
    "Names and message texts are never included in notifications. If they don't appear, allow notifications for Booster Recruiter in your system settings.",

  // Backups
  Ежедневная: "Daily",
  "Создана вручную": "Created manually",
  "Перед восстановлением": "Before restore",
  "{size} КБ": "{size} KB",
  "{size} МБ": "{size} MB",
  "Данные восстановлены. Войдите в аккаунты заново; кампании оставлены на паузе.":
    "Data restored. Sign in to your accounts again; campaigns were left paused.",
  "Резервная копия сохранена.": "Backup saved.",
  "Резервные копии": "Backups",
  "Кампании, профили и история сохраняются на этом компьютере.":
    "Campaigns, profiles and history are stored on this computer.",
  "Автоматическая копия создаётся ежедневно при работе приложения. Сессии LinkedIn и пароли в копии не входят. Копии на этом же диске не защищают от потери компьютера.":
    "An automatic backup is made daily while the app is running. LinkedIn sessions and passwords aren't included. Backups on the same drive don't protect against losing the computer.",
  "Сохраняем…": "Saving…",
  "Создать копию сейчас": "Back up now",
  "Обновить список": "Refresh list",
  "Загружаем список копий…": "Loading backups…",
  "Копий пока нет. Первая появится автоматически сегодня, или создайте её кнопкой выше.":
    "No backups yet. The first one will appear automatically today, or create one with the button above.",
  Копия: "Backup",
  Восстановить: "Restore",
  "Подтверждение восстановления": "Restore confirmation",
  "Восстановить данные от {date}?": "Restore data from {date}?",
  "Данные приложения вернутся к этой дате. Текущие данные мы сначала сохраним отдельной копией. После восстановления кампании будут на паузе, а в аккаунты LinkedIn нужно будет войти заново.":
    "App data will return to this date. Your current data is saved as a separate backup first. After restoring, campaigns will be paused and you'll need to sign in to your LinkedIn accounts again.",
  "Восстанавливаем…": "Restoring…",
  "Подтвердить восстановление": "Confirm restore",

  // Status labels (labels.js)
  "Hiring (сам нанимает)": "Hiring",
  "Без рамки": "No frame",
  "Не определена": "Not detected",
  "Не подключён": "Not connected",
  Готово: "Ready",
  "Требуется вход": "Sign-in required",
  "Ждём входа": "Waiting for sign-in",
  "Вошли в другой профиль": "Signed in to a different profile",
  "Ограничение LinkedIn": "LinkedIn restriction",
  Отключён: "Disconnected",
  Удалён: "Deleted",
  "В архиве": "Archived",
  Проверено: "Checked",
  Черновик: "Draft",
  "Ищем кандидатов": "Finding candidates",
  "Идёт отправка": "Sending",
  "На паузе": "Paused",
  "Обычный текст": "Standard message",
  "Без группы": "No group",
  Отправлено: "Sent",
  "Неясно, отправлено ли": "Delivery unclear",
  "Сообщение недоступно": "Message unavailable",
  Отменено: "Cancelled",
  "В очереди": "Queued",
  "Ответ получен": "Replied",
  Ошибка: "Error",
  "По расписанию": "Scheduled",
  "Обновляем статусы": "Updating statuses",
  "В плане": "Planned",
  "Ждём принятия": "Awaiting acceptance",
  "Ожидаем кредиты": "Waiting for credits",
  Исключён: "Excluded",
  Недоступно: "Unavailable",
  Завершено: "Completed",
  "Черновик плана": "Plan draft",
  "Работает по расписанию": "Running on schedule",
  "Отправляем…": "Sending…",
  "Действие остановлено": "Action stopped",
  "Связь ещё не подтверждена": "Connection not confirmed yet",
  "В контактах · 1-й уровень": "Connected · 1st degree",
  "Приглашение ожидает принятия": "Invitation pending",
  "Нет контакта": "Not connected",
  "Входящее приглашение": "Incoming invitation",
  "Собственный профиль": "Your own profile",
  Приглашение: "Invitation",
  "Обычное сообщение": "Standard message",
  "Новые ответы": "New replies",
  "Нужно проверить": "Needs review",
  "Нужен вход": "Sign-in needed",
  Чикаго: "Chicago",
  "Нью-Йорк": "New York",
  "Лос-Анджелес": "Los Angeles",
  Киев: "Kyiv",
  Варшава: "Warsaw",
  Тбилиси: "Tbilisi",
};
export const templates = {};
