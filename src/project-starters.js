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
      { title: 'A way in', description: 'The group has a credible way to reach or operate the lantern.', requiredCount: 1 },
      { title: 'A workable plan', description: 'Players have contributed enough practical preparation to attempt the relighting.', requiredCount: 2 },
      { title: 'A shared watch', description: 'At least two distinct players have helped establish how the warning will be carried forward.', requiredCount: 2 }
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
      { title: 'Reach the node', description: 'The group has a credible route to the relay and the people around it.', requiredCount: 1 },
      { title: 'Stabilize the relay', description: 'At least two distinct players have contributed to a plausible recovery plan.', requiredCount: 2 },
      { title: 'Put it to use', description: 'At least two distinct players have helped define how the neighborhood will use the restored relay.', requiredCount: 2 }
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
      { title: 'Know the damage', description: 'The group understands enough of the failure to act.', requiredCount: 1 },
      { title: 'Make it workable', description: 'At least two distinct players have contributed toward a credible restoration.', requiredCount: 2 },
      { title: 'Keep the watch', description: 'At least two distinct players have helped define how the beacon will be watched after restoration.', requiredCount: 2 }
    ]
  }
};
