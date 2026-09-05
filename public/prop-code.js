const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-HJ-NP-Z2-9]{20}$/;

/** Parse prop identities only. A code is never an instruction to navigate or grant access. */
export function parsePropInput(value, origin, eventId = null) {
  if (typeof value !== "string" || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Enter an ORACLE prop code or prop link.");
  if (eventId !== null && !UUID.test(eventId)) throw new Error("Choose an event before entering a prop code.");
  const input = value.trim();
  const code = input.toUpperCase().replace(/[ -]/g, "");
  if (CODE.test(code)) return { eventId: eventId?.toLowerCase() || null, code };
  try {
    const expected = new URL(origin), url = new URL(input);
    if (!["https:", "http:"].includes(expected.protocol) || url.origin !== expected.origin || url.username || url.password || url.pathname !== "/" || url.search) throw new Error();
    const match = /^#prop\/([^/]+)\/([A-HJ-NP-Z2-9]{20})$/i.exec(url.hash);
    if (match && UUID.test(match[1])) return { eventId: match[1].toLowerCase(), code: match[2].toUpperCase() };
  } catch { /* All invalid or foreign payloads share one useful error. */ }
  throw new Error("Use a prop code or a prop link from this ORACLE site.");
}
