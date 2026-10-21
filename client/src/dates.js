// YYYY-MM-DD for n days from now, using the browser's LOCAL date components
// (not toISOString, which is UTC and drifts a day off in the evening/small
// hours depending on the visitor's timezone) — the server's forecast-existence
// check remains the authoritative gate; this only constrains the date pickers.
export function isoDaysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
