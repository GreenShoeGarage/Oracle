// Server-only authored adventures. Puzzle answers, release words, and organizer
// solutions must never be bundled into public assets or returned by the catalog.
import { randomInt } from "node:crypto";
import { defaultSetup, validateSetup } from "../public/kit.js";
import { defaultCharacterProfile, validateCharacterProfile } from "../public/characters-model.js";
import { defaultAdventure, defaultAdventureNode, validateAdventure } from "../public/adventure-model.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const WORLDS = {
  fantasy: {
    title: "The Last Lantern",
    summary: "Recover a keeper's instructions, restore a dark border lantern, and decide who will keep its light for the villages beyond the gate.",
    place: "the old watchtower",
    meetingPlace: "the lantern table beside the village gate",
    protectedPeople: "the three villages across the marsh",
    apparatus: "border lantern",
    keeper: "Keeper Elian",
    roleOne: { name: "Mara Reed", title: "village envoy", item: "Delegate's ribbon", biography: "You carry petitions between the marsh villages. You know how to read a maker's mark and how to ask a question that brings a quiet person into the room.", objective: "Secure a promise that the smallest marsh village will receive the lantern signal too. Ask for a named witness; a vague promise will not reassure the people who sent you." },
    roleTwo: { name: "Oren Flint", title: "apprentice lantern keeper", item: "Keeper's wooden tool", biography: "You helped Keeper Elian maintain the old watchtower. You can examine delicate mechanisms, but this is your first time deciding whom the light should serve.", objective: "Admit that the lantern has been neglected and recruit a second keeper before accepting responsibility. Do not promise to maintain it alone." },
    intro: "At dusk the border lantern falls dark. The marsh villages use its steady light to find the raised path home, and the next travelers will soon reach the water. Keeper Elian has left an intact lantern core and a sealed instruction letter at the old watchtower. The village asks your small company to recover the instructions, restore the light if possible, and agree who will tend it after tonight.",
    prop: "The cold lantern core",
    markings: "MOON, ROOT, FLAME",
    releaseWord: "HEARTH",
    answer: "381",
    examination: "The core is cold but unbroken. Three large marks run left to right across its collar: MOON, ROOT, FLAME. An arrow reads START HERE and points from MOON toward FLAME. Beneath them, a keeper's inscription says: To open my sealed instructions, speak HEARTH. Copy both the order and the word. The printed prop code identifies this core; HEARTH is the separate word for the letter.",
    investigation: "A maker's seal matches the villages' old shared charter. This is a communal lantern, not the watchtower owner's private property. A restoration agreement that leaves a village out would break its original purpose.",
    repair: "The wick carrier is sound. The problem is a disengaged three-position collar, not a need for fuel or force. The collar expects three digits in the order of the symbols; a correct setting will restore the existing light.",
    messageTitle: "Keeper Elian's sealed letter",
    message: "Friends, I moved the lantern to its safe setting before leaving to guide a lost family. Use the marks on the core, read from left to right. The keeper's key is ROOT = 8, FLAME = 1, MOON = 3. Replace each mark with its digit and enter those three digits, with no spaces, at the lantern collar. Do not sort the digits or use the order of this list. If the collar locks after three mistakes, take turns holding the hand lantern at the gate while one of you carries the warning along the raised path. Either way, settle who tends the light, who checks on them, and how all three villages hear the signal. I will return after the gathering.",
    puzzleTitle: "The lantern collar",
    puzzlePrompt: "The collar has three digit windows and three attempts remaining at first use. Read the three marks on the recovered core from left to right, translate them using Keeper Elian's letter, and enter the resulting three digits without spaces. The letter's list order is not the collar order.",
    hintOne: "Find the core entry in your journal. Its arrow starts at MOON, then passes ROOT, then FLAME.",
    hintTwo: "Elian's key gives MOON the digit 3, ROOT the digit 8, and FLAME the digit 1. Keep the order shown on the core.",
    success: "Warm light rises inside the core and the watchtower lantern shines again. No extra fuel is needed. The villages still need people to keep it working: join the Lantern Keepers' Gathering and make that promise together in person.",
    failure: "The collar clicks into its safe lock after the third failed setting. Nothing burns or breaks, but the tower stays dark. Keeper Elian's manual plan is still possible: join the Hand-Lantern Watch and agree who holds the signal, who carries the warning, and when they exchange duties.",
    sceneTitle: "The Lantern Keepers' Gathering",
    manualTitle: "The Hand-Lantern Watch",
    signalAction: "raise a paper lantern drawing together",
    manualAction: "pass an unlit lantern or a folded paper lantern drawing between the watchkeepers",
    restoredEnding: "Across the marsh, three answering lights appear. Keeper Elian returns, hears your named duties, and says: A lantern is a promise only when someone keeps it. The road stays open tonight because your company chose to keep that promise together.",
    manualEnding: "The hand lantern answers from the gate while a runner carries the warning along the raised path. The tower must wait, but every village knows where the safe road lies. Keeper Elian returns to find a watch already organized, with no one left to stand alone.",
  },
  cyberpunk: {
    title: "The Last Neighborhood Signal",
    summary: "Recover a technician's instructions, restore a silent neighborhood relay, and write a shared operating promise before the evening check-in.",
    place: "the neighborhood repair shop",
    meetingPlace: "the community table outside the repair shop",
    protectedPeople: "the three blocks beyond the service tunnel",
    apparatus: "neighborhood relay",
    keeper: "relay technician Imani",
    roleOne: { name: "Nyx Vale", title: "tenant network liaison", item: "Tenant union patch", biography: "You carry messages between apartment blocks and translate technical decisions into promises people can hold each other to. You read labels carefully and notice who is missing from a meeting.", objective: "Get an explicit promise that the smallest block has equal access to the relay. Ask who will check that promise tomorrow, rather than accepting a slogan about open networks." },
    roleTwo: { name: "Patch Sato", title: "community relay technician", item: "Unpowered service probe", biography: "You learned to service the neighborhood relay alongside Imani. You understand its maintenance markings, but the community must decide how to share its restored channel.", objective: "Explain that one volunteer cannot cover the relay every night. Recruit a second operator and a check-in time before accepting the first shift." },
    intro: "The neighborhood relay goes silent just before the evening check-in. Three apartment blocks use it to tell one another which entrances are open and who needs a delivery. Technician Imani has left a disconnected service module and a sealed maintenance message at the repair shop. Your crew must read the module, recover the message, restore the local channel if possible, and decide who will keep it available after tonight. This is a fictional stand-alone relay; no real network access is involved.",
    prop: "The disconnected service module",
    markings: "ANTENNA, WAVE, BOLT",
    releaseWord: "NEIGHBOR",
    answer: "427",
    examination: "The unplugged module is undamaged. Three stamped symbols run left to right along its service strip: ANTENNA, WAVE, BOLT. An arrow marked INPUT ORDER starts at ANTENNA and ends at BOLT. A handwritten maintenance sticker says: Open Imani's message with NEIGHBOR. Record the order and the word. The printed prop code identifies this module; NEIGHBOR is the separate word for the maintenance message.",
    investigation: "An old service sticker calls the relay a neighborhood commons. Its agreement names all three blocks, including the one with only six tenants. No private subscriber tier appears anywhere in the original arrangement.",
    repair: "The status strip indicates maintenance standby rather than a failed component. A three-digit local setting will reconnect the fictional relay. It expects the stamped symbol order, not a search for another password or any real system access.",
    messageTitle: "Imani's maintenance message",
    message: "Crew: I placed the relay in maintenance standby while escorting the delivery cart through the service tunnel. Read the module's symbols left to right. The service key is BOLT = 7, ANTENNA = 4, WAVE = 2. Replace the symbols with their digits and enter those three digits, without spaces, into the local relay console. Do not use the order of this list. Three wrong settings trigger a temporary lock. If that happens, run a staffed message desk: one person receives check-ins, one carries messages, and another verifies delivery when available. Whether automatic or manual, name the first operator, their backup, and the check-in time for every block. I will meet you at the community table.",
    puzzleTitle: "The local relay console",
    puzzlePrompt: "This fictional console accepts a three-digit maintenance setting. Take the module's three symbols in their stamped order, translate them using Imani's message, and enter the digits without spaces. There are three attempts; all clues are in this event's journal.",
    hintOne: "Look at the service-module entry. INPUT ORDER is ANTENNA, then WAVE, then BOLT; the maintenance message deliberately lists them differently.",
    hintTwo: "The key maps ANTENNA to 4, WAVE to 2, and BOLT to 7. Enter those digits in the module's order.",
    success: "The relay returns to its steady local carrier and all three blocks can check in. The channel is back; its operating agreement is still yours to write. Join the Neighborhood Network Assembly and settle the first shift together.",
    failure: "The third rejected setting puts the console into its temporary maintenance lock. No real device is affected. Imani's fallback remains available: join the Street-Level Message Desk and organize a staffed check-in and delivery rota until the relay can be serviced.",
    sceneTitle: "The Neighborhood Network Assembly",
    manualTitle: "The Street-Level Message Desk",
    signalAction: "place your paper call-sign cards beside the relay drawing together",
    manualAction: "pass a paper message from receiver to courier and confirm its return receipt",
    restoredEnding: "Three call signs answer the first check-in. Imani arrives, reads the named shift and backup, and says: The carrier was the easy part. Now it belongs to everyone who keeps their word. The blocks finish the evening connected.",
    manualEnding: "The first paper message returns with a delivery mark from every block. The relay is still in maintenance, but nobody is cut off. Imani arrives to find a working human network and a clear relief time instead of one exhausted volunteer.",
  },
  wasteland: {
    title: "The Last Water Beacon",
    summary: "Recover a pump keeper's instructions, restore the settlement's route beacon, and share the work of guiding an overdue water convoy home.",
    place: "the settlement's pump shelter",
    meetingPlace: "the shaded meeting circle beside the pump shelter",
    protectedPeople: "the three camps along the dry riverbed",
    apparatus: "convoy route beacon",
    keeper: "pump keeper Della",
    roleOne: { name: "Kestrel Ash", title: "convoy scout", item: "Cloth route marker", biography: "You travel the dry riverbed between three camps. You read old route marks and remember how easily a small camp can be left off a larger camp's supply plan.", objective: "Make the group name the smallest camp when they plan the signal route. Offer to carry a message only if someone is assigned to check that you return." },
    roleTwo: { name: "Moss Calder", title: "beacon tender", item: "Wooden service spanner", biography: "Della taught you the beacon's maintenance marks and the habit of checking a tool before forcing it. You want a repair plan that can survive a tired volunteer taking a night off.", objective: "Choose a named relief tender and a clear shift-change time. Admit that you cannot maintain the beacon and scout the route alone." },
    intro: "An overdue water convoy is due at the riverbed junction, but the settlement's route beacon has gone dark. Three camps depend on that signal to direct the convoy to the shared pump shelter. Keeper Della has left an intact regulator and a sealed field note beside the shelter. Your group must inspect the regulator, recover the note, restore the beacon if possible, and share the work of bringing the convoy home. The shortage is fictional; no real water, food, or access is withheld during play.",
    prop: "The dusty beacon regulator",
    markings: "WELL, WHEEL, SUN",
    releaseWord: "TOGETHER",
    answer: "639",
    examination: "A wipe of the regulator reveals three marks from left to right: WELL, WHEEL, SUN. An arrow marked ROUTE SETTING points from WELL toward SUN. Della has scratched a note underneath: The field-note word is TOGETHER. Write down the order and the word. The printed prop code identifies this regulator; TOGETHER is the separate word that opens the field note.",
    investigation: "The route plate lists all three camps as equal keepers of the beacon. A faded extra notch records the smallest camp's original contribution. Their claim to the convoy route did not expire when their numbers fell.",
    repair: "The regulator is in a safe maintenance position; its casing is sound. It needs a three-digit setting from the maker's marks, not more fuel, force, or salvaged parts. Do not manipulate a real machine to play this scene.",
    messageTitle: "Della's sealed field note",
    message: "I set the beacon to maintenance while marking the washed-out bend. Read the regulator marks from left to right. The route key is SUN = 9, WELL = 6, WHEEL = 3. Replace each mark with its digit and enter the three digits, with no spaces, at the beacon setting plate. The order of this list is not the route order. Three wrong settings close the safety catch. If that happens, use the manual route watch: a stationary signal tender and a walking guide, with a named relief for each when possible. Include all three camps in the route. Decide who starts, who checks for their return, and when duties change. I will return to the shaded circle.",
    puzzleTitle: "The beacon setting plate",
    puzzlePrompt: "Set three digits to release the fictional beacon from maintenance. Use the order stamped on the regulator and Della's symbol-to-digit key. Enter digits only, without spaces. The safety catch closes after three wrong settings; the group can still organize the manual route watch.",
    hintOne: "The regulator arrow begins at WELL, continues through WHEEL, and ends at SUN. Keep that order even though Della lists the key differently.",
    hintTwo: "Della maps WELL to 6, WHEEL to 3, and SUN to 9. Read those values in the regulator's left-to-right order.",
    success: "The route beacon shines over the dry riverbed. The convoy now has a destination, but people must keep its route clear and its signal watched. Join the Three-Camp Convoy Council and agree on the first shared watch.",
    failure: "After the third wrong setting, the catch holds the beacon in maintenance. Nothing explodes and the regulator is not lost. Della's fallback remains: join the Manual Route Watch and pair a stationary tender with a guide so the convoy can still reach every camp.",
    sceneTitle: "The Three-Camp Convoy Council",
    manualTitle: "The Manual Route Watch",
    signalAction: "arrange three paper camp markers around the beacon drawing together",
    manualAction: "pass a cloth route marker between guide, signal tender, and any relief volunteers",
    restoredEnding: "A convoy horn answers from the riverbed junction. Della returns, hears the route include all three camps, and says: Good. A beacon can point the way; people make sure nobody is left behind. The convoy reaches the common shelter as your first watch begins.",
    manualEnding: "A guide returns with word that the convoy has seen the hand signal. The beacon remains a job for daylight, but the three camps have a route and a relief plan tonight. Della returns to a working watch that shares both its effort and its welcome.",
  },
};

// This is the only template data returned by the public-facing catalog API.
export const ADVENTURE_TEMPLATES = Object.freeze(Object.entries(WORLDS).map(([id, world]) => Object.freeze({
  id, title: world.title, summary: world.summary, durationMinutes: 30, players: "2–6 players",
})));

function uniqueCode(used) {
  let code;
  do { code = Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""); }
  while (used.has(code));
  used.add(code);
  return code;
}

function finalScene(world, manual) {
  return [
    `Meet at ${world.meetingPlace}. This is a ten-minute cooperative scene for two to six players; the app reserves places and records your reading, while you play the agreement together in person.`,
    `Minute 0–2: Everyone introduces their character and names one person or group among ${world.protectedPeople} who must hear the signal. Share your earlier discoveries aloud. Each participant gets a turn before anyone takes a second turn.`,
    manual
      ? `Minute 2–5: The ${world.apparatus} is still in maintenance. Choose two distinct starting duties: a stationary signal or message keeper, and a person carrying the route or message. With two players, agree when to exchange these duties. With more players, name relief volunteers and witnesses. Nobody needs to leave the agreed play area.`
      : `Minute 2–5: The ${world.apparatus} is working. Name a first keeper, a distinct person who checks on that keeper, and a clear shift-change or check-in time. With more than two players, add a relief keeper and witnesses. Say how your plan reaches each of the three communities.`,
    "Minute 5–8: Each character offers one practical contribution and asks for one condition that makes their promise possible. The group repeats the named duties, the check-in time, and the plan for the smallest community. Revise the agreement until everyone can state their own part willingly. A character may decline a duty and propose another; agreement comes from conversation, not an automatic roll.",
    `Minute 8–10: ${manual ? world.manualAction : world.signalAction}. Any player may describe the action instead of handling a prop. Read the agreed duties aloud, then ask the organizer to read the ending below. If you have no organizer present, choose a witness to read it. This closes the adventure; no additional puzzle or hidden prop is required.`,
    `ENDING: ${manual ? world.manualEnding : world.restoredEnding}`,
    manual ? `If the ${world.apparatus} is restored later through an organizer's explicit override, keep this agreement as the backup rota and combine the gathering with the restored route. Joining a scene is an RSVP, not proof that your characters have already performed these duties.` : "Joining a scene is an RSVP, not proof that your characters have already performed these duties. The spoken agreement and ending are the final scene.",
  ].join("\n\n");
}

function organizerNotes(world) {
  return [
    `RUN ${world.title.toUpperCase()}: One organizer and two to six players, about 30 minutes. Use one room or a small agreed play area. Paper stand-ins are sufficient for every prop. No darkness, fire, drinking restriction, physical contact, real machinery, real network access, or actual travel is required. Players may describe any physical action instead of performing it.`,
    `BEFORE PLAY: This template creates a Draft with two approved but unassigned prewritten characters, ${world.roleOne.name} (${world.roleOne.title}) and ${world.roleTwo.name} (${world.roleTwo.title}). Invite the players into this event. In Characters, assign one prewritten sheet to each of the first two players. For three to six players, create additional characters or approve player-created ones using the two available skills; give each a distinct person to represent and a practical duty to negotiate. Every device that performs actions needs its own assigned approved character.`,
    `PRINT AND PLACE: In Adventure management, print the prop labels. Attach the RELIC label for ${world.prop} to an unpowered everyday object or a paper drawing at ${world.place}. Put the DEAD DROP label for ${world.messageTitle} on a closed empty envelope beside it; the message is revealed by the app, so do not put the solution on the outside. Place the CIPHERBOX label for ${world.puzzleTitle} on a cardboard control plate or a separate sheet nearby. Put both WAYFINDER labels at ${world.meetingPlace}; they lead to alternate endings at the same place. Keep the app's long printed prop codes visible and copyable. Those codes are distinct from the letter's short release word.`,
    "START: Check assignments, then set the event to Rehearsal for a practice run or Live for actual play. Ask each player to open Field adventure and choose their own approved character. Explain that they may discuss clues freely in person, but each character must examine/open/solve in their own app to unlock their own journal and scene. A printed label can be scanned or its code typed. Keep your organizer account on your own device; an unattended prop screen should use a player account.",
    "PLAYER EXCHANGES: In this new starter, relic readings and the sealed message are shareable; puzzle and scene readings are restricted. Players open Exchanges using their own approved character. One chooses Show my QR, the other scans that temporary exchange QR or enters its 12-character code, and both review the offered reading titles before each confirms. They can also confirm with no readings to record an introduction. A character badge identifies someone but does not accept an exchange. Received readings appear in the journal without completing an instrument, granting skills, or advancing the story. Organizer Sharing permissions can change what is offered; changes require both players to confirm again and cannot retract earlier journal readings.",
    "INVESTIGATION AND NEWS: Open Prepare rumors & news to review the two draft witness accounts, each addressed to a different prewritten character. Publish the accounts explicitly during Rehearsal or Live. Players collect their eligible account in Rumors & news, then can share it through a confirmed Exchange. TRACE keeps personal theories and links private unless the player selects an audience. Source citations never automatically reveal another player’s unread material. Review the draft Witnesses requested bulletin before publishing; it becomes visible to characters after their evidence-core discovery. Review player proposals, and provide a correction note when replacing published text. Withdraw stops future collection; previously authorized readings remain in their owners’ journals.",
    `MINUTES 0–5: Read the event briefing. Ask each character who they represent and why tonight's signal matters. Point them toward ${world.prop}; there is no scavenger hunt outside the agreed area.`,
    `MINUTES 5–10: Every player scans or enters the RELIC prop code and selects Read the markings. This examination has no skill prerequisite and supplies the ordered symbols (${world.markings}) and release word ${world.releaseWord}. Optional Investigation and Repair examinations add context for the final negotiation; neither is needed to solve or finish.`,
    `MINUTES 10–15: The recorded relic discovery unlocks the sealed message. Scan its label or open the unlocked card, then enter ${world.releaseWord} in the separate release-word field. The letter supplies the symbol-to-digit key. The printed prop code is not that word. Players may return to both journal entries after reading.`,
    `MINUTES 15–20: Open the CIPHERBOX. Translate the ordered relic marks with the message key: the exact solution is ${world.answer}. The answer is three digits with no spaces. Matching ignores letter case only; no guess at a real-world password is involved. At any point players can request the available first hint; more explicit hints become available after one and two incorrect attempts. Each character has three attempts, with a brief cooldown between guesses.`,
    `SUCCESS ROUTE: A correct setting completes restoration-console and sets restoration-success once. The ${world.sceneTitle} WAYFINDER card unlocks. Each character joins the scene, then the group plays its ten-minute agreement at ${world.meetingPlace}.`,
    `FAILURE ROUTE: Three incorrect settings set manual-required once and reveal the written fallback. They unlock ${world.manualTitle}, which depends on the already-read message rather than a solved puzzle. Every character can still reach a complete ending. If only some characters solve, gather everyone at the same place, name both the automatic shift and a manual backup, and read the corresponding ending for each role.`,
    `OVERRIDES: If a player is stuck or an access need makes the puzzle unsuitable, use the organizer's explicit Solve override for that character and restoration-console. To offer another attempt at the same puzzle, use Reset attempts on that character's failed console. These are different controls. Do not edit the answer during active play or promise an automatic reward for a manual intervention. If a character missed the message, use the release override for sealed-message after discussing the missing clue.`,
    "MINUTES 20–30: Follow the unlocked WAYFINDER scene's timed prompts. The cooperative finish requires two named duties, an agreed check-in or handover time, inclusion of all three communities, and each player's willing contribution. A spoken promise or described gesture is enough. Read the authored ending. Ask each player what their character learned and close the event when ready.",
    "REHEARSAL AND RECOVERY: Use Create rehearsal copy before a practice run. The dedicated copy has fresh gameplay progress and approved unassigned characters, so assign its characters again. Reset only that rehearsal copy while it is in Rehearsal; it is safe to repeat without wiping the source event's progress. Journal readings persist after refresh. Newly protected reveals and actions need connectivity; already permitted cached readings, when available, are read-only offline. No inventory is consumed by this adventure, and scene RSVPs do not enact the spoken promises automatically.",
  ].join("\n\n");
}

export function buildAdventureTemplate(themeID) {
  if (!Object.hasOwn(WORLDS, themeID)) {
    const error = new Error("Choose a supported Fantasy, Cyberpunk, or Wasteland adventure.");
    error.status = 400;
    throw error;
  }
  const world = WORLDS[themeID];
  const setup = defaultSetup(themeID);
  setup.templateId = `adventure-${themeID}`;
  setup.enabledInstruments = ["briefing", "relic", "dead-drop", "cipherbox", "wayfinder", "trace", "whisper", "broadside"];
  setup.rules = {
    version: 1,
    attributes: [{ id: "resolve", name: "Resolve", min: 0, max: 5, default: 2 }],
    expertise: [{ id: "investigation", name: "Investigation" }, { id: "repair", name: "Repair" }],
    resources: [],
    outcomes: [{ id: "agreement", name: "A shared agreement", description: "People choose named duties, include all three communities, and agree when to check on one another. Play the result in person." }],
  };
  setup.content = [
    { id: "adventure-briefing", title: world.title, body: `${world.intro}\n\nPlay together for about 30 minutes. Begin with the labeled ${world.prop} at ${world.place}. Open Field adventure and select your assigned approved character. Discuss discoveries freely, then record each step on your own character so your journal and next reading unlock. The final gathering is cooperative; every character gets a say.`, visibility: "player", prop: true },
    { id: "organizer-start", title: "Before your players arrive", body: `Invite your players, assign the two approved prewritten characters, and print the five adventure prop labels. Place the labeled objects together in the agreed play area. The Adventure management organizer notes contain the complete setup, solutions, timed prompts, alternate ending, and rehearsal instructions. Set the event to Rehearsal or Live before player actions. In Prepare rumors & news, review and publish the two private witness accounts and the discovery-gated bulletin. Players use Rumors & news and TRACE to compare accounts and build their investigation.`, visibility: "organizer", prop: false },
  ];

  const codes = new Set();
  const node = (type, id, title, summary) => ({ ...defaultAdventureNode(type, id, uniqueCode(codes)), title, summary });
  const relic = node("relic", "evidence-core", world.prop, "Examine the labeled object to recover its markings and discover how to open the keeper's message.");
  relic.examinations = [
    { id: "read-markings", label: "Read the markings", text: world.examination, conditions: { completed: [], skills: [], flags: [], statuses: [] }, actions: [] },
    { id: "read-history", label: "Investigate the old agreement", text: world.investigation, conditions: { completed: [], skills: ["investigation"], flags: [], statuses: [] }, actions: [] },
    { id: "inspect-mechanism", label: "Inspect the mechanism", text: world.repair, conditions: { completed: [], skills: ["repair"], flags: [], statuses: [] }, actions: [] },
  ];

  const message = node("dead_drop", "sealed-message", world.messageTitle, "A protected maintenance message. Find its separate release word on the labeled object before opening it.");
  message.conditions.completed = [relic.id];
  message.body = world.message;
  message.releaseCode = world.releaseWord;
  message.audio = null;

  const cipher = node("cipherbox", "restoration-console", world.puzzleTitle, "A three-digit fictional maintenance setting, solved from the object's markings and the keeper's message.");
  cipher.conditions.completed = [message.id];
  cipher.prompt = world.puzzlePrompt;
  cipher.answer = world.answer;
  cipher.match = "fold";
  cipher.hints = [
    { text: "You have all the clues. Compare the ordered symbols in the object reading with the key in the sealed message; replace each symbol with one digit.", afterAttempts: 0 },
    { text: world.hintOne, afterAttempts: 1 },
    { text: world.hintTwo, afterAttempts: 2 },
  ];
  cipher.maxAttempts = 3;
  cipher.successText = world.success;
  cipher.failureText = world.failure;
  cipher.actions.success = ["restoration-success"];
  cipher.actions.failure = ["manual-required"];

  const gathering = node("wayfinder", "community-gathering", world.sceneTitle, "Gather in person to share the work and make a promise that includes every community.");
  gathering.conditions.completed = [cipher.id];
  gathering.conditions.flags = ["restoration-success"];
  Object.assign(gathering, { body: finalScene(world, false), location: world.meetingPlace, playStyle: "social", durationMinutes: 10, minPlayers: 2, maxPlayers: 6, availability: "open", startsAt: null, endsAt: null });
  gathering.actions.success = ["keepers-gathered"];

  const manual = node("wayfinder", "manual-watch", world.manualTitle, "The manual fallback still brings the community together. Agree a staffed signal or message rota in person.");
  manual.conditions.completed = [message.id];
  manual.conditions.flags = ["manual-required"];
  Object.assign(manual, { body: finalScene(world, true), location: world.meetingPlace, playStyle: "social", durationMinutes: 10, minPlayers: 2, maxPlayers: 6, availability: "open", startsAt: null, endsAt: null });
  manual.actions.success = ["manual-watch-arranged"];

  const definition = {
    ...defaultAdventure(), title: world.title, summary: world.summary, organizerNotes: organizerNotes(world),
    flags: [
      { id: "restoration-success", name: "Automatic signal restored" },
      { id: "manual-required", name: "Manual fallback available" },
      { id: "keepers-gathered", name: "Joined the keepers' gathering" },
      { id: "manual-watch-arranged", name: "Joined the manual watch" },
    ],
    nodes: [relic, message, cipher, gathering, manual],
  };
  const characters = [world.roleOne, world.roleTwo].map((role, index) => ({ profile: validateCharacterProfile({
    ...defaultCharacterProfile(setup.rules), name: role.name, pronouns: "they/them", biography: role.biography,
    skills: [index === 0 ? "investigation" : "repair"], privateObjectives: role.objective,
    startingEquipment: [
      { name: role.item, quantity: 1, notes: "A fictional role prop; a paper drawing or spoken description works equally well." },
      { name: "Pocket notebook", quantity: 1, notes: "Record clues and the final agreement. No equipment is consumed by this adventure." },
    ],
  }, setup, []) }));
  return { name: world.title, description: world.intro, setup: validateSetup(setup), definition: validateAdventure(definition, setup), characters };
}
