# Plans, the free demo, and Help

*Plans and the survey are for admins. The Help button and the survey's
feedback questions are for everyone.*

Every new academy gets Eagle Bot free for 90 days. Near the end, everyone is
asked how it went, and an admin decides whether to keep it. The first ten
academies that keep it get the Founding Academy price for as long as they stay.
After that, new academies join on the Academy plan.

---

## The free demo

The demo starts when the academy is set up and lasts 90 days. Everything works
during it.

- **Admins** see how many days are left at the top of every page, and under
  **Plan & billing** in the menu.
- **Everyone** sees a reminder in the last 14 days asking for their thoughts.

## The survey

Open it from the reminder, or go to **Plan & billing** (admins) or `/plan`.

Everyone is asked for a rating out of five, what has worked well, and what
should be better. Admins are also asked whether the academy would like to keep
using Eagle Bot. You can change your answers any time before the demo ends.

Answers go to the person who makes Eagle Bot. Nobody else in the academy sees
them.

## Picking a plan

Admins do this under **Plan & billing**.

1. Choose monthly or yearly. Yearly is two months free.
2. Press **Continue to checkout**. You pay on Stripe and come straight back.
3. Eagle Bot checks the payment with Stripe and switches the academy to its
   plan.

The page tells you which plan you'll get. While Founding Academy spots are
left, it's the Founding plan and says how many remain. Once all ten are taken,
it's the Academy plan. Neither plan charges per learner or per studio.

Once you're on a plan, **Manage billing** opens Stripe, where you can change
your card, switch between monthly and yearly, see invoices, or cancel.

## When the demo ends without a plan

Eagle Bot becomes **read-only**. Nothing is deleted.

- Everyone can still read the wiki, positions, elections and history.
- Nothing new can be made or changed until an admin picks a plan. Trying shows
  a message saying why.
- The survey, the Help button and picking a plan keep working.
- Admins can download the whole wiki and every position, with who holds it
  now, as one Markdown file: **Plan & billing → Download wiki & positions**.
  The download works on any plan, at any time.

If a payment fails, Stripe retries it and Eagle Bot keeps working meanwhile.
If the subscription is cancelled or Stripe stops retrying, the academy goes
read-only again.

## Help

The **Help** button sits in the bottom corner of every page, including the
simple view. Use it to ask a question, request a feature, report something
broken, or just say what you think.

- Only you see what you sent. Admins don't see learners' messages.
- The answer appears under **My messages**, with a dot until you've read it.
  It's also emailed to you when email is set up.
- Reply in the same thread to follow up.

---

## For the person running Eagle Bot

### Setting up payments

Add these to the environment (Replit Secrets):

| Variable | What it is |
| --- | --- |
| `STRIPE_SECRET_KEY` | Your Stripe secret key |
| `STRIPE_PRICE_FOUNDING_MONTHLY` | Price ID of the Founding plan, monthly |
| `STRIPE_PRICE_FOUNDING_YEARLY` | Price ID of the Founding plan, yearly |
| `STRIPE_PRICE_ACADEMY_MONTHLY` | Price ID of the Academy plan, monthly |
| `STRIPE_PRICE_ACADEMY_YEARLY` | Price ID of the Academy plan, yearly |
| `SUPPORT_EMAIL` | Where survey answers, new Help messages and new subscriptions are emailed |
| `APP_URL` | The app's public URL. Stripe sends people back here after checkout |

Create the two products and four recurring prices in Stripe first. The
amounts shown in the app are read from Stripe, so change prices there, not in
code. Turn on Stripe's customer portal (Settings → Billing → Customer portal)
so **Manage billing** works.

Without these variables, the demo, survey, read-only mode and Help all still
work. The plan page just says online payment isn't set up yet.

**Every deployment must use the same Stripe account.** Founding spots are
counted from active Founding subscriptions in Stripe, which is the only place
every deployment can see. No webhooks are needed: the app confirms each
checkout when the admin returns, and re-reads each subscription from Stripe
every six hours.

If two academies check out within seconds of each other with one spot left,
both can get the Founding price.

### The dev portal

Two tabs in the dev portal (Ctrl+D) cover this:

- **Support**: every Help message, open ones first. Answer, answer and close,
  or close. A reply from the sender reopens a closed message.
- **Academies**: each academy's plan, how long its demo has left, and every
  survey answer. **+30 days** extends a demo. It counts from today if the demo
  has already ended.

Each deployment has its own portal, so Help messages and survey answers from
an academy show up in that academy's deployment. With `SUPPORT_EMAIL` set,
they also all reach one inbox.
