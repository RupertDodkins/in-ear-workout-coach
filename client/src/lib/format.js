export function fmtTime(seconds) {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return "0:00";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtClock(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toTimeString().slice(0, 8);
}
