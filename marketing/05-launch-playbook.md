# 05 · Launch Playbook

The first 90 days, run by one person, and the numbers to watch.

## Running it solo

Eagle Bot is built, sold and supported by one person. There is no sales team
and no learner squad behind the demo. That's fine at this size, but it means
**time is the real limit, not money**. The plan is built around that:

- **Nothing in person.** Every step happens online: posts, messages, video
  calls, email. No travel to gatherings, Exhibitions or other academies' Town
  Halls.
- **Pilot questions come to me.** Each pilot academy gets one contact (email,
  plus a call when something is stuck). No buddies, no second line.
- **Cap the work in flight.** At most **3 pilots running at once** and **10
  scans a month**. If more people want in, they go on a short waitlist. A
  waitlist is a good sign, not a problem.
- **Do things once.** Record the demo once and reuse it. Write each email once
  and template it. Keep a pilot kit (meeting-notes template, setup checklist) so
  every pilot starts the same way.

### A week, roughly

| Block | Time | What |
| --- | --- | --- |
| Outreach | ~1 hr | Posts, LinkedIn messages, replies |
| Scans | ~30 min each | Run the wiki build, write the findings email |
| Demos | 30 min each | Live calls |
| Pilot support | ~1 hr | Answer questions, check the tracker, one check-in per pilot |
| Building | the rest | Fixes pilots asked for come first |

## The 90 days

### Days 1–30: Get ready

- [ ] Finish the "before we can charge" list in
      [03](03-pricing-and-costs.md#before-we-can-charge-anyone).
- [ ] Set up a demo academy on production with a realistic fake studio.
- [ ] Build the scan sign-up page (the landing page copy is in
      [04](04-messaging.md#landing-page-copy)).
- [ ] Run the scan on Eagle's own Contract; write up the best finding as the
      first story.
- [ ] Record the 3-minute walkthrough video (see
      [02](02-funnel.md#3--convinced--the-live-demo)).
- [ ] Rehearse the live demo twice, once with someone who has never seen
      Eagle Bot.
- [ ] Write the one-page parent explainer and the pilot kit.
- [ ] Set a spend limit on the production Anthropic API key.
- [ ] Clean up the LinkedIn profile so it says what Eagle Bot is and links to
      the scan page.

### Days 31–60: First pilots

- [ ] Personally message 10 owners or Guides already known (LinkedIn, email,
      zone contacts) and offer the free scan.
- [ ] Post the first story on LinkedIn and in any owner/Guide groups there's
      access to.
- [ ] Run every demo that gets booked.
- [ ] Start up to 3 pilots.
- [ ] Weekly: review the pilot tracker, check in on any stalled moment.

### Days 61–90: First revenue

- [ ] Day-28 owner calls for the first pilots; offer Founding Academy.
- [ ] Ask every converted owner for one referral.
- [ ] Run the first online Tac-On Jam for learners at pilot academies (see
      [02](02-funnel.md#6--advocate--every-studio-and-learners-publishing)).
- [ ] Update the conversion targets in [02](02-funnel.md) with real numbers.
- [ ] Update the API estimate in [03](03-pricing-and-costs.md) with real
      `ai_jobs` numbers.

## Pilot tracker

Keep one row per pilot academy (a spreadsheet, or a Tac-On once one exists for
it).

| Academy | Studio | Contact | Start | Wiki built | Town Hall | Election | Learner dev | Day-28 call | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| *example* | *Launchpad* | *Name* | *Oct 6* | ✅ Oct 6 | ✅ Oct 10 | ⏳ | — | Nov 3 | — |

## The numbers to watch

Check these once a month.

| Number | Where it comes from | Healthy |
| --- | --- | --- |
| Scans requested this month | Sign-up page | Rising month over month |
| Scan → demo | Booking link | ≥ 50% |
| Demo → pilot | Pilot agreements | ≥ 60% |
| Pilot → paying | Billing | ≥ 50% |
| Moments hit per pilot | Pilot tracker | 4 of 4 |
| Hours per week on support | Your own log | Falling per pilot as the kit improves |
| API cost per academy | `ai_jobs` table × prices | ≤ $25 |
| Fixed costs | Claude + Replit invoices | ~$45 |
| Studios per paying academy | Admin | Rising |
| Tac-Ons installed outside Eagle | Tac-On market install counts | Rising |

## What would change this plan

- **Scans don't convert to demos:** the findings aren't compelling. Make the
  report shorter and lead with the single worst contradiction.
- **Pilots stall at "First Town Hall":** the studio doesn't take notes in a form
  we can paste. Add a meeting-notes template to the pilot kit.
- **Support eats the week:** the same questions keep coming up. Turn each one
  into a help page or an in-app hint before taking another pilot.
- **API cost per academy is well above $25:** apply the cost levers in
  [03](03-pricing-and-costs.md#ways-to-cut-api-cost-if-we-need-to), starting
  with effort on Town Halls.
- **Owners love it but won't pay $149:** lead with the Studio plan and expand
  per session instead.
