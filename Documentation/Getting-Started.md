# Setting up Eagle Bot for your academy

*For whoever sets Eagle Bot up at a new academy, usually the owner, a guide or
a learner admin. The last section is for the person who runs Eagle Bot.*

Setting up takes about an hour, spread over a few days:

1. Set up the academy (10 minutes).
2. Upload each studio's rule documents and build the wiki (a few minutes per
   studio, plus time to settle what the AI flags).
3. Check the positions the AI found.
4. Invite everyone.
5. Run your first Town Hall in Eagle Bot.

Your academy gets 90 days free from step 1. See
[Plans and Help](Plans-and-Support.md).

---

## 1. Set up the academy

Open the Eagle Bot link you were sent. The first visit opens **Set up Eagle
Bot**, which has four steps.

**Your academy**

- **Academy name**, as people say it, e.g. *Acton Academy Riverbend*.
- **Email domain**, e.g. `riverbendacton.com`. Only people with an email on
  this domain can be invited, which keeps outsiders out of the academy's
  records. It can't be skipped, so use the domain your learners and guides
  actually have addresses on.
- **What your academy calls its learners**: Hero, Eagle, Explorer. Each studio
  can use its own word later.
- **Guides can vote in elections**: off by default, since governance belongs to
  the studio. You can turn it on per studio later.

**Studios**

Each studio keeps its own rules, positions and Town Halls. Nothing crosses
between studios unless you file it academy-wide.

- Add the studios you run. **Start from the usual ones** offers Spark,
  Discovery, Middle Studio, Launchpad and Staff. Rename them to match yours.
- Give each one a sentence of description. The AI reads it when it writes that
  studio's wiki.
- If two studios govern together (one Contract, one Town Hall), set that up
  later under **Settings → Studio groups**. See
  [Studio groups](Studio-Groups.md).

**Look and feel**

Pick a colour palette and, if you like, upload your logo (PNG or SVG, under
500 KB). Each studio has its own accent colour, set in the previous step.

**Your account**

Enter your name, an email on the academy's domain, a password of at least 8
characters, and which studio you're in. You become the first admin. Every
setting can be changed later under **Settings**.

## 2. Build each studio's wiki

This is where Eagle Bot earns its place: one current set of rules instead of a
pile of Google Docs.

1. Gather each studio's rule documents: the Contract, the ROE, Town Hall notes
   that changed rules. From Google Docs, use **File → Download** and pick
   **.docx** or **.pdf**.
2. Open **Wiki** and pick one studio in the studio switcher. The AI builds one
   studio at a time.
3. Press **Upload [studio]'s documents** and add that studio's files. Eagle Bot reads
   text-based .pdf, .docx, .md, .txt, .html and .rtf files, up to 15 MB each
   and 20 at once. Scanned PDFs with no text in them won't work.
4. Press **Build the wiki**. It takes a few minutes. You can leave the page.
5. Repeat for each studio.

When a build finishes, the amber box at the top of the wiki lists what the AI
couldn't settle on its own: documents that contradict each other, gaps, unclear
wording, and things that need a vote. It drafts a fix for each one. Read them
with your learners and accept, change or dismiss each. See
[Settling what the AI flags](Settling-Findings.md).

## 3. Check the positions

The AI lists every elected position it found in the documents: Mayor, Hero
Buck Committee, and so on. Open **Positions** and, for each studio:

- fix titles, seats and term lengths
- add any positions the documents never wrote down
- archive anything you no longer use

Who currently holds each position can be filled in once people have joined.

## 4. Invite everyone

Open **Admin → Invites**.

1. Paste email addresses, one per line or separated by commas. They must be on
   the academy's domain.
2. Pick the studio they're joining and their role:
   - **Learner**: reads the wiki, runs for positions, votes.
   - **Secretary**: takes Town Hall notes and processes them into the wiki.
   - **Guide**: reads everything, decides nothing.
   - **Admin**: full control over settings, invites, the wiki and elections.
3. Send. Each person gets an email with a link to set their password. If email
   isn't set up, you get a link for each person to pass on yourself. Invites
   expire after a few days (set under **Settings → Notifications**).

A few things worth doing while you're here:

- **Assign guides to studios** so each guide opens on the right one. See
  [Studio guides](Studio-Guides.md).
- **Hand the running of Eagle Bot to a learner** if that's how your academy
  works: make them an admin and tick **Learner admin**. See
  [Learner admins](Learner-Admins.md).
- **Turn on the simple view** for your youngest studio under **Settings →
  Studios**. It gives those learners four big screens: rules, voting, jobs and
  what's coming up.

## 5. Run your first Town Hall

Have the studio's secretary open **Town Hall**, press **New meeting**, and take
notes in it during the meeting. Afterwards they press **Process with AI**. The AI
updates the wiki, removes rules the meeting replaced, and asks whether anything
needs an election. Depending on your settings, changes may wait for approval
first. See [Town Hall approvals](Town-Hall-Approvals.md).

Once a Town Hall has gone through Eagle Bot, the studio has stopped needing the
old Google Doc.

## After that

- **Calendar**: sessions, Quests, breaks and field trips. See
  [Calendar](Calendar.md).
- **Tac-Ons**: add-ons learners can install from the market or build
  themselves. See [Tac-Ons](Tac-Ons.md).
- **Settings**: Governance, Elections, Town Hall, AI, Access and Display all
  have their own tabs. The defaults follow the Acton model, so change them only
  when your studios ask.
- **Help**: the Help button in the corner of every page reaches the person who
  makes Eagle Bot.

---

## For the person running Eagle Bot: a new academy

Each academy runs on its own Eagle Bot deployment. To set one up:

1. **Create the deployment** from this repository on Replit, with its own
   Replit PostgreSQL database. Run `npm run db:push` once to create the
   tables.
2. **Add the secrets** (see [.env.example](../.env.example)):
   - `SESSION_SECRET`: a long random string.
   - `APP_URL`: the deployment's public URL.
   - `ANTHROPIC_API_KEY`: needed for building the wiki and processing Town
     Halls.
   - `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`: for invite and answer emails.
   - `DEV_PORTAL_SETUP_KEY`: required before the dev portal can be claimed in
     production.
   - `STRIPE_SECRET_KEY` and the four `STRIPE_PRICE_*` IDs, the same as on
     every other deployment, plus `SUPPORT_EMAIL`. See
     [Plans and Help](Plans-and-Support.md#setting-up-payments).
3. **Publish**, then claim the dev portal with Ctrl+D and the setup key.
   Don't share the setup key with the academy: the portal publishes Tac-Ons
   and answers Help messages.
4. **Send the academy's admin the URL** and this guide. Their first visit
   opens the setup wizard, and their 90-day demo starts when they finish it.
5. **Check in after a week.** The portal's **Academies** tab shows how many
   days are left and any survey answers. Use **+30 days** if they started late.

Setup can only be done once per deployment. A second academy needs its own
deployment.
