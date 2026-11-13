/** Where each stage of the plan stands. Edit this as stages ship. */
export interface Stage {
  name: string;
  what: string;
  state: 'live' | 'next' | 'later';
}

export const PIPELINE: Stage[] = [
  { name: 'Source', what: 'Find companies from signals instead of a bought list', state: 'later' },
  { name: 'Find contacts', what: 'Decision-maker names from public records, verified email', state: 'later' },
  { name: 'Research: site audit', what: 'What tracking each site runs, with evidence for every finding', state: 'live' },
  { name: 'Research: ad check', what: 'Confirm who actually advertises, so ad findings can be used', state: 'next' },
  { name: 'Draft', what: 'One coordinated sequence per person, opening with a finding', state: 'later' },
  { name: 'Review', what: 'Approve, edit or reject every draft', state: 'later' },
  { name: 'Send', what: 'Email, LinkedIn and Instagram, checked against the do-not-contact list', state: 'later' },
  { name: 'Replies', what: 'Classify replies and pause the sequence on every channel', state: 'later' },
  { name: 'Outcomes', what: 'Meetings, proposals and revenue tied back to each touch', state: 'later' },
];

export const STATE_LABEL: Record<Stage['state'], string> = {
  live: 'Working',
  next: 'Building next',
  later: 'Not built',
};
