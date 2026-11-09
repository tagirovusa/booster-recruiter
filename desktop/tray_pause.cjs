// Russian wording by default; the desktop shell passes its translator.
const fill = (text, vars = {}) =>
  text.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.hasOwn(vars, key) ? String(vars[key]) : whole,
  );

function createPauseAllHandler({ call, report, t = fill }) {
  let running = false;
  return async function pauseAll(menuItem) {
    if (running) return;
    running = true;
    if (menuItem) menuItem.enabled = false;
    try {
      let campaigns;
      try {
        const state = await call("state");
        if (!Array.isArray(state?.campaigns))
          throw Error(t("Сервис не вернул список кампаний."));
        campaigns = state.campaigns;
      } catch (error) {
        await report({
          type: "error",
          title: t("Пауза не подтверждена"),
          message: t("Не удалось получить список кампаний и запросить паузу."),
          detail: t(
            "Работа кампаний могла продолжиться. Проверьте состояние в приложении. Чтобы остановить приложение полностью, выберите «Завершить работу» в меню его значка.\n\nТехнические подробности: {detail}",
            { detail: error.message },
          ),
        });
        return;
      }
      if (!campaigns.length) {
        await report({
          type: "info",
          title: t("Нет кампаний"),
          message: t("Кампаний для приостановки пока нет."),
        });
        return;
      }
      let requested = 0;
      const failures = [];
      for (const campaign of campaigns) {
        try {
          const result = await call("campaign.pause", { id: campaign.id });
          if (result?.pause_requested !== true)
            throw Error(t("Сервис не подтвердил запрос паузы."));
          requested++;
        } catch (error) {
          failures.push(`${campaign.name || campaign.id}: ${error.message}`);
        }
      }
      const incomplete = failures.length > 0;
      await report({
        type: incomplete ? (requested ? "warning" : "error") : "info",
        title: incomplete
          ? t("Пауза не подтверждена для всех кампаний")
          : t("Пауза запрошена"),
        message: incomplete
          ? t("Запрос паузы подтверждён для {requested} из {total} кампаний.", {
              requested,
              total: campaigns.length,
            })
          : t("Пауза запрошена для всех кампаний: {requested}.", { requested }),
        detail: [
          requested
            ? t(
                "Уже начатое действие LinkedIn может завершиться. Следующие действия в этих кампаниях остановлены до возобновления.",
              )
            : t("Работа кампаний могла продолжиться."),
          incomplete
            ? t(
                "Проверьте оставшиеся кампании в приложении. При необходимости полностью остановите приложение через «Завершить работу» в меню его значка.",
              )
            : t(
                "Статус и результат текущего действия можно проверить в приложении.",
              ),
          ...(incomplete
            ? [t("Не удалось подтвердить паузу:"), ...failures]
            : []),
        ].join("\n\n"),
      });
    } finally {
      running = false;
      if (menuItem) menuItem.enabled = true;
    }
  };
}

module.exports = { createPauseAllHandler };
