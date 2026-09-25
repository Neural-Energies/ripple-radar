const ET = "America/New_York";

export function etParts(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hourRaw = pick("hour");
  const minuteRaw = pick("minute");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return {
    weekday: pick("weekday"),
    hour,
    minute,
    second: Number(pick("second")),
    hm: hour + minute / 60,
    date: `${pick("day")} ${pick("month")}`,
    time: `${hourRaw}:${minuteRaw}`,
    label: `${pick("day")} ${pick("month")} ${pick("year")} · ${hourRaw}:${minuteRaw} ET`,
    clock: `${hourRaw}:${minuteRaw}:${pick("second")} ET`,
  };
}

export function sessionFlags(ms = Date.now()) {
  const { weekday, hm } = etParts(ms);
  const weekend = weekday === "Sat" || weekday === "Sun";
  const ny = !weekend && hm >= 9.5 && hm < 16;
  const london = !weekend && hm >= 3 && hm < 11.5;
  const tokyo = weekday === "Sun" ? hm >= 19 : weekday === "Sat" ? false : hm >= 19 || hm < 2;
  const futures =
    (weekday === "Sun" && hm >= 18) ||
    (weekday === "Fri" && hm < 17) ||
    (!weekend && !(hm >= 17 && hm < 18));
  return { ny, london, tokyo, futures };
}

export function quoteState(asOf: number, now = Date.now()): "live" | "last" | "stale" {
  const age = now - asOf;
  if (age < 20 * 60 * 1000) return "live";
  if (age < 26 * 60 * 60 * 1000) return "last";
  return "stale";
}
