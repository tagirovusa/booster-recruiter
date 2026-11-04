function createPauseAllHandler({ call, report }) {
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
          throw Error("Сервис не вернул список кампаний.");
        campaigns = state.campaigns;
      } catch (error) {
        await report({
          type: "error",
          title: "Пауза не подтверждена",
          message: "Не удалось получить список кампаний и запросить паузу.",
          detail: `Работа кампаний могла продолжиться. Проверьте состояние в приложении. Чтобы остановить приложение полностью, выберите «Завершить работу» в меню его значка.\n\nТехнические подробности: ${error.message}`,
        });
        return;
      }
      if (!campaigns.length) {
        await report({
          type: "info",
          title: "Нет кампаний",
          message: "Кампаний для приостановки пока нет.",
        });
        return;
      }
      let requested = 0;
      const failures = [];
      for (const campaign of campaigns) {
        try {
          const result = await call("campaign.pause", { id: campaign.id });
          if (result?.pause_requested !== true)
            throw Error("Сервис не подтвердил запрос паузы.");
          requested++;
        } catch (error) {
          failures.push(`${campaign.name || campaign.id}: ${error.message}`);
        }
      }
      const incomplete = failures.length > 0;
      await report({
        type: incomplete ? (requested ? "warning" : "error") : "info",
        title: incomplete
          ? "Пауза не подтверждена для всех кампаний"
          : "Пауза запрошена",
        message: incomplete
          ? `Запрос паузы подтверждён для ${requested} из ${campaigns.length} кампаний.`
          : `Пауза запрошена для всех кампаний: ${requested}.`,
        detail: [
          requested
            ? "Уже начатое действие LinkedIn может завершиться. Следующие действия в этих кампаниях остановлены до возобновления."
            : "Работа кампаний могла продолжиться.",
          incomplete
            ? "Проверьте оставшиеся кампании в приложении. При необходимости полностью остановите приложение через «Завершить работу» в меню его значка."
            : "Статус и результат текущего действия можно проверить в приложении.",
          ...(incomplete ? ["Не удалось подтвердить паузу:", ...failures] : []),
        ].join("\n\n"),
      });
    } finally {
      running = false;
      if (menuItem) menuItem.enabled = true;
    }
  };
}

module.exports = { createPauseAllHandler };
