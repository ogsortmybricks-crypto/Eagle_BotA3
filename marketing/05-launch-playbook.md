# 05 · Launch Playbook

The first 90 days, the team that runs them, and the numbers to watch.

## Learner sales team

Selling Eagle Bot to other academies is a natural Launchpad or Middle Studio
Quest: real customers, real money, a real Exhibition at the end. Suggested
roles (the studio should decide its own, and elect them):

| Role | Does |
| --- | --- |
| **Demo lead** (×2) | Runs the 30-minute demo. Knows the product cold. |
| **Scan runner** | Uploads a lead's Contract, runs the wiki build, writes the findings summary. |
| **Pilot buddy** (one per pilot academy) | Weekly check-in with the pilot studio's learners. Reports stalled moments. |
| **Tac-On lead** | Keeps Eagle's Tac-Ons polished in the market, runs the Tac-On Jam. |
| **Numbers keeper** | Keeps the tracker below up to date; reports at Town Hall. |

**An adult always handles:** contracts, payments, privacy questions, and any
contact with another academy's learners that isn't in a supervised group call.

## The 90 days

### Days 1–30: Get ready

- [ ] Finish the "before we can charge" list in
      [03](03-pricing-and-costs.md#before-we-can-charge-anyone).
- [ ] Set up a demo academy on production with a realistic fake studio.
- [ ] Build the scan sign-up page (the landing page copy is in
      [04](04-messaging.md#landing-page-copy)).
- [ ] Run the scan on Eagle's own Contract and every studio's; write up the
      best finding as the first story.
- [ ] Learners rehearse the demo three times, once with an owner from outside
      the team.
- [ ] Write the one-page parent explainer.
- [ ] Set a spend limit on the production Anthropic API key.

### Days 31–60: First pilots

- [ ] Personally ask 10 owners we already know to try the free scan.
- [ ] Post the first story in the owner community.
- [ ] Run every demo that gets booked. Record (with permission) the best one.
- [ ] Start 3–5 pilots. Assign a pilot buddy to each.
- [ ] Weekly: review the pilot tracker, call any stalled Guide.

### Days 61–90: First revenue

- [ ] Day-28 owner calls for the first pilots; offer Founding Academy.
- [ ] Ask every converted owner for one referral.
- [ ] Run the first Tac-On Jam with learners from every pilot academy.
- [ ] Learners present the Quest (numbers, what worked, what didn't) at
      Exhibition.
- [ ] Update the conversion targets in [02](02-funnel.md) with real numbers.
- [ ] Update the API estimate in [03](03-pricing-and-costs.md) with real
      `ai_jobs` numbers.

## Pilot tracker

Keep one row per pilot academy (a spreadsheet, or a Tac-On once one exists for
it).

| Academy | Studio | Buddy | Start | Wiki built | Town Hall | Election + Bucks | Learner dev | Day-28 call | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| *example* | *Launchpad* | *Name* | *Oct 6* | ✅ Oct 6 | ✅ Oct 10 | ⏳ | — | Nov 3 | — |

## The numbers to watch

Report these at every Town Hall where the sales team presents.

| Number | Where it comes from | Healthy |
| --- | --- | --- |
| Scans requested this month | Sign-up page | Rising month over month |
| Scan → demo | Booking link | ≥ 50% |
| Demo → pilot | Pilot agreements | ≥ 60% |
| Pilot → paying | Billing | ≥ 50% |
| Moments hit per pilot | Pilot tracker | 4 of 4 |
| API cost per academy | `ai_jobs` table × prices | ≤ $25 |
| Fixed costs | Claude + Replit invoices | ~$45 |
| Studios per paying academy | Admin | Rising |
| Tac-Ons installed outside Eagle | Tac-On market install counts | Rising |

## What would change this plan

- **Scans don't convert to demos:** the findings aren't compelling. Make the
  report shorter and lead with the single worst contradiction.
- **Pilots stall at "First Town Hall":** the studio doesn't take notes in a form
  we can paste. Add a meeting-notes template to the pilot kit.
- **API cost per academy is well above $25:** apply the cost levers in
  [03](03-pricing-and-costs.md#ways-to-cut-api-cost-if-we-need-to), starting
  with effort on Town Halls.
- **Owners love it but won't pay $149:** lead with the Studio plan and expand
  per session instead.
