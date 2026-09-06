import { randomUUID, randomInt, createHash } from "node:crypto";
import { validateExchangeRequest, EXCHANGE_CODE_ALPHABET } from "../public/exchange-model.js";
import { defaultCharacterSettings, projectCharacter } from "../public/characters-model.js";
import { readSharing, sharingPolicyFor } from "./sharing.js";
import { canShareWhisper, filterStoryJournal } from "./story.js";
import { limit } from "./security.js";
import { readEconomyAssets, resolveTradeAssets, transferEconomyAssets } from "./economy.js";
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const emptyAssets = () => ({ items: [], resources: [], valid: true });

const pending = (row) => ["waiting", "negotiating"].includes(row.status);
const playable = (event) => ["live", "rehearsal"].includes(event.status);
const expired = (row) => pending(row) && new Date(row.expires_at) <= new Date(row.server_time);
const shortCode = () => Array.from({ length: 12 }, () => EXCHANGE_CODE_ALPHABET[randomInt(EXCHANGE_CODE_ALPHABET.length)]).join("");
const brief = (character) => ({ id: character.id, name: character.profile.name });
const sideFor = (row, userId, characterId) => row.initiator_user_id === userId && row.initiator_character_id === characterId ? "initiator" : row.recipient_user_id === userId && row.recipient_character_id === characterId ? "recipient" : null;
const otherSide = (side) => side === "initiator" ? "recipient" : "initiator";
const enabledNode = (event, node) => node && event.setup.enabledInstruments.includes(node.type === "dead_drop" ? "dead-drop" : node.type);

export function createExchangeHandler({ pool, config, helpers }) {
  const { body, send, fail, identifier, membership, audit, transaction } = helpers;
  const lostCharacter = () => fail(404, "Character not found or not assigned to you.");
  const notFound = () => fail(404, "Exchange not found.");
  async function clock(db) { return (await db.query("SELECT clock_timestamp() AS time")).rows[0].time; }
  async function getSession(db, eventId, id, lock = false) {
    const row = (await db.query(`SELECT *,clock_timestamp() AS server_time FROM exchange_sessions WHERE event_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`, [eventId, id])).rows[0];
    if (!row) notFound(); return row;
  }
  async function participant(db, eventId, userId, characterId) {
    if (!userId || !characterId) return null;
    const row = (await db.query("SELECT c.*,u.is_disabled,u.is_superuser,EXISTS(SELECT 1 FROM memberships m WHERE m.event_id=c.event_id AND m.user_id=u.id) AS member FROM characters c JOIN users u ON u.id=$2 WHERE c.event_id=$1 AND c.id=$3 AND c.user_id=u.id", [eventId, userId, characterId])).rows[0];
    return row ? { character: row, enabled: !row.is_disabled && (row.is_superuser || row.member), eligible: !row.is_disabled && (row.is_superuser || row.member) && row.status === "approved" } : null;
  }
  async function ownCharacter(db, event, user, id) {
    if (!id) {
      const row = (await db.query("SELECT id FROM characters WHERE event_id=$1 AND user_id=$2 AND status='approved' ORDER BY created_at,id LIMIT 1", [event.id, user.id])).rows[0];
      if (!row) return null; id = row.id;
    }
    const found = await participant(db, event.id, user.id, identifier(id));
    if (!found || !found.enabled) lostCharacter(); return found;
  }
  async function lockUsers(db, ids) {
    await db.query("SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE", [[...new Set(ids.filter(Boolean))].sort()]);
  }
  async function projectionContext(db, event) {
    const row = (await db.query("SELECT * FROM event_character_settings WHERE event_id=$1", [event.id])).rows[0];
    const settings = row ? { publicFields: row.public_fields } : defaultCharacterSettings();
    const factions = (await db.query("SELECT id,name FROM factions WHERE event_id=$1", [event.id])).rows;
    const adventure = (await db.query("SELECT definition FROM event_adventures WHERE event_id=$1", [event.id])).rows[0];
    return { settings, factions, definition: adventure?.definition || { nodes: [] }, sharing: await readSharing(db, event.id) };
  }
  function identity(character, context) {
    const safe = projectCharacter(character, context.settings, "public", context.factions);
    return { id: safe.id, profile: safe.profile };
  }
  async function offerRows(db, event, characterId, ids, context, strict = true) {
    const resolved = [];
    const characterOwner = characterId ? (await db.query("SELECT user_id FROM characters WHERE event_id=$1 AND id=$2", [event.id, characterId])).rows[0]?.user_id : null;
    for (const id of ids) {
      const row = (await db.query("SELECT j.*,COALESCE(p.origin_journal_id,j.id) AS origin_id FROM adventure_journal j LEFT JOIN exchange_copies p ON p.journal_id=j.id AND p.event_id=j.event_id WHERE j.event_id=$1 AND j.character_id=$2 AND j.id=$3", [event.id, characterId, id])).rows[0];
      if (!row || !(await filterStoryJournal(db, event.id, characterOwner, [row])).length) { if (strict) fail(404, "An offered reading was not found in this character's journal."); resolved.push({ id, title: "Unavailable reading", type: "unavailable", valid: false }); continue; }
      const original = row.origin_id === row.id ? row : (await db.query("SELECT * FROM adventure_journal WHERE event_id=$1 AND id=$2", [event.id, row.origin_id])).rows[0];
      const node = original && context.definition.nodes.find((entry) => entry.id === original.node_id);
      const whisper = original?.type === "whisper";
      const policy = whisper ? await canShareWhisper(db, event, original.node_id) ? "shareable" : "restricted" : sharingPolicyFor(context.sharing, original?.node_id || row.node_id);
      const valid = !!original && row.type !== "exchange_receipt" && original.type !== "exchange_receipt" && (whisper || !!enabledNode(event, node)) && policy === "shareable";
      if (!valid && strict) fail(403, "An offered reading is no longer permitted for sharing. Update the offer before confirming.");
      if (valid && (typeof original.title !== "string" || original.title.length > 250 || typeof original.text !== "string" || original.text.length > 12250 || (original.audio !== null && typeof original.audio !== "string"))) fail(409, "An offered reading does not fit the supported journal format.");
      resolved.push({ id: row.id, title: row.title, type: row.type, valid, policy, original, originId: row.origin_id });
    }
    if (strict && new Set(resolved.map((row) => row.originId)).size !== resolved.length) fail(400, "The same original reading cannot be offered twice.");
    return resolved;
  }
  async function offers(db, event, row, context, strict = true) {
    const first = await offerRows(db, event, row.initiator_character_id, row.initiator_offer, context, strict);
    const second = await offerRows(db, event, row.recipient_character_id, row.recipient_offer, context, strict);
    const originals = [...first, ...second].filter((entry) => entry.valid).map((entry) => ({ title: entry.original.title, text: entry.original.text, audio: entry.original.audio }));
    if (Buffer.byteLength(JSON.stringify(originals), "utf8") > 2_000_000) fail(409, "The combined exchange is too large. Offer fewer readings (at most 2 MB total).");
    return { initiator: first, recipient: second };
  }
  async function tradeOffers(db, event, row, strict = true) {
    const saved = (await db.query("SELECT side,snapshot FROM exchange_trade_offers WHERE event_id=$1 AND exchange_id=$2", [event.id, row.id])).rows;
    const result = {};
    for (const side of ["initiator", "recipient"]) {
      const snapshot = saved.find(entry => entry.side === side)?.snapshot || emptyAssets();
      result[side] = row.status === "completed" ? { ...snapshot, valid: true } : await resolveTradeAssets(db, event, row[`${side}_character_id`], snapshot, { strict });
    }
    return result;
  }
  async function detail(db, event, user, character, row, context = null) {
    const side = sideFor(row, user.id, character.id); if (!side) notFound();
    context ||= await projectionContext(db, event);
    const peerSide = otherSide(side), own = await participant(db, event.id, user.id, character.id), peer = await participant(db, event.id, row[`${peerSide}_user_id`], row[`${peerSide}_character_id`]);
    if (!own?.enabled) lostCharacter();
    let status = expired(row) ? "expired" : row.status;
    let blockedReason = null;
    if (pending(row) && status !== "expired" && (!own.eligible || (row.recipient_user_id && !peer?.eligible))) { status = "unavailable"; blockedReason = "A participant is no longer eligible. Both players must still own their approved characters and have event access."; }
    let resolved;
    try { resolved = await offers(db, event, row, context, false); } catch (error) { if (!error.status) throw error; blockedReason ||= error.message; resolved = { initiator: [], recipient: [] }; }
    if (pending(row) && !blockedReason && [...resolved.initiator, ...resolved.recipient].some((entry) => !entry.valid)) blockedReason = "An offered reading is no longer shareable. Update the offer; both players will need to confirm again.";
    const assets = await tradeOffers(db, event, row, false);
    if (pending(row) && !assets.initiator.valid || pending(row) && !assets.recipient.valid) blockedReason ||= "An offered asset changed or is unavailable. Update the offer; both players will need to confirm again.";
    if (status === "expired") blockedReason = "This invitation has expired. Create a new exchange.";
    else if (pending(row) && !playable(event)) blockedReason ||= "Exchanges can be confirmed only while the event is live or in rehearsal.";
    else if (status === "waiting") blockedReason ||= "Waiting for the other player to join.";
    const metadata = (entries, owner) => entries.map((entry) => ({ id: entry.id, title: owner || entry.valid || row.status === "completed" ? entry.title : "Unavailable reading", type: owner || entry.valid || row.status === "completed" ? entry.type : "unavailable" }));
    const receipt = row.status === "completed" ? (await db.query("SELECT receipt FROM exchange_receipts WHERE exchange_id=$1 AND event_id=$2 AND owner_user_id=$3 AND owner_character_id=$4", [row.id, event.id, user.id, character.id])).rows[0]?.receipt || null : null;
    const cancellable = pending(row) && !expired(row) && event.status !== "archived";
    return { id: row.id, event: { id: event.id, name: event.name, status: event.status }, character: brief(character), status, version: row.version, expiresAt: row.expires_at, serverTime: row.server_time, updatedAt: row.updated_at, code: side === "initiator" && status === "waiting" ? row.code : null, own: { character: identity(own.character, context), offered: metadata(resolved[side], true), assets: assets[side], confirmed: row[`${side}_confirmed_version`] === row.version }, partner: peer?.eligible ? { character: identity(peer.character, context), offered: metadata(resolved[peerSide], false), assets: assets[peerSide], confirmed: row[`${peerSide}_confirmed_version`] === row.version } : null, readOnly: !pending(row) || status === "expired" || status === "unavailable" || !playable(event) || !own.eligible, blockedReason, receipt, canCancel: cancellable, canReject: cancellable && side === "recipient" };
  }
  async function overview(db, event, user, own) {
    const characters = (await db.query("SELECT id,profile FROM characters WHERE event_id=$1 AND user_id=$2 AND status='approved' ORDER BY created_at,id", [event.id, user.id])).rows.map(brief);
    const result = { event: { id: event.id, name: event.name, status: event.status }, character: own ? brief(own.character) : null, characters, readOnly: !own?.eligible || !playable(event), readings: [], sessions: [], contacts: [], ...(await readEconomyAssets(db, event.id, own?.character.id)) };
    if (!own) return { ...result, message: "Choose an approved character before exchanging introductions or readings." };
    const character = own.character, context = await projectionContext(db, event);
    const readingRows = (await db.query("SELECT id,node_id,title,type FROM adventure_journal WHERE event_id=$1 AND character_id=$2 AND type<>'exchange_receipt' ORDER BY created_at DESC,id DESC LIMIT 500", [event.id, character.id])).rows;
    const readings = await filterStoryJournal(db, event.id, user.id, readingRows);
    result.readings = await Promise.all(readings.map(async (entry) => {
      const node = context.definition.nodes.find((node) => node.id === entry.node_id), whisper = entry.node_id.startsWith("whisper:");
      const policy = whisper ? await canShareWhisper(db, event, entry.node_id) ? "shareable" : "restricted" : sharingPolicyFor(context.sharing, entry.node_id);
      return { id: entry.id, nodeId: entry.node_id, title: entry.title, type: entry.type, policy, shareable: own.eligible && playable(event) && (whisper || !!enabledNode(event, node)) && policy === "shareable" };
    }));
    const rows = (await db.query("SELECT *,clock_timestamp() AS server_time FROM exchange_sessions WHERE event_id=$1 AND ((initiator_user_id=$2 AND initiator_character_id=$3) OR (recipient_user_id=$2 AND recipient_character_id=$3)) ORDER BY updated_at DESC,id DESC LIMIT 50", [event.id, user.id, character.id])).rows;
    // A history refresh projects metadata only. It must not deserialize every
    // completed receipt or historic audio body just to display recent sessions.
    for (const row of rows) {
      const side = sideFor(row, user.id, character.id), other = otherSide(side);
      const peer = await participant(db, event.id, row[`${other}_user_id`], row[`${other}_character_id`]);
      const status = expired(row) ? "expired" : pending(row) && (!own.eligible || (row.recipient_user_id && !peer?.eligible)) ? "unavailable" : row.status;
      result.sessions.push({ id: row.id, status, version: row.version, expiresAt: row.expires_at, updatedAt: row.updated_at, partner: peer?.eligible ? identity(peer.character, context) : null, ownConfirmed: row[`${side}_confirmed_version`] === row.version, partnerConfirmed: peer?.eligible && row[`${other}_confirmed_version`] === row.version || false });
    }
    const contacts = (await db.query("SELECT * FROM exchange_contacts WHERE event_id=$1 AND owner_user_id=$2 AND owner_character_id=$3 ORDER BY met_at DESC,id DESC LIMIT 200", [event.id, user.id, character.id])).rows;
    for (const contact of contacts) { const peer = await participant(db, event.id, contact.peer_user_id, contact.peer_character_id); result.contacts.push({ id: contact.id, character: peer?.eligible ? identity(peer.character, context) : null, metAt: contact.met_at }); }
    return result;
  }
  async function checkActiveLimit(db, event, user) {
    const count = (await db.query("SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1 AND (initiator_user_id=$2 OR recipient_user_id=$2) AND status IN('waiting','negotiating') AND expires_at>clock_timestamp()", [event.id, user.id])).rows[0].n;
    if (count >= 5) fail(429, "You already have five active exchanges in this event. Close one before starting another.");
  }
  async function copyReading(db, event, session, senderCharacter, recipientCharacter, entry) {
    const original = entry.original;
    const existing = (await db.query("SELECT j.* FROM adventure_journal j WHERE j.event_id=$1 AND j.character_id=$2 AND (j.id=$3 OR j.id IN(SELECT journal_id FROM exchange_copies WHERE event_id=$1 AND recipient_character_id=$2 AND origin_journal_id=$3)) LIMIT 1", [event.id, recipientCharacter, entry.originId])).rows[0];
    if (existing) {
      const recipientUser = session.initiator_character_id === recipientCharacter ? session.initiator_user_id : session.recipient_user_id;
      const alreadyKnown = (await filterStoryJournal(db, event.id, recipientUser, [existing])).length > 0;
      // A confirmed receipt grants the new assignee access to an existing
      // immutable whisper copy without changing its original provenance.
      return { id: existing.id, title: existing.title, text: existing.text, audio: existing.audio, type: existing.type, alreadyKnown };
    }
    const id = randomUUID();
    await db.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,audio,type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'shared_reading')", [id, event.id, recipientCharacter, original.node_id, `exchange-reading:${entry.originId}`, original.title, original.text, original.audio]);
    await db.query("INSERT INTO exchange_copies(event_id,recipient_character_id,origin_journal_id,journal_id,exchange_id,sender_character_id) VALUES($1,$2,$3,$4,$5,$6)", [event.id, recipientCharacter, entry.originId, id, session.id, senderCharacter]);
    return { id, title: original.title, text: original.text, audio: original.audio, type: "shared_reading", alreadyKnown: false };
  }
  async function complete(db, event, user, row, context) {
    const resolved = await offers(db, event, row, context, true);
    const assets = await tradeOffers(db, event, row, true);
    const participants = [];
    for (const side of ["initiator", "recipient"]) {
      const party = await participant(db, event.id, row[`${side}_user_id`], row[`${side}_character_id`]);
      if (!party?.eligible) fail(409, "A participant is no longer eligible for this exchange.");
      participants.push({ characterId: party.character.id, userId: row[`${side}_user_id`], name: party.character.profile.name });
    }
    const economyReceipt = await transferEconomyAssets(db, event, {
      kind: "exchange", actorUserId: user.id, referenceId: row.id, participants,
      transfers: ["initiator", "recipient"].map(side => ({ fromCharacterId: row[`${side}_character_id`], toCharacterId: row[`${otherSide(side)}_character_id`], items: assets[side].items.map(({itemId,quantity,version}) => ({itemId,quantity,version})), resources: assets[side].resources.map(({resourceId,quantity}) => ({resourceId,quantity})) }))
    });
    const completedAt = new Date(await clock(db)).toISOString();
    if (new Date(row.expires_at) <= new Date(completedAt)) fail(409, "This exchange has expired.");
    for (const side of ["initiator", "recipient"]) {
      const other = otherSide(side), received = [];
      for (const entry of resolved[other]) received.push(await copyReading(db, event, row, row[`${other}_character_id`], row[`${side}_character_id`], entry));
      const sent = resolved[side].map((entry) => ({ title: entry.title }));
      const peer = await participant(db, event.id, row[`${other}_user_id`], row[`${other}_character_id`]);
      const partnerName = peer.character.profile.name;
      const assetDirection = characterId => {
        const transfer = economyReceipt?.transfers.find(entry => entry.fromCharacterId === characterId);
        return { items: transfer?.items || [], resources: transfer?.resources || [] };
      };
      const receipt = { completedAt, partnerName, sent, received, introduced: true, assets: { sent: assetDirection(row[`${side}_character_id`]), received: assetDirection(row[`${other}_character_id`]), transactionId: economyReceipt?.id || null } };
      await db.query("INSERT INTO exchange_receipts(exchange_id,event_id,owner_user_id,owner_character_id,receipt) VALUES($1,$2,$3,$4,$5)", [row.id, event.id, row[`${side}_user_id`], row[`${side}_character_id`], JSON.stringify(receipt)]);
      await db.query("INSERT INTO exchange_contacts(id,event_id,owner_user_id,owner_character_id,peer_user_id,peer_character_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(event_id,owner_user_id,owner_character_id,peer_user_id,peer_character_id) DO NOTHING", [randomUUID(), event.id, row[`${side}_user_id`], row[`${side}_character_id`], row[`${other}_user_id`], row[`${other}_character_id`]]);
      const lines = ["Both players confirmed this introduction, these readings, and the listed assets.", `With: ${partnerName}`, "", `Sent (${sent.length}):`, ...sent.map((entry) => `- ${entry.title}`), "", `Received (${received.length}):`, ...received.map((entry) => `- ${entry.title} (${entry.alreadyKnown ? "already known" : "new reading"})`)];
      if (economyReceipt) for (const direction of ["sent", "received"]) lines.push("", `${direction === "sent" ? "Sent" : "Received"} assets:`, ...receipt.assets[direction].items.map(item => `- ${item.quantity} × ${item.name}`), ...receipt.assets[direction].resources.map(resource => `- ${resource.quantity} ${resource.name}`));
      await db.query("INSERT INTO adventure_journal(id,event_id,character_id,node_id,entry_key,title,text,audio,type) VALUES($1,$2,$3,'exchange',$4,'Exchange receipt',$5,NULL,'exchange_receipt')", [randomUUID(), event.id, row[`${side}_character_id`], `exchange-receipt:${row.id}`, lines.join("\n")]);
    }
    await db.query("UPDATE exchange_sessions SET status='completed',completed_at=$2,updated_at=clock_timestamp() WHERE id=$1", [row.id, completedAt]);
    await audit(db, event.id, user.id, "exchange.completed", { exchangeId: row.id, version: row.version, initiatorCount: resolved.initiator.length, recipientCount: resolved.recipient.length });
    return await getSession(db, event.id, row.id);
  }

  return async function handleExchanges({ req, res, path, url, method, user }) {
    const match = /^\/api\/events\/([^/]+)\/exchanges(?:\/([^/]+))?(?:\/(offer|confirm|cancel|reject))?$/.exec(path);
    if (!match) return false;
    if (!user) fail(401, "Sign in to continue.");
    const eventId = identifier(match[1]).toLowerCase(), target = match[2], action = match[3] || (target === "join" ? "join" : !target ? "create" : null);
    if (method === "GET") {
      if (match[3] || target === "join") fail(405, "Method not allowed.");
      const event = await membership(pool, eventId, user.id), own = await ownCharacter(pool, event, user, url.searchParams.get("characterId"));
      if (!target) send(res, 200, await overview(pool, event, user, own));
      else { if (!own) lostCharacter(); const row = await getSession(pool, eventId, identifier(target)); send(res, 200, { exchange: await detail(pool, event, user, own.character, row) }); }
      return true;
    }
    if (!action || (action === "offer" ? method !== "PUT" : method !== "POST") || (target === "join" && match[3])) fail(405, "Method not allowed.");
    const input = validateExchangeRequest(await body(req), action), targetId = target && target !== "join" ? identifier(target).toLowerCase() : null;
    if (input.informationOnly && req.headers["x-oracle-expected-account"] === undefined) fail(409, "Reconnect and review this saved request using its original account.");
    const hash = createHash("sha256").update(JSON.stringify({ action, targetId, input })).digest("hex");
    if (action === "join") {
      // Durable retries are not new code guesses. The transaction below still
      // checks the hash and current ownership before returning any result.
      const known = (await pool.query("SELECT request_id FROM exchange_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3", [eventId, user.id, input.requestId])).rows.length > 0;
      if (!known && !(await limit(pool, `exchange-join:${eventId}:${user.id}`, 30))) fail(429, "Too many exchange-code attempts. Wait 15 minutes and try again.");
    }
    let firstCreation = false;
    const result = await transaction(pool, async (db) => {
      let event = await membership(db, eventId, user.id, true);
      const previous = (await db.query("SELECT payload_hash,exchange_id FROM exchange_requests WHERE event_id=$1 AND actor_user_id=$2 AND request_id=$3", [eventId, user.id, input.requestId])).rows[0];
      let row;
      if (previous) row = await getSession(db, eventId, previous.exchange_id, true);
      else if (targetId) row = await getSession(db, eventId, targetId, true);
      else if (action === "join") { row = (await db.query("SELECT *,clock_timestamp() AS server_time FROM exchange_sessions WHERE event_id=$1 AND code=$2 FOR UPDATE", [eventId, input.code])).rows[0]; if (!row) notFound(); }
      await lockUsers(db, [user.id, row?.initiator_user_id, row?.recipient_user_id]);
      event = await membership(db, eventId, user.id);
      if (row) row.server_time = await clock(db);
      const own = await ownCharacter(db, event, user, input.characterId); if (!own) lostCharacter();
      let side = row ? sideFor(row, user.id, own.character.id) : null;
      if (row && !side && !(action === "join" && !row.recipient_user_id && row.initiator_user_id !== user.id && !previous)) {
        if (action === "join" && row.initiator_user_id === user.id) fail(409, "Use a different player's account for the other side of this exchange.");
        notFound();
      }
      const context = await projectionContext(db, event);
      if (input.informationOnly && row) {
        const savedAssets = (await db.query("SELECT snapshot FROM exchange_trade_offers WHERE event_id=$1 AND exchange_id=$2", [eventId, row.id])).rows;
        if (savedAssets.some(entry => entry.snapshot.items?.length || entry.snapshot.resources?.length)) fail(409, "This exchange now includes items or resources. Review it online; a saved information request cannot change a trade.");
      }
      if (previous) {
        if (previous.payload_hash !== hash) fail(409, "This request identifier was already used for different information.");
        if (pending(row)) {
          if (expired(row)) fail(409, "This exchange has expired.");
          if (!["cancel", "reject"].includes(action)) {
            if (!playable(event) || !own.eligible) fail(409, "This exchange is not currently available.");
            for (const party of ["initiator", "recipient"]) if (row[`${party}_user_id`] && !(await participant(db, eventId, row[`${party}_user_id`], row[`${party}_character_id`]))?.eligible) fail(409, "A participant is no longer eligible for this exchange.");
            await offers(db, event, row, context, true);
            await tradeOffers(db, event, row, true);
          }
        }
        return { exchange: await detail(db, event, user, own.character, row, context), outcome: { message: "Current exchange state restored.", replayed: true } };
      }
      if ((await db.query("SELECT count(*)::int AS n FROM exchange_requests WHERE event_id=$1 AND actor_user_id=$2", [eventId, user.id])).rows[0].n >= 10000) fail(429, "This account has reached the request history limit for this event.");
      if (!["cancel", "reject"].includes(action) && (!playable(event) || !own.eligible)) fail(409, "Choose an approved character while the event is live or in rehearsal.");
      if (action === "create") {
        await checkActiveLimit(db, event, user);
        if ((await db.query("SELECT count(*)::int AS n FROM exchange_sessions WHERE event_id=$1 AND initiator_user_id=$2 AND created_at>clock_timestamp()-interval '1 hour'", [eventId, user.id])).rows[0].n >= 40) fail(429, "Exchange creation limit reached. Try again later.");
        row = (await db.query("INSERT INTO exchange_sessions(id,event_id,code,initiator_user_id,initiator_character_id) VALUES($1,$2,$3,$4,$5) RETURNING *,clock_timestamp() AS server_time", [randomUUID(), eventId, shortCode(), user.id, own.character.id])).rows[0];
        side = "initiator"; firstCreation = true;
        await audit(db, eventId, user.id, "exchange.created", { exchangeId: row.id });
      } else {
        if (!pending(row) || expired(row)) fail(409, expired(row) ? "This exchange has expired." : "This exchange is already closed.");
        if (!["cancel", "reject"].includes(action)) for (const party of ["initiator", "recipient"]) if (row[`${party}_user_id`] && !(await participant(db, eventId, row[`${party}_user_id`], row[`${party}_character_id`]))?.eligible) fail(409, "A participant is no longer eligible for this exchange.");
        if (action === "join") {
          if (row.recipient_user_id) fail(409, "This exchange already has a second player.");
          await checkActiveLimit(db, event, user);
          await db.query("UPDATE exchange_sessions SET recipient_user_id=$2,recipient_character_id=$3,status='negotiating',version=version+1,initiator_confirmed_version=NULL,recipient_confirmed_version=NULL,updated_at=clock_timestamp() WHERE id=$1", [row.id, user.id, own.character.id]);
          side = "recipient";
          await audit(db, eventId, user.id, "exchange.joined", { exchangeId: row.id });
        } else {
          if (input.version !== row.version) fail(409, "This offer changed. Review the current exchange before continuing.");
          if (action === "offer") {
            const newAssets = await resolveTradeAssets(db, event, own.character.id, { items: input.items || [], resources: input.resources || [] });
            const savedAssets = (await db.query("SELECT snapshot FROM exchange_trade_offers WHERE event_id=$1 AND exchange_id=$2 AND side=$3", [eventId, row.id, side])).rows[0]?.snapshot || emptyAssets();
            const changed = JSON.stringify(input.readingIds) !== JSON.stringify(row[`${side}_offer`]) || JSON.stringify(stable(newAssets)) !== JSON.stringify(stable(savedAssets));
            const prospective = { ...row, [`${side}_offer`]: input.readingIds };
            // Validate the edited side now. A partner can separately repair
            // their invalid offer; neither side can confirm until both pass.
            await offerRows(db, event, own.character.id, input.readingIds, context, true);
            await offers(db, event, prospective, context, false);
            if (changed) await db.query(`UPDATE exchange_sessions SET ${side}_offer=$2,version=version+1,initiator_confirmed_version=NULL,recipient_confirmed_version=NULL,updated_at=clock_timestamp() WHERE id=$1`, [row.id, JSON.stringify(input.readingIds)]);
            if (changed && (newAssets.items.length || newAssets.resources.length || savedAssets.items.length || savedAssets.resources.length)) await db.query("INSERT INTO exchange_trade_offers(event_id,exchange_id,side,snapshot) VALUES($1,$2,$3,$4) ON CONFLICT(event_id,exchange_id,side) DO UPDATE SET snapshot=EXCLUDED.snapshot", [eventId, row.id, side, JSON.stringify(newAssets)]);
            if (changed) await audit(db, eventId, user.id, "exchange.offer_changed", { exchangeId: row.id, count: input.readingIds.length, itemCount: newAssets.items.length, resourceCount: newAssets.resources.length });
          } else if (action === "cancel" || action === "reject") {
            if (event.status === "archived") fail(409, "Archived events are read-only.");
            if (action === "reject" && side !== "recipient") fail(403, "Only the invited player can reject this exchange.");
            await db.query("UPDATE exchange_sessions SET status=$2,initiator_confirmed_version=NULL,recipient_confirmed_version=NULL,updated_at=clock_timestamp() WHERE id=$1", [row.id, action === "cancel" ? "cancelled" : "rejected"]);
            await audit(db, eventId, user.id, `exchange.${action === "cancel" ? "cancelled" : "rejected"}`, { exchangeId: row.id });
          } else if (action === "confirm") {
            if (row.status !== "negotiating" || !row.recipient_user_id) fail(409, "Wait for the other player to join before confirming.");
            await offers(db, event, row, context, true);
            await tradeOffers(db, event, row, true);
            if (new Date(row.expires_at) <= new Date(await clock(db))) fail(409, "This exchange has expired.");
            await db.query(`UPDATE exchange_sessions SET ${side}_confirmed_version=version,updated_at=clock_timestamp() WHERE id=$1`, [row.id]);
            row = await getSession(db, eventId, row.id);
            if (row.initiator_confirmed_version === row.version && row.recipient_confirmed_version === row.version) row = await complete(db, event, user, row, context);
            else await audit(db, eventId, user.id, "exchange.confirmed", { exchangeId: row.id, version: row.version });
          }
        }
        row = await getSession(db, eventId, row.id);
      }
      await db.query("INSERT INTO exchange_requests(event_id,actor_user_id,request_id,payload_hash,exchange_id) VALUES($1,$2,$3,$4,$5)", [eventId, user.id, input.requestId, hash, row.id]);
      return { exchange: await detail(db, event, user, own.character, row, context), outcome: { message: row.status === "completed" ? "Both players confirmed. Your introduction, readings, and agreed transfers are saved." : action === "create" ? "Show this temporary code to the other player." : action === "join" ? "Review the offers. Each player must confirm independently." : action === "offer" ? "Offer saved. Changed offers require both players to confirm again." : action === "confirm" ? "Your confirmation is saved. Waiting for the other player." : "Exchange closed.", replayed: false } };
    });
    send(res, firstCreation ? 201 : 200, result); return true;
  };
}
