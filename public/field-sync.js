// Every transmission is an explicit user action. There is no reconnect listener,
// background worker, automatic retry, confirmation, trade, or payload repair.
const fail = (message, status = 409) => { const error = new Error(message); error.status = status; throw error; };
const assetFree = side => !(side?.assets?.items?.length || side?.assets?.resources?.length);
const safeId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function createFieldSync({ api, store, isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false }) {
  if (typeof api !== 'function' || !store) throw new Error('Field sync requires the authenticated API and scoped local store.');
  let generation = 0;
  const active = new Set();
  async function send(id) {
    if (!isOnline()) fail('Reconnect before reviewing and sending this request.');
    if (active.has(id)) fail('This request is already being reviewed or sent.');
    active.add(id);
    let claim = null, attempted = false;
    const epoch = generation;
    try {
      claim = await store.claimRequest(id);
      const { request, scope, leaseToken } = claim, options = { expectedAccount: scope.accountId };
      const current = async () => {
        if (epoch !== generation) fail('The send review was closed. Review the queued request before trying again.');
        if (!isOnline()) fail('Connection was lost during the send review.', 503);
        return store.assertLease(id, leaseToken, scope);
      };
      await current();
      const session = await api('/api/session', 'GET', undefined, options);
      await current();
      if (!session?.user || session.user.id !== scope.accountId) fail('Sign in as the account that saved this request, then review current information.', 401);
      const base = `/api/events/${request.eventId}/exchanges`, query = `?${new URLSearchParams({ characterId: request.characterId })}`;
      const overview = await api(`${base}${query}`, 'GET', undefined, options);
      await current();
      if (overview?.event?.id !== request.eventId || overview?.character?.id !== request.characterId || overview.readOnly !== false || !['live', 'rehearsal'].includes(overview.event.status)) fail('This own character or event is no longer available for information exchanges. Review current access before creating another request.');
      let path = base, method = 'POST', body = { requestId: request.requestId, characterId: request.characterId, informationOnly: true };
      if (request.kind === 'join') { path += '/join'; body.code = request.payload.code; }
      else if (request.kind === 'offer') {
        const detail = await api(`${base}/${request.payload.exchangeId}${query}`, 'GET', undefined, options);
        await current();
        const exchange = detail?.exchange;
        if (exchange?.id !== request.payload.exchangeId || exchange?.character?.id !== request.characterId || exchange?.event?.id !== request.eventId || !['waiting', 'negotiating'].includes(exchange.status) || exchange.readOnly || exchange.blockedReason && exchange.status !== 'waiting' || !assetFree(exchange.own) || !assetFree(exchange.partner)) fail('This exchange changed or includes assets. Review it online; queued requests can offer information only.');
        if (!request.attemptedAt && exchange.version !== request.payload.version) fail('The exchange terms changed. Discard this unsent offer and review the current terms before creating another.');
        if (Number.isFinite(Date.parse(exchange.expiresAt)) && Date.parse(exchange.expiresAt) <= (Date.parse(exchange.serverTime) || Date.now())) fail('This exchange invitation expired. Review current information before creating another request.');
        if (!request.attemptedAt && request.payload.readingIds.some(readingId => !(overview.readings || []).some(reading => reading.id === readingId && reading.shareable === true))) fail('A selected reading is no longer available for sharing. Review the current permitted journal.');
        path += `/${request.payload.exchangeId}/offer`; method = 'PUT'; body = { ...body, version: request.payload.version, readingIds: [...request.payload.readingIds] };
      } else if (request.kind !== 'create') fail('This request kind cannot be sent from local storage.');
      await current();
      await store.beginTransmission(id, leaseToken, scope); attempted = true;
      // beginTransmission and cancellation serialize in IndexedDB. A pending
      // cancellation wins before this point or is truthfully marked uncertain.
      const result = await api(path, method, body, options);
      if (epoch !== generation) fail('The send review closed before the confirmed result could be shown.', 503);
      const exchange = result?.exchange;
      if (!safeId(exchange?.id) || exchange?.event?.id !== request.eventId || exchange?.character?.id !== request.characterId) fail('The server response could not be verified. Retry the original request after reviewing its current state.', 503);
      const saved = await store.markRequest(id, { scope, leaseToken, state: 'completed', message: 'The server confirmed this information-only request. Review the live exchange before any further action.' });
      return { request: saved, result };
    } catch (error) {
      if (claim) {
        const wasAttempted = attempted || Boolean(claim.request.attemptedAt), definitive = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
        const state = definitive ? 'needs_review' : wasAttempted ? 'uncertain' : 'pending';
        const message = definitive ? wasAttempted ? 'Current access, terms, or policy needs review. The server may have received the earlier request; inspect the live exchange before creating another.' : 'The current account, character, terms, or policy needs review. This request was not transmitted.' : wasAttempted ? 'No confirmed server response. Review and retry using this original request identifier; it may already have been received.' : 'The connection check did not finish. This request remains local and was not transmitted.';
        try { await store.markRequest(id, { scope: claim.scope, leaseToken: claim.leaseToken, state, message }); } catch { /* Scope clearing, cancellation, or a newer lease always wins. */ }
      }
      throw error;
    } finally { active.delete(id); }
  }
  return { send, reset() { generation++; }, get busy() { return active.size > 0; } };
}
