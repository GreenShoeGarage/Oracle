const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-HJ-NP-Z2-9]{12}$/;

/** Parse an exchange invitation; this never navigates, accepts, or transfers anything. */
export function parseExchangeInput(value, origin, eventId = null) {
  if (typeof value !== "string" || value.length > 1024 || /[\x00-\x1f\x7f\\]/.test(value)) throw new Error("Enter an ORACLE exchange code or exchange link.");
  if (eventId !== null && (typeof eventId !== "string" || !UUID.test(eventId))) throw new Error("Choose an event before entering an exchange code.");
  const input = value.trim();
  const code = input.toUpperCase().replace(/[ -]/g, "");
  if (CODE.test(code)) return { eventId: eventId?.toLowerCase() || null, code };
  try {
    const expected = new URL(origin), url = new URL(input);
    if (!["https:", "http:"].includes(expected.protocol) || url.origin !== expected.origin || url.username || url.password || url.pathname !== "/" || url.search) throw new Error();
    // Match the original input, too: URL normalization must not silently accept
    // dot paths, empty query delimiters, encoded codes, or extra path segments.
    const match = /^[a-z]+:\/\/[^/?#]+\/#exchange\/([^/]+)\/([A-HJ-NP-Z2-9]{12})$/i.exec(input);
    if (match && UUID.test(match[1])) return { eventId: match[1].toLowerCase(), code: match[2].toUpperCase() };
  } catch { /* Invalid and foreign payloads share one user-facing explanation. */ }
  throw new Error("Use a 12-character exchange code or an exchange link from this ORACLE site.");
}
