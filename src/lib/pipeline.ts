/** Where each stage of the plan stands. Edit this as stages ship. */
export interface Stage {
  name: string;
  what: string;
  state: 'live' | 'next' | 'later';
}

export const PIPELINE: Stage[] = [
  { name: 'Source', what: 'Local companies from Google Maps searches by trade and area (no size signal yet)', state: 'live' },
  { name: 'Find contacts', what: 'Owner names, emails and pages researched from public sources, with confidence levels', state: 'live' },
  { name: 'Research: site audit', what: 'What tracking each site runs, with evidence for every finding', state: 'live' },
  { name: 'Research: ad check', what: "Who runs Google ads, from Google's public ad library (Meta not yet)", state: 'live' },
  { name: 'Draft', what: 'One coordinated sequence per person, opening with a finding', state: 'live' },
  { name: 'Review', what: 'Approve, edit or skip every draft on the Outreach page', state: 'live' },
  { name: 'Send', what: 'By hand for now: copy, open the profile, send, mark as sent. Automatic email is next', state: 'next' },
  { name: 'Replies', what: 'Logged by hand; a reply stops the sequence on every channel', state: 'live' },
  { name: 'Outcomes', what: 'Meetings, proposals and revenue tied back to each touch', state: 'later' },
];

export const STATE_LABEL: Record<Stage['state'], string> = {
  live: 'Working',
  next: 'Building next',
  later: 'Not built',
};
