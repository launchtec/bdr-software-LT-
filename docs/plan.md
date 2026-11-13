# LaunchTec outbound system: plan

Last updated 2026-11-13. This is the working plan agreed so far; open decisions are listed at the end.

## Goal

Win new clients for LaunchTec through outreach that is researched and specific to each prospect, run across email, LinkedIn and Instagram, and instrumented so we learn what works. Results come first; cost comes second.

## Principle: build the brain, rent the rails

The custom software does what off-the-shelf tools do badly: research each prospect, write from that research, coordinate channels around one person, and record what works. Sending infrastructure (mailboxes, warm-up, delivery) is a commodity, so we plug into it instead of rebuilding it.

## Every message opens with a finding

LaunchTec's offer starts with an audit, so the software runs a small audit on each prospect before anyone writes to them. The message leads with one specific, true observation, then proof (Homestead Exteriors: $240K closed revenue and $300K+ pipeline in three months), then the free consultation.

Rules that keep this honest:

- A message may only state something stored as a signal with its evidence.
- Findings are graded `observed` (seen directly) or `likely` (inferred). A `likely` finding is worded with its caveat.
- The audit is read-only. It never submits a form, clicks a call button, or accepts a consent banner on a prospect's site.
- A page that fails to load is reported as not auditable, never as "nothing installed".

The finding is unique to the prospect. What we vary and test is the framing around it: angle, offer, tone, length and channel mix.

## Sourcing: signals, not a bought list

No Apollo or similar databases. A company gets on the list because something observable says it has the problem LaunchTec fixes right now, and that same signal becomes the opening line.

| Signal | Source | What it says |
|---|---|---|
| A competitor's ad shows on a search for their brand name | Google search results | "X is bidding on your name" |
| Running ads with broken or missing tracking | Ad libraries plus our site audit | The core audit finding |
| Same ads unchanged for months, or ads recently paused | Google and Meta ad libraries | Neglected account, or a restart case |
| Paying for shared leads | Angi, Thumbtack, HomeAdvisor listings | They buy leads but do not own a lead engine |
| Site or ads run by a large templated vendor | Site credits and script fingerprints | Often overpaying and unhappy |
| Hiring a marketing manager or PPC role | Job boards and careers pages | Budget exists and there is a gap |
| New marketing leader in the first 90 days | LinkedIn | New leaders re-evaluate agencies |
| Growth: new locations, rising reviews, many permits | Google Maps, permit and license records | Growing faster than their marketing |
| Exhibitor, association and "fastest growing" lists | Public lists | Already spending on marketing |

Finding the person: owner and marketing-lead names come from public sources (the company's site, contractor license records, state business filings). The email is derived from name plus domain and then verified.

Warm sources come first: existing LinkedIn connections, people who engage with LaunchTec content, past consultation bookings that did not close, and past clients.

None of these sources has been tested at scale yet. The first step is a feasibility run of each on about 50 companies; some will prove impractical or restricted by the source's terms.

## Channels

| Channel | Role | How it runs | Volume |
|---|---|---|---|
| Email | Main volume | Automated sending from separate domains (never launchtec.co); drafts approved by a person at first | About 150 emails a day, roughly 1,200 new prospects a month |
| LinkedIn | Higher-value prospects | Queue and drafts prepared by the software; mode of sending still to be decided | About 100 new people a week |
| Instagram | Experiment for ecommerce and local owners | Assist mode only: the software drafts, a person sends | 10–20 a day |
| Direct mail | Optional touch for the top few percent | Printed one-page audit, produced in-house | Small |

Constraints found in research (2026-11-13, from search excerpts rather than live pages; recheck before relying on them):

- LinkedIn publishes no numeric limits; the working consensus is about 100 connection requests a week. Automating a personal account breaches LinkedIn's User Agreement and risks restriction.
- Meta's official API cannot send a first Instagram message to someone who has not messaged the account. Unofficial automation carries a high ban risk.
- Gmail now rejects non-compliant mail. Sending domains need SPF, DKIM and DMARC, a spam-complaint rate under 0.3% (target under 0.1%), and a working unsubscribe.
- Working practice for cold email: separate domains, 3–4 mailboxes per domain, at most 30–50 emails per mailbox per day, 3–4 weeks of warm-up.

Legal baseline: US only to start. CAN-SPAM requires honest headers, a physical address and a working opt-out. Canada (opt-in) and the UK and EU are out of scope until handled separately.

## One prospect, one coordinated sequence

The unit is the person, not the message.

- One record per person holds their email, LinkedIn and Instagram identities.
- Every touch adds something new; no "did you see my email" repeats.
- A reply on any channel pauses all of them. An opt-out anywhere suppresses the person everywhere.
- LinkedIn throughput is the constraint, so the best-fit prospects (tier A) get the full cross-channel sequence and the rest (tier B) get email only.

Example tier A sequence: LinkedIn connection with no pitch, email with the finding, LinkedIn message with a second angle, Instagram follow and engagement, email with a screenshot as evidence, then an Instagram message or a closing email.

## Learning what works

- Every touch is tagged with segment, signal used, angle, offer, channel, step and variant.
- The metric is positive replies and booked meetings per 100 prospects. Open tracking stays off: it is unreliable and hurts deliverability.
- Volume limits what can be tested. Telling a 2% positive-reply rate from 4% takes about 1,100 prospects per variant, roughly one clean test a month. So we test big levers (segment, angle, offer, channel mix), not subject lines.
- Cross-channel lift is compared against email-only. At about 400 cross-channel prospects a month, that takes two to three months to read.
- Human edits to drafts are kept next to the original draft, so the drafting can learn from them.

## Pipeline

1. Source companies for a segment from signals.
2. Find and verify the decision-maker's contact details.
3. Research: run the audit and collect the other signals; score fit.
4. Draft the sequence for each channel.
5. Review queue: approve, edit or reject.
6. Send through the channel adapters, checking the suppression list first.
7. Read replies, classify them, and pause the sequence.
8. Track outcomes through meeting booked, held, proposal and closed revenue.

One database is the system of record, with a web app on top: review queue, unified inbox, pipeline and experiment dashboard.

## Estimated monthly cost

| Item | Estimate |
|---|---|
| 3 sending domains and 6–9 mailboxes | $30–70 |
| Email sending platform with API and webhooks | about $95 |
| Contact finding and verification | $50–100 |
| Prospect sourcing | $10–30 |
| Hosting and database | $25–50 |
| Core total | about $210–345, plus AI usage |
| Optional: Sales Navigator | about $120 |

AI research and drafting cost is usage-based and not yet priced. Prices came from search excerpts on 2026-11-13; confirm on the live pricing pages before buying.

## Phases

1. Week 1: buy sending domains and mailboxes and start warm-up (the longest lead time). Lock the first segment and offer.
2. Weeks 1–3: database, sourcing, research and drafting. Gate: 100 researched prospects with drafts, reviewed before anything sends.
3. Weeks 3–5: email sending, reply handling and the LinkedIn queue go live at low volume with the first experiment.
4. Weeks 6–8: experiment dashboard, second segment, Instagram assist.
5. After that: scale what is winning and reduce review to spot checks.

## Working assumptions

- First segment: home-services companies already running Google Ads. Second: ecommerce brands on Meta.
- Size: roughly $400K to $3M in revenue; smaller companies have closed before. Above about $5M they usually have in-house marketing or an agency. Worth testing as a separate experiment: larger companies where the research can prove the current work is poor.
- Method: modelled on a BDR who researched each company by hand, judged the fit, found the gap and wrote a personal message. The software does the digging and shortlisting; a person makes the call and owns the message.
- Offer: $1,600 a month per channel, plus a one-time $1,000 setup per channel when ad spend is under $10K a month.
- First goal: two good discovery calls. Quality of the list and message matters more than volume.
- US only.

## Open decisions

- LinkedIn sending mode: assist (a person clicks send) or automated. Linked Helper has been used on the account before; whether it can take per-prospect messages from this system is unverified.
- Past data to import: Instantly campaign exports (to tell a deliverability problem from a messaging problem, and to build a do-not-repeat list) and Linked Helper exports (who accepted and replied; existing connections as a warm pool).
- Hosting: the app is set up for Render's free web service with a free Neon database, which is enough to review work in progress. The free web service sleeps when idle; move to a paid instance (about $7 a month) once the app is used daily or runs scheduled work.
