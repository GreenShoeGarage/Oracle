export const PROJECT_STARTERS = {
  fantasy: {
    title: 'Restore the Border Lantern',
    purpose: 'Bring the old border lantern back into service before nightfall so the settlement has a shared warning signal again.',
    outcomeText: 'When the lantern is restored, the settlement regains a common warning point and the organizer can advance the next story beat.',
    routes: [
      { key: 'access', label: 'Negotiate access', help: 'Speak with someone who can help the group reach or use the lantern site.' },
      { key: 'procedure', label: 'Work out a safe procedure', help: 'Help the group agree on a practical relighting plan.' },
      { key: 'watch', label: 'Arrange the watch', help: 'Help decide who will notice, relay, or respond when the lantern is used.' },
      { key: 'quiet', label: 'Prepare behind the scenes', help: 'Contribute notes, materials, or a private suggestion for the organizer to review.' }
    ],
    milestones: [
      { title: 'A way in', description: 'Bring a relevant RELIC or DEAD DROP discovery, or another approved piece of verified evidence, that gives the group a credible way to reach or operate the lantern.', requiredCount: 1, contributionMode: 'evidence', allowedEvidence: ['relic','dead_drop','sigil','oath'] },
      { title: 'A workable plan', description: 'Contribute two units of an available event resource toward the restoration when the event economy supports it; otherwise this remains a two-player reviewed preparation milestone.', requiredCount: 2, contributionMode: 'resource-if-available' },
      { title: 'A shared watch', description: 'At least two distinct players have helped establish how the warning will be carried forward.', requiredCount: 2, contributionMode: 'reviewed' }
    ],
    consequences: [
      { kind: 'content_unlock', title: 'The lantern is lit', body: 'The restored lantern now belongs to the shared life of the settlement. Its warning can be seen and acted on by the whole gathering.', audience: { type: 'event' }, position: 0 },
      { kind: 'broadside_draft', title: 'The Border Lantern Burns Again', body: 'The border lantern has been restored through the work of the gathering. A common warning point now stands ready at the edge of the settlement.', audience: { type: 'event' }, position: 1 }
    ]
  },
  cyberpunk: {
    title: 'Bring the Neighborhood Relay Online',
    purpose: 'Restore a community relay so local people can pass warnings and requests without depending on the dominant network.',
    outcomeText: 'When the relay comes online, the neighborhood gains an independent communications point and the organizer can reveal the next authored consequence.',
    routes: [
      { key: 'access', label: 'Secure access', help: 'Find a social or practical route to the relay site.' },
      { key: 'diagnose', label: 'Diagnose the failure', help: 'Offer an explanation, test, or clue that helps narrow the problem.' },
      { key: 'coordination', label: 'Coordinate the neighborhood', help: 'Arrange who will listen, relay, or respond once the node is active.' },
      { key: 'quiet', label: 'Contribute off-channel', help: 'Submit a discreet note, plan, or support task without taking center stage.' }
    ],
    milestones: [
      { title: 'Reach the node', description: 'Use a verified discovery, successful SIGIL outcome, or completed OATHBOOK agreement to establish a credible route to the relay and the people around it.', requiredCount: 1, contributionMode: 'evidence', allowedEvidence: ['dead_drop','relic','sigil','oath'] },
      { title: 'Stabilize the relay', description: 'Contribute two units of an available event resource when the economy supports it; otherwise two distinct players can complete this through reviewed preparation.', requiredCount: 2, contributionMode: 'resource-if-available' },
      { title: 'Put it to use', description: 'At least two distinct players have helped define how the neighborhood will use the restored relay.', requiredCount: 2, contributionMode: 'reviewed' }
    ],
    consequences: [
      { kind: 'content_unlock', title: 'Independent signal', body: 'The relay is online. The neighborhood now has a communications point that does not depend on the dominant network.', audience: { type: 'event' }, position: 0 },
      { kind: 'broadside_draft', title: 'Neighborhood Relay Restored', body: 'The community relay is transmitting again. Local warnings and requests can now travel through an independent neighborhood node.', audience: { type: 'event' }, position: 1 }
    ]
  },
  wasteland: {
    title: 'Restore the Water Watch',
    purpose: 'Bring a damaged water beacon and watch system back into use so the settlement can protect a shared supply.',
    outcomeText: 'When the Water Watch is restored, the settlement gains a dependable signal and a clearer shared responsibility for the supply.',
    routes: [
      { key: 'survey', label: 'Survey the problem', help: 'Report what is wrong, what is missing, or what needs attention.' },
      { key: 'repair', label: 'Help with the repair plan', help: 'Contribute a practical idea, preparation step, or useful observation.' },
      { key: 'watch', label: 'Organize the watch', help: 'Help arrange who notices trouble and how the warning is passed.' },
      { key: 'quiet', label: 'Support from the edge', help: 'Offer notes, logistics, or a lower-pressure contribution for organizer review.' }
    ],
    milestones: [
      { title: 'Know the damage', description: 'Use a verified RELIC or DEAD DROP discovery, successful SIGIL outcome, or completed agreement to establish what has failed and what the settlement needs.', requiredCount: 1, contributionMode: 'evidence', allowedEvidence: ['relic','dead_drop','sigil','oath'] },
      { title: 'Make it workable', description: 'Contribute two units of an available event resource when the economy supports it; otherwise two distinct players can complete this through reviewed restoration work.', requiredCount: 2, contributionMode: 'resource-if-available' },
      { title: 'Keep the watch', description: 'At least two distinct players have helped define how the beacon will be watched after restoration.', requiredCount: 2, contributionMode: 'reviewed' }
    ],
    consequences: [
      { kind: 'content_unlock', title: 'The watch holds', body: 'The beacon is working and the settlement has agreed how the water supply will be watched. The signal now carries a shared responsibility, not just an alarm.', audience: { type: 'event' }, position: 0 },
      { kind: 'broadside_draft', title: 'Water Watch Restored', body: 'The damaged beacon has returned to service and the settlement has established a shared watch over the water supply.', audience: { type: 'event' }, position: 1 }
    ]
  }
};
