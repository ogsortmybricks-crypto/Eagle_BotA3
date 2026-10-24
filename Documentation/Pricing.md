# Pricing

*For the Eagle Bot author. As of October 24, 2026.*

Eagle Bot charges one flat price per academy, at or just under what academies
already pay for Journey Tracker.

---

## Plans

| Plan | Price | What it includes |
| --- | --- | --- |
| Free demo | 90 days | Every feature; a survey near the end asks how it went and whether to keep it |
| Founding Academy (first 10) | $59/mo or $590/yr | Every feature; price locked while they stay; in return, feedback and a testimonial |
| Academy | $99/mo or $990/yr | Every feature, unlimited studios, fair-use AI with no surprise bills |

How the demo, survey and checkout work in the app:
[Plans-and-Support.md](Plans-and-Support.md).

## Why this shape

- **Priced against Journey Tracker.** Academies pay about $50/mo in year one
  and $100/mo after for the network's own core software (see
  [acton-network.md](../Acton_Context/acton-network.md)). Eagle Bot sits next
  to it, so costing more than the core tool is a hard sell.
- **One paid plan, not tiers.** Eagle Bot is sold and supported by one person,
  online. Separate Studio and Academy tiers mean more to explain and more
  billing questions. A Founding discount on one plan is enough.
- **Never per learner.** Learners are the users, so a per-seat price would make
  the bill go up as learners use it more. Owners also dislike per-seat math.
- **Annual billing on the school year.** Many owners set budgets in summer, so
  an annual price that renews in August fits how they already plan.
- **No cut of the Tac-On market for now.** Taking a share of learner-built
  Tac-Ons adds billing work and undercuts the idea that Tac-Ons belong to the
  learners.

## Costs and margin

An academy costs an estimated $28/mo to run, so $99 leaves about a 70% gross
margin and $59 about 50%. These estimates assume Claude Opus 5 for every AI
job and a typical 3-studio academy.

| Cost | Per academy per month |
| --- | --- |
| Claude API (wiki rebuilds, Town Halls, elections, with a 50% buffer) | ~$18 |
| Hosting headroom above Replit's included credit | ~$10 |
| **Variable total** | **~$28** |
| Fixed: Claude plan + Replit Core, shared by all academies | ~$45 total |

To protect the margin at these prices:

1. Keep prompt caching working (already on).
2. Run Town Halls and elections at `medium` effort.
3. Move Town Halls and elections to Claude Sonnet, keeping Opus for wiki
   builds (`ANTHROPIC_MODEL` in [server/env.ts](../server/env.ts)). This is
   estimated to cut those jobs by about 60%. Test it on real meetings first.

## Break-even

Two Founding academies cover the fixed costs. Cost below = $45 fixed + $28 per
academy.

| Paying academies | Revenue/mo | Cost/mo | Profit/mo |
| --- | --- | --- | --- |
| 1 Founding | $59 | $73 | -$14 |
| 2 Founding | $118 | $101 | $17 |
| 5 Founding | $295 | $185 | $110 |
| 10 Founding | $590 | $325 | $265 |
| 10 Founding + 10 Academy | $1,580 | $605 | $975 |

## Before locking the $99 price

- [ ] Total each pilot academy's real token use from the `ai_jobs` table and
      replace the $18 API estimate
- [ ] Check Replit's usage page monthly and replace the $10 hosting estimate
- [ ] Confirm current Claude API and Replit prices on their pricing pages
- [ ] Confirm the Journey Tracker price with a few owners
- [ ] Test Sonnet or `medium` effort on real Town Halls before switching
