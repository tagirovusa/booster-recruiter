// English catalog for messages produced outside the window: the Python
// service (progress lines, errors, stored statuses and details, events) and
// the desktop shell (errors that reach the window). The service keeps
// writing Russian; tr() translates on display, including old stored lines.
//
// "templates" cover messages with dynamic parts. Placeholders capture any
// text; captured Russian parts are translated recursively.
export const strings = {
  // Wording saved by earlier app versions and still stored in workspaces.
  "Кампания возвращена из архива. Утверждённый ранее план на паузе.":
    "Campaign restored from the archive. The previously approved plan is paused.",
  "Проверьте спорные результаты в истории.":
    "Review the uncertain results in the history.",
  "Подтверждено чтением существующего диалога LinkedIn при исправлении 0.1.3: проверены текст, отправитель и адресат.":
    "Confirmed by reading the existing LinkedIn conversation during the 0.1.3 repair: text, sender and recipient were checked.",
  "Чтобы найти больше, упростите запрос: уберите часть условий AND или точных фраз в кавычках.":
    "To find more, simplify the query: remove some AND conditions or exact phrases in quotes.",
  // account_removal.py
  "Приостановите кампании и дождитесь завершения текущего действия перед удалением аккаунта.":
    "Pause the campaigns and wait for the current action to finish before deleting the account.",
  "Не удалось безопасно удалить сессию аккаунта. Обратитесь в поддержку.":
    "Could not safely delete the account session. Contact support.",
  "Не удалось безопасно удалить сессию аккаунта.":
    "Could not safely delete the account session.",
  "Началась новая операция. Приостановите кампании и повторите удаление.":
    "A new operation has started. Pause the campaigns and try deleting again.",
  "Не удалось полностью удалить локальную сессию. Закройте окно LinkedIn и повторите удаление.":
    "Could not fully delete the local session. Close the LinkedIn window and try deleting again.",
  "Не удалось полностью удалить сессию аккаунта. Закройте окно LinkedIn и повторите удаление.":
    "Could not fully delete the account session. Close the LinkedIn window and try deleting again.",
  "Аккаунт удалён. История сохранена в архиве.":
    "Account deleted. History is kept in the archive.",
  "Аккаунт удалён. Новая отправка недоступна.":
    "Account deleted. New sending is unavailable.",
  "Аккаунт удалён.": "Account deleted.",

  // api.py
  "Нет доступа.": "Access denied.",
  "Браузерные запросы не поддерживаются.":
    "Browser requests are not supported.",
  "Запрос слишком большой.": "The request is too large.",
  "Это действие подтверждается только в окне Booster Recruiter.":
    "This action can only be confirmed in the Booster Recruiter window.",
  "Подтвердите замену данных резервной копией.":
    "Confirm replacing the data with the backup.",
  "Приостановите кампании и дождитесь завершения текущих действий.":
    "Pause the campaigns and wait for the current actions to finish.",
  "Дождитесь завершения текущих действий кампании.":
    "Wait for the campaign's current actions to finish.",
  "Началась новая операция. Приостановите кампании перед восстановлением.":
    "A new operation has started. Pause the campaigns before restoring.",
  "Подтвердите удаление аккаунта и его локальной сессии.":
    "Confirm deleting the account and its local session.",
  "Сначала приостановите обработку и дождитесь завершения текущей операции.":
    "First pause processing and wait for the current operation to finish.",
  "Подтвердите удаление кампании.": "Confirm deleting the campaign.",
  "Отказ от контакта": "Opted out of contact",
  "Эта отправка не требует ручной проверки.":
    "This send does not need a manual check.",
  "Подтвердите отправку либо отсутствие сообщения.":
    "Confirm whether the message was sent or not.",
  "Результат вручную проверен пользователем в LinkedIn.":
    "Result checked manually by the user in LinkedIn.",
  "Неизвестная операция.": "Unknown operation.",
  "Не удалось выполнить действие. Обновите окно и попробуйте ещё раз.":
    "Could not complete the action. Refresh the window and try again.",
  "Операция не выполнена. Перезапустите приложение; сохранённые данные останутся.":
    "The operation failed. Restart the app; saved data will be kept.",
  "Приложение уже использует эту базу данных.":
    "The app is already using this database.",

  // attention_recovery.py
  "Автоматическая проверка завершена. Ничего не отправлялось.":
    "Automatic check finished. Nothing was sent.",
  "Результат уже изменён. Обновите историю перед следующей проверкой.":
    "The result has already changed. Refresh the history before the next check.",
  "Точное исходящее сообщение подтверждено автоматической проверкой LinkedIn.":
    "The exact outgoing message was confirmed by an automatic LinkedIn check.",
  "Пока недостаточно данных для подтверждения отправки. Повтор не выполнялся.":
    "Not enough data yet to confirm the send. Nothing was retried.",
  "Для этой старой отправки InMail не сохранено достаточно данных для автоматического подтверждения. Откройте переписку и укажите результат вручную.":
    "This older InMail send does not have enough saved data for automatic confirmation. Open the conversation and set the result manually.",
  "Уточнить статус": "Check status",
  "Этот результат уже проверен или больше не требует внимания.":
    "This result has already been checked or no longer needs attention.",
  "Браузер занят. Дождитесь текущего действия или приостановите кампанию.":
    "The browser is busy. Wait for the current action or pause the campaign.",
  "Проверяем результат в LinkedIn без отправки…":
    "Checking the result in LinkedIn without sending…",
  "Браузер не закрылся после ошибки. Проверьте вход.":
    "The browser did not close after an error. Check the sign-in.",
  "Есть несколько неоднозначных действий. Проверьте их в истории отдельно.":
    "There are several ambiguous actions. Check each of them in the history.",
  "Отправка подтверждена автоматически. Повтор не требуется.":
    "Send confirmed automatically. No retry needed.",
  "Автоматическая проверка не подтвердила профиль. Проверьте вход или откройте профиль вручную.":
    "The automatic check did not confirm the profile. Check the sign-in or open the profile manually.",
  "Ответ найден в LinkedIn. Продолжите разговор вручную.":
    "A reply was found in LinkedIn. Continue the conversation manually.",
  "В LinkedIn уже начата переписка. Новое обращение не требуется.":
    "A conversation has already started in LinkedIn. No new outreach is needed.",
  "Связь уже существует.": "The connection already exists.",
  "Приглашение уже ожидает принятия. Повтор не требуется.":
    "The invitation is already pending. No retry needed.",
  "Контакт подтверждён. Этот план завершён или общение уже учтено в другом плане.":
    "Connection confirmed. This plan is finished or the conversation is already covered by another plan.",
  "Контакт уже существует. При продолжении кампании проверим доступное сообщение; сейчас ничего не отправлялось.":
    "The connection already exists. When the campaign continues we will check which message is available; nothing was sent now.",
  "Приглашение уже ожидает принятия. Повторно не отправляли.":
    "The invitation is already pending. It was not sent again.",
  "Контакт проверен. Для отправки продолжите утверждённую кампанию вручную.":
    "Contact checked. To send, resume the approved campaign manually.",
  "Пока недостаточно данных для подтверждения результата. Повтор не выполнялся; можно проверить ещё раз позже или открыть LinkedIn.":
    "Not enough data yet to confirm the result. Nothing was retried; you can check again later or open LinkedIn.",
  "LinkedIn сейчас предлагает приглашение. Можно подтвердить одну новую попытку; старый исход остаётся неизвестным.":
    "LinkedIn currently offers an invitation. You can confirm one new attempt; the earlier outcome remains unknown.",

  // browser_engine.py, selftest.py, worker.py
  "Версия браузерного движка не соответствует сборке приложения. Переустановите приложение.":
    "The browser engine version does not match this app build. Reinstall the app.",
  "Встроенный браузер не найден. Переустановите приложение.":
    "The built-in browser was not found. Reinstall the app.",
  "Вставьте полную ссылку на профиль LinkedIn вида https://www.linkedin.com/in/имя.":
    "Paste a full LinkedIn profile link like https://www.linkedin.com/in/name.",
  "LinkedIn временно ограничил действия. Очереди аккаунта приостановлены; продолжите после снятия ограничения.":
    "LinkedIn has temporarily restricted actions. The account's queues are paused; continue once the restriction is lifted.",
  "LinkedIn не отдал раздел профиля.":
    "LinkedIn did not return a profile section.",
  "Не удалось определить владельца профиля. Сбор остановлен для проверки страницы.":
    "Could not identify the profile owner. Collection stopped so the page can be checked.",
  "Проверьте контракт и отключите автотексты в подключении Recruiter.":
    "Check the contract and turn off automatic texts in the Recruiter connection.",
  "Редактор InMail недоступен.": "The InMail editor is unavailable.",
  "Изменилось подключение Recruiter. Проверьте контракт и настройки текстов.":
    "The Recruiter connection has changed. Check the contract and text settings.",
  "Для этой старой отправки Recruiter нет сохранённого подтверждения. Проверьте переписку вручную; повтор не выполнялся.":
    "This older Recruiter send has no saved confirmation. Check the conversation manually; nothing was retried.",
  "Не сохранён контракт переписки Recruiter.":
    "The Recruiter conversation contract was not saved.",
  "Браузер LinkedIn не завершил операцию.":
    "The LinkedIn browser did not finish the operation.",

  // export.py
  "Поддерживается Excel или CSV.": "Excel or CSV is supported.",

  // identity.py
  "Не удалось определить постоянную ссылку вашего LinkedIn-профиля. В окне LinkedIn откройте свой профиль, дождитесь загрузки и нажмите «Проверить вход» ещё раз. Аккаунт пока не подтверждён.":
    "Could not determine the permanent link of your LinkedIn profile. In the LinkedIn window, open your profile, wait for it to load and click “Check sign-in” again. The account is not confirmed yet.",
  "Профиль в окне LinkedIn изменился во время проверки. Повторите проверку входа в нужный аккаунт.":
    "The profile in the LinkedIn window changed during the check. Check the sign-in to the right account again.",
  "Данные профиля LinkedIn расходятся. Повторите проверку входа.":
    "The LinkedIn profile data do not match. Check the sign-in again.",

  // invitation_repair.py
  "Приглашение недоступно: проверьте аккаунт и утверждённый план.":
    "Invitation unavailable: check the account and the approved plan.",
  "Состояние получателя изменилось. Проверьте его снова.":
    "The recipient's status has changed. Check it again.",
  "Настройки изменились. Подготовьте новый предпросмотр.":
    "Settings have changed. Prepare a new preview.",
  "История получателя не соответствует отправителю. Проверьте её вручную.":
    "The recipient's history does not match the sender. Check it manually.",
  "Есть другое неподтверждённое или выполненное действие. Проверьте историю.":
    "There is another unconfirmed or completed action. Check the history.",
  "Есть уже подтверждённое приглашение. Повтор не требуется.":
    "There is already a confirmed invitation. No retry needed.",
  "Нет попытки приглашения, которую требуется исправить.":
    "There is no invitation attempt that needs fixing.",
  "Подтверждение устарело. Проверьте профиль ещё раз и подтвердите одно приглашение.":
    "The confirmation is out of date. Check the profile again and confirm one invitation.",
  "Отправка отменена по запросу паузы. Приглашение не отправлялось.":
    "Sending was cancelled by the pause request. The invitation was not sent.",
  "Результат попытки сохранён в истории. Дальнейшая обработка остановлена пользователем.":
    "The attempt's result is saved in the history. Further processing was stopped by the user.",
  "Отправляем одно подтверждённое приглашение…":
    "Sending one confirmed invitation…",
  "Состояние изменилось во время ожидания. Проверьте профиль ещё раз.":
    "The status changed while waiting. Check the profile again.",
  "Получатель или план изменился. Приглашение не отправлялось.":
    "The recipient or plan has changed. The invitation was not sent.",
  "LinkedIn не подтвердил профиль. Приглашение не отправлялось.":
    "LinkedIn did not confirm the profile. The invitation was not sent.",
  "LinkedIn сейчас не предлагает приглашение. Ничего не отправлялось.":
    "LinkedIn does not offer an invitation right now. Nothing was sent.",
  "Состояние получателя обновлено. Кампания сохранена.":
    "Recipient status updated. The campaign is saved.",
  "Подтверждение устарело. Ничего не отправлялось.":
    "The confirmation is out of date. Nothing was sent.",
  "Ответ новой подтверждённой попытки потерян. Повтор заблокирован.":
    "The response to the new confirmed attempt was lost. Retry is blocked.",
  "Не удалось подтвердить новое приглашение. Проверьте результат.":
    "Could not confirm the new invitation. Check the result.",
  "Не удалось закрыть браузер после потери ответа. Проверьте вход.":
    "Could not close the browser after the response was lost. Check the sign-in.",
  "Результат не подтверждён.": "Result not confirmed.",
  "Новую попытку не удалось подтвердить.":
    "The new attempt could not be confirmed.",
  "Новое приглашение подтверждено.": "New invitation confirmed.",
  "Контакт уже существует. Дальше действует утверждённый план.":
    "The connection already exists. The approved plan continues from here.",
  "Приглашение подтверждено; ожидаем принятия.":
    "Invitation confirmed; waiting for acceptance.",
  "Проверьте вход LinkedIn.": "Check the LinkedIn sign-in.",
  "LinkedIn сообщил о лимите.": "LinkedIn reported a limit.",

  // mcp_bridge.py (errors may be shown by an AI assistant)
  "Сначала откройте Booster Recruiter.": "Open Booster Recruiter first.",
  "Booster Recruiter не выполнил операцию.":
    "Booster Recruiter did not complete the operation.",
  "Booster Recruiter не отвечает. Проверьте, что приложение открыто.":
    "Booster Recruiter is not responding. Check that the app is open.",

  // outreach.py
  "Неизвестные настройки автоматизации.": "Unknown automation settings.",
  "Параметр разрешения должен быть переключателем.":
    "The permission setting must be a switch.",
  "Выберите экономный или быстрый режим.": "Choose economy or fast mode.",
  "Выберите LinkedIn Premium или Recruiter для InMail.":
    "Choose LinkedIn Premium or Recruiter for InMail.",
  "Срок наблюдения за ответами должен быть больше срока ожидания принятия приглашения.":
    "The reply-watching period must be longer than the wait for an invitation to be accepted.",
  "Время окончания должно быть позже начала в пределах суток.":
    "The end time must be later than the start time within the same day.",
  "Неизвестный часовой пояс.": "Unknown time zone.",
  "Шаблон должен быть текстом до 4000 символов.":
    "The template must be text of up to 4000 characters.",
  "Не подтверждён владелец открытого профиля.":
    "The owner of the opened profile is not confirmed.",
  "Человек уже ответил. Продолжите разговор вручную.":
    "The person has already replied. Continue the conversation manually.",
  "В LinkedIn уже есть исходящее сообщение. Повтор исключён.":
    "There is already an outgoing message in LinkedIn. No repeat.",
  "Доступно обычное бесплатное сообщение.":
    "A regular free message is available.",
  "Собственный профиль или входящее приглашение: проверьте вручную.":
    "Own profile or an incoming invitation: check manually.",
  "Контакт подтверждён, но отправка сообщения недоступна.":
    "Connection confirmed, but sending a message is unavailable.",
  "В Recruiter доступен InMail без расхода кредита.":
    "Recruiter offers an InMail that uses no credit.",
  "Кредитов нет; ожидаем принятия существующего приглашения.":
    "No credits; waiting for the existing invitation to be accepted.",
  "Кредитов нет; используем разрешённое приглашение.":
    "No credits; using the allowed invitation.",
  "Быстрый режим: разрешён InMail.": "Fast mode: InMail is allowed.",
  "Срок ожидания принятия приглашения истёк.":
    "The wait for the invitation to be accepted has expired.",
  "Ожидаем подтверждённого принятия приглашения.":
    "Waiting for confirmed acceptance of the invitation.",
  "Отправить утверждённое приглашение.": "Send the approved invitation.",
  "Бесплатная связь и приглашение недоступны.":
    "Free messaging and invitations are unavailable.",
  "Доступен только InMail; он не разрешён в этой кампании.":
    "Only InMail is available; it is not allowed in this campaign.",
  "Доступный способ связи не удалось подтвердить.":
    "Could not confirm an available way to contact.",
  "Приложение завершилось во время действия. Проверьте результат в LinkedIn.":
    "The app closed during an action. Check the result in LinkedIn.",
  "Ответ браузера потерян при завершении приложения.":
    "The browser's response was lost when the app closed.",
  "Достигнут дневной бюджет приложения для этого канала (UTC).":
    "The app's daily budget for this channel has been reached (UTC).",
  "Исчерпан утверждённый бюджет InMail этой кампании.":
    "This campaign's approved InMail budget is used up.",
  "Проверка прервана перезапуском приложения. Запустите её ещё раз, если она нужна.":
    "The check was interrupted by an app restart. Run it again if you need it.",
  "Утверждённая очередь восстановлена. Ожидаем расписания.":
    "The approved queue is restored. Waiting for the schedule.",
  "Состав или настройки кампании изменились.":
    "The campaign's recipients or settings have changed.",
  "Не контактировать: профиль в списке исключений.":
    "Do not contact: the profile is on the exclusion list.",
  "Есть прежняя отправка или неподтверждённое действие. Повтор исключён.":
    "There is an earlier send or an unconfirmed action. No repeat.",
  "Есть прежнее обращение или неподтверждённое действие. Проверьте историю.":
    "There is earlier outreach or an unconfirmed action. Check the history.",
  "Профиль уже включён в другую утверждённую очередь.":
    "The profile is already in another approved queue.",
  "Профиль уже включён в другую действующую кампанию.":
    "The profile is already in another active campaign.",
  "Профиль исключён из кампании.": "The profile is excluded from the campaign.",
  "Сначала выберите группу сообщения.": "First choose the message group.",
  "Подключите аккаунт отправителя.": "Connect the sender account.",
  "Подключите Recruiter у отправителя и заново проверьте запуск.":
    "Connect Recruiter for the sender and check the launch again.",
  "Отключите автоматические тексты LinkedIn в подключении Recruiter.":
    "Turn off LinkedIn's automatic texts in the Recruiter connection.",
  "Приглашение и тема InMail: до 200 символов; тема — одна строка.":
    "Invitation and InMail subject: up to 200 characters; the subject is one line.",
  "Текст вместе с подписью Recruiter превышает 1900 символов.":
    "The text together with the Recruiter signature exceeds 1900 characters.",
  "Нет выбранных получателей без прежних обращений или активной кампании.":
    "No selected recipients without earlier outreach or an active campaign.",
  "Предпросмотр устарел. Подготовьте кампанию снова.":
    "The preview is out of date. Prepare the campaign again.",
  "Сначала подтвердите вход отправителя.":
    "First confirm the sender's sign-in.",
  "Настройки изменились. Подготовьте кампанию снова.":
    "Settings have changed. Prepare the campaign again.",
  "Подключение Recruiter изменилось. Обновите предпросмотр.":
    "The Recruiter connection has changed. Refresh the preview.",
  "Один из получателей уже обрабатывается. Обновите предпросмотр.":
    "One of the recipients is already being processed. Refresh the preview.",
  "Приглашение уже отправлено; ожидаем принятия.":
    "The invitation was already sent; waiting for acceptance.",
  "План утверждён. Ожидаем запуска по расписанию.":
    "Plan approved. Waiting to start on schedule.",
  "Неизвестное состояние кампании.": "Unknown campaign state.",
  "План не утверждён или завершён. Подготовьте новый предпросмотр.":
    "The plan is not approved or is finished. Prepare a new preview.",
  "Сначала продолжите утверждённую кампанию.":
    "First resume the approved campaign.",
  "Контакт проверен. Продолжите кампанию для обработки по плану.":
    "Contact checked. Resume the campaign to process it according to the plan.",
  "Неизвестный канал.": "Unknown channel.",
  "Неверная стоимость InMail.": "Invalid InMail cost.",
  "Получатель исключён или план приостановлен.":
    "The recipient is excluded or the plan is paused.",
  "Есть действие с неизвестным результатом. Повтор запрещён.":
    "There is an action with an unknown result. Retrying is not allowed.",
  "Повторное обращение исключено.": "Repeat outreach is excluded.",
  "Приглашение уже отправлено. Ожидаем принятия контакта.":
    "The invitation was already sent. Waiting for the connection to be accepted.",
  "Этот канал не был утверждён.": "This channel was not approved.",
  "Неизвестный результат действия.": "Unknown action result.",
  "Подтверждение связи применимо только к приглашению.":
    "Connection confirmation only applies to an invitation.",
  "Это действие не требует проверки.": "This action does not need a check.",
  "Отсутствие действия подтверждено. Для повторной попытки подготовьте новый план.":
    "Confirmed that no action took place. To try again, prepare a new plan.",
  "Приглашение подтверждено вручную; ожидаем проверки контакта.":
    "Invitation confirmed manually; waiting for the connection check.",
  "Отправка сообщения подтверждена вручную в LinkedIn.":
    "Message send confirmed manually in LinkedIn.",

  // outreach_browser.py
  "Исход отправки приглашения не подтверждён.":
    "The outcome of sending the invitation is not confirmed.",
  "LinkedIn открыл другой профиль. Проверьте адрес в браузере.":
    "LinkedIn opened a different profile. Check the address in the browser.",
  "Контакт уже существует.": "The connection already exists.",
  "Приглашение уже ожидает принятия.": "The invitation is already pending.",
  "Приглашение недоступно, уже отправлено или контакт уже существует.":
    "The invitation is unavailable, already sent, or the connection already exists.",
  "Чтение профиля для приглашения не настроено.":
    "Profile reading for invitations is not set up.",
  "Контакт уже существует. Повторное приглашение не требуется.":
    "The connection already exists. No new invitation is needed.",
  "Приглашение подтверждено как ожидающее принятия.":
    "The invitation is confirmed as pending.",
  "Отправка приглашения не подтверждена. Проверьте профиль перед повтором.":
    "Sending the invitation is not confirmed. Check the profile before retrying.",
  "Исход приглашения не подтверждён. Проверьте профиль.":
    "The invitation outcome is not confirmed. Check the profile.",
  "Приглашение не отправлено.": "The invitation was not sent.",
  "Профиль или история не подтверждены, либо переписка уже начата.":
    "The profile or history is not confirmed, or a conversation has already started.",
  "Бесплатная отправка недоступна. InMail-кредиты не расходуются.":
    "Free sending is unavailable. InMail credits are not used.",
  "Нет подтверждённой формы платного InMail с доступными кредитами.":
    "No confirmed paid InMail form with available credits.",
  "Профиль или переписка пока не подтверждены. Отправка не повторялась.":
    "The profile or conversation is not confirmed yet. Sending was not retried.",
  "Не подтверждён адресат переписки. Отправка не повторялась.":
    "The conversation recipient is not confirmed. Sending was not retried.",
  "Автоматическая проверка не нашла однозначного подтверждения: нужны точный текст, отправитель, адресат и время сообщения после попытки. Повтор не выполнялся; проверьте диалог вручную.":
    "The automatic check found no clear confirmation: it needs the exact text, sender, recipient and message time after the attempt. Nothing was retried; check the conversation manually.",
  "Проверка ответа пока недоступна: не подтверждён профиль.":
    "Reply check is not available yet: the profile is not confirmed.",
  "Получен ответ. Автоматические обращения остановлены.":
    "A reply was received. Automatic outreach has stopped.",
  "Ответ пока не подтверждён.": "No reply confirmed yet.",

  // outreach_runtime.py
  "Остальным получателям обработка завершена. Отдельные профили требуют внимания; исправьте их в том же плане.":
    "Processing is finished for the other recipients. Some profiles need attention; fix them in the same plan.",
  "Все получатели обработаны.": "All recipients have been processed.",
  "Проверяем аккаунт перед проверкой контактов…":
    "Checking the account before checking contacts…",
  "Проверка контактов приостановлена.": "Contact check paused.",
  "Состояние контактов проверено. Приглашения и сообщения не отправлялись.":
    "Contact status checked. No invitations or messages were sent.",
  "Кампания приостановлена.": "Campaign paused.",
  "План не утверждён или приостановлен.":
    "The plan is not approved or is paused.",
  "Проверяем аккаунт и утверждённый план…":
    "Checking the account and the approved plan…",
  "Ожидаем рабочего времени по расписанию кампании.":
    "Waiting for working hours according to the campaign schedule.",
  "Получатель исключён или уже обработан в другой кампании.":
    "The recipient is excluded or already processed in another campaign.",
  "Период наблюдения завершён. История сохранена.":
    "The monitoring period has ended. History is saved.",
  "Ответ пока не обнаружен.": "No reply found yet.",
  "Нет подтверждённых доступных InMail-кредитов. Проверим позже.":
    "No confirmed available InMail credits. We will check later.",
  "Ответ браузера потерян. Повторное действие заблокировано.":
    "The browser's response was lost. Repeating the action is blocked.",
  "Проверьте результат действия в LinkedIn.":
    "Check the result of the action in LinkedIn.",
  "Связь подтверждена.": "Connection confirmed.",
  "Контакт уже существует; проверим сообщение по утверждённому плану.":
    "The connection already exists; we will check the message according to the approved plan.",
  "Приглашение уже ожидает принятия; повтор не нужен.":
    "The invitation is already pending; no retry needed.",
  "Действие подтверждено в LinkedIn.": "Action confirmed in LinkedIn.",
  "Приглашение отправлено; ожидаем принятия.":
    "Invitation sent; waiting for acceptance.",
  "Появление сообщения подтверждено в LinkedIn.":
    "The message is confirmed to appear in LinkedIn.",
  "Действие не выполнено.": "The action was not performed.",
  "Проверьте доступность действия.": "Check that the action is available.",
  "Результат не подтверждён. Повтор для этого человека заблокирован.":
    "Result not confirmed. Retrying for this person is blocked.",
  "Завершите проверку в окне LinkedIn.":
    "Complete the verification in the LinkedIn window.",
  "LinkedIn сообщил о лимите отправки.": "LinkedIn reported a sending limit.",
  "Очередь сохранена. Следующие проверки выполнятся по расписанию. Отдельные профили требуют внимания.":
    "Queue saved. The next checks will run on schedule. Some profiles need attention.",
  "Очередь сохранена. Следующие проверки выполнятся по расписанию.":
    "Queue saved. The next checks will run on schedule.",
  "Кампания приостановлена. Очередь и результаты сохранены.":
    "Campaign paused. Queue and results are saved.",

  // platform_limits.py
  "LinkedIn ограничил действия аккаунта. Кампании приостановлены.":
    "LinkedIn has restricted the account's actions. Campaigns are paused.",
  "Завершите вход или проверку в окне LinkedIn, затем нажмите «Проверить вход».":
    "Finish signing in or the verification in the LinkedIn window, then click “Check sign-in”.",
  "LinkedIn сообщил о лимите отправки. Кампании аккаунта приостановлены.":
    "LinkedIn reported a sending limit. The account's campaigns are paused.",

  // recruiter_browser.py
  "Недопустимый адрес Recruiter.": "Invalid Recruiter address.",
  "Войдите в LinkedIn Recruiter в открытом окне и повторите проверку.":
    "Sign in to LinkedIn Recruiter in the open window and check again.",
  "LinkedIn Recruiter требует включить двухэтапную проверку.":
    "LinkedIn Recruiter requires two-step verification to be turned on.",
  "Выберите нужный контракт Recruiter в окне LinkedIn и повторите проверку.":
    "Choose the right Recruiter contract in the LinkedIn window and check again.",
  "Контракт Recruiter изменился или не подтверждён. Проверьте подключение и план.":
    "The Recruiter contract has changed or is not confirmed. Check the connection and the plan.",
  "Не удалось прочитать остаток кредитов Recruiter.":
    "Could not read the remaining Recruiter credits.",
  "Не удалось подтвердить настройку автоматических текстов Recruiter.":
    "Could not confirm the Recruiter automatic text setting.",
  "Неоднозначная настройка текста Recruiter.":
    "Ambiguous Recruiter text setting.",
  "LinkedIn открыл другой профиль.": "LinkedIn opened a different profile.",
  "Не найден однозначный переход к этому человеку в Recruiter.":
    "No clear link to this person was found in Recruiter.",
  "Профиль Recruiter не совпадает с утверждённым получателем.":
    "The Recruiter profile does not match the approved recipient.",
  "Не удалось найти историю этого профиля в Recruiter.":
    "Could not find this profile's history in Recruiter.",
  "История Recruiter открылась для другого профиля.":
    "The Recruiter history opened for a different profile.",
  "Не удалось подтвердить идентификатор адресата Recruiter. Отправка остановлена.":
    "Could not confirm the Recruiter recipient ID. Sending stopped.",
  "Профиль адресата редактора Recruiter не совпадает с утверждённым получателем.":
    "The recipient profile in the Recruiter editor does not match the approved recipient.",
  "Не найдена однозначная кнопка сообщения в карточке Recruiter.":
    "No clear message button was found on the Recruiter card.",
  "Страница Recruiter изменилась во время проверки адресата.":
    "The Recruiter page changed while the recipient was being checked.",
  "Адресат редактора Recruiter не совпадает с утверждённым профилем. Отправка остановлена.":
    "The recipient in the Recruiter editor does not match the approved profile. Sending stopped.",
  "Проверьте редактор Recruiter: требуется одно сообщение без запланированных продолжений.":
    "Check the Recruiter editor: one message without scheduled follow-ups is required.",
  "В Recruiter уже есть черновик или включён автотекст. Сохраните свой черновик и отключите автоподстановку.":
    "Recruiter already has a draft or automatic text is on. Save your draft and turn off auto-fill.",
  "В Recruiter уже есть переписка с этим человеком.":
    "There is already a Recruiter conversation with this person.",
  "Не подтверждена стоимость платного InMail.":
    "The cost of the paid InMail is not confirmed.",
  "Неизвестный способ оплаты Recruiter. Отправка не разрешена.":
    "Unknown Recruiter payment method. Sending is not allowed.",
  "Проверьте тему и текст InMail.": "Check the InMail subject and text.",
  "Контракт или настройки текста Recruiter изменились.":
    "The Recruiter contract or text settings have changed.",
  "InMail недоступен.": "InMail is unavailable.",
  "Адресат Recruiter не подтверждён для утверждённого профиля.":
    "The Recruiter recipient is not confirmed for the approved profile.",
  "Стоимость или остаток кредитов Recruiter изменились.":
    "The Recruiter cost or remaining credits have changed.",
  "Подпись Recruiter изменилась. Заново проверьте текст перед запуском.":
    "The Recruiter signature has changed. Check the text again before launching.",
  "Подпись Recruiter отсутствует в утверждённом тексте.":
    "The Recruiter signature is missing from the approved text.",
  "Редактор Recruiter занят другим черновиком.":
    "The Recruiter editor is busy with another draft.",
  "Адресат, текст или условия InMail изменились. Отправка отменена.":
    "The InMail recipient, text or terms have changed. Sending was cancelled.",
  "InMail подтверждён в истории Recruiter.":
    "InMail confirmed in the Recruiter history.",
  "Отправка выполнена, но история Recruiter ещё не подтверждена. Проверьте результат перед повтором.":
    "Sent, but the Recruiter history is not confirmed yet. Check the result before retrying.",
  "Recruiter открыл другую переписку.":
    "Recruiter opened a different conversation.",
  "Не совпадает тема открытого диалога Recruiter.":
    "The subject of the opened Recruiter conversation does not match.",
  "Сохранённая переписка Recruiter не найдена. Проверьте её вручную.":
    "The saved Recruiter conversation was not found. Check it manually.",
  "Нельзя однозначно различить участников переписки Recruiter.":
    "The participants of the Recruiter conversation cannot be told apart clearly.",
  "Не удалось однозначно восстановить диалог Recruiter после ручного подтверждения.":
    "Could not clearly restore the Recruiter conversation after manual confirmation.",
  "Исходящее сообщение Recruiter не подтверждено в этом диалоге.":
    "The outgoing Recruiter message is not confirmed in this conversation.",
  "Ответ найден в переписке Recruiter.":
    "A reply was found in the Recruiter conversation.",
  "Ответ в Recruiter пока не обнаружен.": "No reply found in Recruiter yet.",

  // runtime.py
  "Предпросмотр приостановлен пользователем.": "Preview paused by the user.",
  "Браузерный процесс завершился. Повторно подключите аккаунт.":
    "The browser process has exited. Reconnect the account.",
  "Нарушена последовательность операций браузера.":
    "The browser's operation sequence was broken.",
  "Эта операция уже выполняется.": "This operation is already running.",
  "Ожидаем завершения текущей операции браузера…":
    "Waiting for the current browser operation to finish…",
  "Приостановлено пользователем.": "Paused by the user.",
  "Приостанавливаем: ждём завершения текущего действия LinkedIn…":
    "Pausing: waiting for the current LinkedIn action to finish…",
  "Кампания приостановлена пользователем.": "Campaign paused by the user.",
  "LinkedIn не ответил вовремя. Обработка приостановлена. Проверьте страницу в браузере и повторно подключите аккаунт.":
    "LinkedIn did not respond in time. Processing is paused. Check the page in the browser and reconnect the account.",
  "Не удалось запустить служебный процесс браузера. Окно входа не открыто. Обновите приложение или передайте журнал разработчику.":
    "Could not start the browser service process. The sign-in window did not open. Update the app or send the log to the developer.",
  "Аккаунт не готов. Выполните вход.": "The account is not ready. Sign in.",
  "Аккаунт в браузере изменился. Обработка остановлена.":
    "The account in the browser has changed. Processing stopped.",
  "LinkedIn ограничил действия аккаунта. Кампания приостановлена.":
    "LinkedIn has restricted the account's actions. The campaign is paused.",
  "Подключите Recruiter на странице аккаунтов отправителя.":
    "Connect Recruiter on the sender's Accounts page.",
  "Выберите получателей без прежних обращений.":
    "Choose recipients without earlier outreach.",
  "Проверяем Recruiter и подпись для предпросмотра…":
    "Checking Recruiter and the signature for the preview…",
  "Тексты и подпись Recruiter проверены.":
    "Texts and the Recruiter signature are checked.",
  "Проверяем аккаунт отправителя…": "Checking the sender account…",
  "Поиск приостановлен.": "Search paused.",
  "Браузер занят другим действием. Подождите минуту и повторите.":
    "The browser is busy with another action. Wait a minute and try again.",

  // store.py
  "Неизвестная переменная шаблона. Доступны: {name}, {first_name}, {headline}, {company}.":
    "Unknown template variable. Available: {name}, {first_name}, {headline}, {company}.",
  "Проверьте фигурные скобки и переменные в шаблоне.":
    "Check the curly braces and variables in the template.",
  "Сообщение должно содержать от 1 до 1900 символов.":
    "The message must be 1 to 1900 characters long.",
  "Замените [link] настоящей ссылкой.": "Replace [link] with a real link.",
  "В сообщении есть недопустимые управляющие символы.":
    "The message contains invalid control characters.",
  "Приложение завершилось во время отправки. Проверьте диалог.":
    "The app closed while sending. Check the conversation.",
  "Работа приостановлена после перезапуска.": "Work paused after a restart.",
  "Старая очередь закрыта при обновлении приложения. Отправьте через вкладку «Отправка».":
    "The old queue was closed when the app was updated. Send from the “Outreach” tab.",
  "Запись не найдена.": "Record not found.",
  "Этот аккаунт удалён. История сохранена в архиве.":
    "This account has been deleted. History is kept in the archive.",
  "Укажите название аккаунта.": "Enter an account name.",
  "Выполнен вход в другой LinkedIn-профиль. Добавьте его отдельным аккаунтом.":
    "Signed in to a different LinkedIn profile. Add it as a separate account.",
  "Укажите название, ключевые слова и объём от 1 до 100 профилей.":
    "Enter a name, keywords and a size of 1 to 100 profiles.",
  "Служебная запись; подробности сохранены в журнале.":
    "Service entry; details are saved in the log.",
  "Кампания в архиве. Сначала верните её из архива.":
    "The campaign is archived. Restore it from the archive first.",
  "Укажите название кампании (до 150 символов).":
    "Enter a campaign name (up to 150 characters).",
  "Число профилей — от 1 до 100.": "Number of profiles: 1 to 100.",
  "Поиск уже собрал профили, поэтому запрос изменить нельзя. Создайте новую кампанию с другим запросом.":
    "The search has already collected profiles, so the query cannot be changed. Create a new campaign with a different query.",
  "Укажите поисковый запрос (до 1000 символов).":
    "Enter a search query (up to 1000 characters).",
  "Кампания перенесена в архив.": "Campaign moved to the archive.",
  "Кампания в архиве. История сохранена.":
    "Campaign archived. History is saved.",
  "Аккаунт этой кампании удалён. Кампанию можно только просматривать.":
    "This campaign's account was deleted. The campaign is view-only.",
  "Кампания возвращена из архива. Утверждённый ранее план на паузе — продолжите его на вкладке «Отправка».":
    "Campaign restored from the archive. The previously approved plan is paused — resume it on the “Outreach” tab.",
  "Кампания возвращена из архива.": "Campaign restored from the archive.",
  "По этой кампании уже были обращения. Её можно только перенести в архив — история защищает людей от повторных сообщений.":
    "This campaign already has outreach. It can only be archived — the history protects people from repeat messages.",
  "Кампания в архиве. Её история доступна только для чтения.":
    "The campaign is archived. Its history is read-only.",
  "Сначала приостановите обработку кампании.":
    "First pause the campaign's processing.",
  "План остановлен после изменений. Проверьте и подтвердите новый запуск.":
    "The plan stopped after changes. Review and confirm a new launch.",
  "Выбор профиля должен быть переключателем.":
    "Profile selection must be a switch.",
  "Неизвестная группа.": "Unknown group.",
  "Сначала проверьте профиль и выберите группу сообщения.":
    "First check the profile and choose the message group.",
  "Передайте список профилей и переключатель выбора.":
    "Provide the list of profiles and the selection switch.",
  "Все профили должны принадлежать выбранной кампании.":
    "All profiles must belong to the selected campaign.",
  "В выборе есть недоступные профили. Обновите список получателей.":
    "The selection contains unavailable profiles. Refresh the recipient list.",
  "Не контактировать": "Do not contact",
  "Неверный результат отправки.": "Invalid send result.",

  // user_errors.py
  "Не удалось выполнить действие. Попробуйте ещё раз через минуту; если ошибка повторится, перезапустите приложение — данные сохранятся.":
    "Could not complete the action. Try again in a minute; if the error repeats, restart the app — your data will be kept.",
  "Браузер LinkedIn неожиданно закрылся. Запустите действие ещё раз — приложение откроет браузер заново.":
    "The LinkedIn browser closed unexpectedly. Run the action again — the app will reopen the browser.",
  "LinkedIn не ответил вовремя. Проверьте интернет и запустите действие ещё раз.":
    "LinkedIn did not respond in time. Check your internet connection and run the action again.",
  "Нет связи с LinkedIn. Проверьте интернет и запустите действие ещё раз.":
    "No connection to LinkedIn. Check your internet connection and run the action again.",
  "Страница LinkedIn выглядит не так, как ожидалось. Действие остановлено; попробуйте позже.":
    "The LinkedIn page does not look as expected. The action was stopped; try again later.",
  "Ссылка на профиль LinkedIn не распознана. Вставьте полную ссылку вида https://www.linkedin.com/in/…":
    "The LinkedIn profile link was not recognized. Paste a full link like https://www.linkedin.com/in/…",

  // workspace.py
  "Резервные копии недоступны. Проверьте папку данных и свободное место.":
    "Backups are unavailable. Check the data folder and free disk space.",
  "Подключите аккаунт LinkedIn.": "Connect a LinkedIn account.",
  "Этот ответ уже отмечен или больше не доступен.":
    "This reply is already marked or no longer available.",
  "Введите название шаблона до 150 символов.":
    "Enter a template name of up to 150 characters.",
  "Папка резервных копий недоступна.": "The backup folder is unavailable.",
  "Неизвестный тип резервной копии.": "Unknown backup type.",
  "Не удалось проверить резервную копию.": "Could not verify the backup.",
  "Не хватает места на диске или нет доступа к папке данных. Освободите место и повторите — текущие данные не изменены.":
    "Not enough disk space or no access to the data folder. Free up space and try again — current data is unchanged.",
  "Не удалось сохранить автоматическую копию. Проверьте свободное место и доступ к папке данных; создайте копию вручную.":
    "Could not save the automatic backup. Check free space and access to the data folder; create a backup manually.",
  "Эта копия сделана в другой версии приложения и не подходит. Выберите более новую копию.":
    "This backup was made by a different app version and cannot be used. Choose a newer backup.",
  "Выберите существующую резервную копию.": "Choose an existing backup.",
  "Резервная копия повреждена.": "The backup is damaged.",
  "Связи данных резервной копии повреждены.":
    "The backup's data links are damaged.",
  "Защита от повторного контакта после восстановления копии.":
    "Protection against repeat contact after restoring a backup.",
  "Проверьте вход после восстановления резервной копии.":
    "Check the sign-in after restoring the backup.",
  "Восстановлено из копии. Проверьте аккаунт и создайте новый предпросмотр.":
    "Restored from a backup. Check the account and create a new preview.",
  "Восстановлено из копии. Подготовьте новый предпросмотр.":
    "Restored from a backup. Prepare a new preview.",
  "Проверьте результат после восстановления копии.":
    "Check the result after restoring the backup.",
  "Не удалось прочитать резервную копию. Текущие данные сохранены.":
    "Could not read the backup. Current data is kept.",

  // Desktop shell errors that reach the window (desktop/*.cjs)
  "Сервис приложения ещё запускается.": "The app service is still starting.",
  "Операция заняла слишком много времени. Подождите минуту и обновите окно — если действие выполнилось, результат появится сам.":
    "The operation took too long. Wait a minute and refresh the window — if the action went through, the result will appear on its own.",
  "Служба приложения не отвечает. Подождите несколько секунд и повторите; если не поможет — перезапустите Booster Recruiter.":
    "The app service is not responding. Wait a few seconds and try again; if that does not help, restart Booster Recruiter.",
  "Недопустимый источник команды.": "Invalid command source.",
  "Не удалось запустить сервис приложения.": "Could not start the app service.",
  "Команда недоступна.": "Command unavailable.",
  "Настройки ещё загружаются. Попробуйте снова.":
    "Settings are still loading. Try again.",
  "Неверный формат.": "Invalid format.",
  "Разрешены только ссылки LinkedIn.": "Only LinkedIn links are allowed.",
  "Некорректные настройки уведомлений.": "Invalid notification settings.",
  "Не удалось проверить автозапуск в настройках системы.":
    "Could not check launch at login in the system settings.",
  "Автозапуск выключен в настройках Windows. Чтобы включить его, разрешите Booster Recruiter в списке автозагрузки.":
    "Launch at login is turned off in Windows settings. To turn it on, allow Booster Recruiter in the startup apps list.",
  "Автозапуск требует разрешения в macOS. Разрешите Booster Recruiter в настройках входа в систему.":
    "Launch at login needs permission in macOS. Allow Booster Recruiter in Login Items settings.",
  "Система не подтвердила изменение автозапуска. Проверьте настройки входа в систему.":
    "The system did not confirm the launch-at-login change. Check the login items settings.",
  "Автозапуск отличается от предыдущего состояния.":
    "Launch at login differs from its previous state.",
  "Не удалось подтвердить восстановление автозапуска. Проверьте его в настройках системы.":
    "Could not confirm that launch at login was restored. Check it in the system settings.",
  "Не удалось сохранить настройки.": "Could not save the settings.",
  // Sentences joined into the save-failure message above.
  "Не удалось подтвердить восстановление автозапуска.":
    "Could not confirm that launch at login was restored.",
  "Проверьте его в настройках системы.": "Check it in the system settings.",
  "Неизвестная настройка приложения.": "Unknown app setting.",
  "Автозапуск доступен в установленной версии.":
    "Launch at login is available in the installed version.",
  "Сервис не вернул список кампаний.":
    "The service did not return the campaign list.",
  "Сервис не подтвердил запрос паузы.":
    "The service did not confirm the pause request.",
};

export const templates = {
  "Обработка завершена. Подтверждено сообщений в этой сессии: {n}.":
    "Processing finished. Messages confirmed in this session: {n}.",
  "Сохранено {count} профилей. Проверьте группы и выберите получателей.":
    "Saved {count} profiles. Review the groups and choose recipients.",
  // runtime.py collect(): relevance filter and exhausted search
  "Сохранено {count} из {max}. Пропущено несоответствующих запросу: {n}.":
    "Saved {count} of {max}. Skipped as not matching the query: {n}.",
  "Профилей сохранено: {count}.": "Profiles saved: {count}.",
  "Пропущено несоответствующих запросу: {n}.":
    "Skipped as not matching the query: {n}.",
  "LinkedIn больше не находит подходящих профилей по этому запросу (нужно было {max}).":
    "LinkedIn finds no more matching profiles for this query ({max} were requested).",
  "{url} — профиль не соответствует запросу.":
    "{url}: the profile does not match the query.",
  // account_removal.py, outreach.py events
  "Удалён аккаунт {label}; история сохранена в архиве.":
    "Account {label} deleted; history is kept in the archive.",
  "Утверждён план {id}: получатели, тексты, расписание и способы связи.":
    "Plan {id} approved: recipients, texts, schedule and contact methods.",
  // attention_recovery.py
  "Сначала войдите в аккаунт {label} на странице «Аккаунты», затем уточните статус.":
    "First sign in to account {label} on the “Accounts” page, then check the status.",
  // outreach.py
  "Параметр {key}: допустимо от {low} до {high}.":
    "Setting {key}: allowed from {low} to {high}.",
  // outreach_runtime.py
  "Проверяем контакт {index} из {total}…":
    "Checking contact {index} of {total}…",
  "Проверяем: {name}": "Checking: {name}",
  "Не удалось обработать этот профиль. Остальная кампания продолжается. {detail}":
    "Could not process this profile. The rest of the campaign continues. {detail}",
  // platform_limits.py, worker.py: a Russian lead followed by LinkedIn text
  "LinkedIn сообщил о лимите: {notice}": "LinkedIn reported a limit: {notice}",
  "LinkedIn не отдал раздел профиля: {detail}":
    "LinkedIn did not return a profile section: {detail}",
  // runtime.py
  "Страница {page}. Профилей сохранено: {count}.":
    "Page {page}. Profiles saved: {count}.",
  "Сохранено {count} из {max}. Проверяем следующий профиль…":
    "Saved {count} of {max}. Checking the next profile…",
  "Профилей сохранено: {count}. Проверьте группы и выберите получателей.":
    "Profiles saved: {count}. Review the groups and choose recipients.",
  "Браузер занят кампанией «{name}». Поставьте её на паузу или дождитесь завершения и повторите.":
    "The browser is busy with campaign “{name}”. Pause it or wait for it to finish, then try again.",
  // store.py
  "В профиле не заполнено поле {field}. Измените текст или заполните данные.":
    "The profile has no value for {field}. Change the text or fill in the data.",
  // desktop/main.cjs, desktop/preferences.cjs
  "Сервис завершился ({code}).": "The service exited ({code}).",
  // Generic "<lead>: <detail>" joins (events such as "<campaign id>: <reason>").
  "{head}: {tail}": "{head}: {tail}",
};
