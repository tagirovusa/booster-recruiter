// Shared Russian wording helpers for every screen.
const rules = new Intl.PluralRules("ru");

// plural(3, ["кандидат", "кандидата", "кандидатов"]) → "кандидата"
export function plural(count, [one, few, many]) {
  const form = rules.select(count);
  return form === "one"
    ? one
    : form === "few"
      ? few
      : form === "many"
        ? many
        : few;
}
