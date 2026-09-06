const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-HJ-NP-Z2-9]{20}$/;

/** A printed instrument identity is data, never a navigation instruction. */
export function parseInstrumentInput(value, origin, kind, eventId = null) {
  if (!['sigil', 'static'].includes(kind)) throw new Error('Choose a supported field instrument.');
  if (typeof value !== 'string' || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Enter an ORACLE ${kind.toUpperCase()} code or link.`);
  if (eventId !== null && (typeof eventId !== 'string' || !UUID.test(eventId))) throw new Error('Choose an event before entering a printed code.');
  const input = value.trim(), code = input.toUpperCase().replace(/[ -]/g, '');
  if (CODE.test(code)) return { eventId: eventId?.toLowerCase() || null, code };
  try {
    const expected = new URL(origin), url = new URL(input);
    if (!['https:', 'http:'].includes(expected.protocol) || url.origin !== expected.origin || url.username || url.password || url.pathname !== '/' || url.search) throw new Error();
    const match = new RegExp(`^#${kind}/([^/]+)/([A-HJ-NP-Z2-9]{20})$`, 'i').exec(url.hash);
    if (match && UUID.test(match[1])) return { eventId: match[1].toLowerCase(), code: match[2].toUpperCase() };
  } catch { /* Reject foreign links and other instruments with the same useful message. */ }
  throw new Error(`Use a ${kind.toUpperCase()} code or link from this ORACLE site.`);
}
