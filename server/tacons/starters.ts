/**
 * The Tac-Ons that ship with Eagle Bot.
 *
 * They exist for three reasons. An empty market teaches nobody anything. An
 * academy that installs one gets something genuinely useful on day one. And a
 * learner opening the dev menu can read the source of a Tac-On they have
 * already seen working, which is how most people start writing their first.
 *
 * They are ordinary Tac-Ons once published: an academy can uninstall them, and
 * a dev can fork the source.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { taconInstalls, taconRecords, taconVersions, tacons } from "@shared/schema";
import { compile } from "@shared/tacons";

type Starter = {
  slug: string;
  tagline: string;
  description: string;
  category: string;
  source: string;
};

/**
 * Official Tac-Ons that used to ship and no longer do.
 *
 * Kept as a list rather than quietly dropped, because removing a Tac-On from
 * `STARTERS` is not enough on a server that already seeded it - the listing,
 * its installs and the rows those installs recorded are all still there. The
 * seeder deletes them by slug, once, and says how much it deleted.
 */
export const RETIRED_STARTER_SLUGS = [
  "hero-bucks",
  "quest-board",
  "gratitude-wall",
  "buck-shop",
] as const;

export const STARTERS: Starter[] = [
  {
    slug: "eagle-bucks",
    tagline: "The Shopkeeper's ledger: points earned, bucks exchanged, guardrails paid.",
    category: "tracking",
    description: `The Eagle Bucks economy, written down where everybody can see it instead of
kept in one person's notebook.

**What it adds**

- An *Eagle Bucks* page: your balance, the points you have banked, and every
  buck the studio has moved in or out.
- A form any learner can log Core Skills, Quest or community points with, once
  the work is documented on the Journey Tracker.
- A ledger only Admin and Secretary can post to - the Shopkeeper's counter.
  Eagle Bot has no Shopkeeper role, so the position's name is a setting and the
  posting rights sit with Admin and Secretary.
- A *Shop* page with the price list, and what has been bought lately.
- Requests between learners, and a panel on Town Hall showing the ones waiting
  on a debate.

**The rules it carries**

100 points make one Hero Buck and nobody holds more than ten, both settings you
can change at install. Eagle Bucks may go negative; points may not. A standard
guardrail costs 1 buck and a malicious one costs 2, also settings.

Nothing here edits a row after it is filed: a request that Town Hall settles is
cleared from the list and the outcome is posted to the ledger, which keeps the
ledger the only place a balance can change.

Other Tac-Ons can read \`points\`, \`ledger\` and \`balance\`, so a raffle or an
end-of-term summary can be built on top without copying the ledger.`,
    source: `# Eagle Bucks - the economy, on the same shelf as the Contract.
tacon eagle-bucks {
  name "Eagle Bucks"
  version 1.0.0
  about "Points in, bucks out, and every guardrail and purchase in between."
  icon coins
  category tracking
  provides points, ledger, balance

  setting shopkeeper {
    label "Who holds the Shopkeeper position"
    type text
    default "Jian Kramer"
    hint "The Shopkeeper oversees the economy. Change this when the position changes hands."
  }

  setting points_per_buck {
    label "Points that make one Hero Buck"
    type number
    default 100
  }

  setting hold_limit {
    label "Most Hero Bucks one person may hold"
    type number
    default 10
  }

  setting standard_guardrail {
    label "What a standard guardrail costs"
    type number
    default 1
    hint "A non-malicious guardrail."
  }

  setting malicious_guardrail {
    label "What a malicious guardrail costs"
    type number
    default 2
  }

  # Points come first: they are what the work turns into.
  store points {
    label "Points earned"
    field hero person required
    field source choice core-skills, quest, community required
    field amount number required
    field evidence text
  }

  # Everything that moves a buck. Bucks going out are a negative amount, which
  # is why a balance can end up below zero - it is allowed to.
  store ledger {
    label "Eagle Bucks entry"
    field hero person required
    field amount number required
    field kind choice exchange, guardrail, purchase, borrow, transfer, correction required
    field points_used number
    field reason text
  }

  # A learner may ask another learner for bucks. Town Hall decides whether the
  # request is a fair one; if it stands, the Shopkeeper posts the transfer.
  store request {
    label "Request"
    field hero person required
    field asked person required
    field amount number required
    field why longtext required
  }

  store price {
    label "Price"
    field item text required
    field cost number required
    field notes text
  }

  ask balance sum of ledger.amount where ledger.hero is me.id
  ask banked_points sum of points.amount where points.hero is me.id
  ask traded_points sum of ledger.points_used where ledger.hero is me.id
  ask spare_points my.banked_points minus my.traded_points
  ask worth my.spare_points divided by setting.points_per_buck
  ask waiting count of request

  page bucks {
    title "Eagle Bucks"
    icon coins
    nav true
    subtitle "What you have earned, what you have spent, and what it cost."

    note "{setting.shopkeeper} is the Shopkeeper. Bucks have to be earned - they can't be borrowed or loaned." info

    stat "Your balance" {
      value my.balance
      hint "Eagle Bucks can go into the negatives. Points can't."
    }

    stat "Points not yet exchanged" {
      value my.spare_points
      hint "{setting.points_per_buck} points make one Hero Buck."
    }

    stat "Room to earn" {
      value setting.hold_limit minus my.balance
      hint "Nobody holds more than {setting.hold_limit} Hero Bucks."
    }

    stat "In circulation" {
      value sum of ledger.amount
      hint "Every buck the studio is holding, added up."
    }

    note "Those points come to {my.worth} Hero Bucks - the till only pays out whole ones."

    divider

    heading "Log the work"

    note "Document the work on the Journey Tracker first. Core Skills work, Quest work and serving the community all count."

    form "Log points" {
      into points
      ask hero "Who did the work?"
      ask source "What kind of work?"
      ask amount "How many points?"
      ask evidence "Where is it documented?"
      submit "Log the points"
      then { notify "Points logged, waiting on the Shopkeeper to exchange them." }
    }

    list points {
      title "Points earned"
      columns hero, source, amount, evidence, created
      sort newest
      limit 50
      empty "No points logged yet. Document the work first, then log it here."
      allow remove admin, secretary
    }

    divider

    heading "The ledger"

    note "A standard or non-malicious guardrail costs {setting.standard_guardrail}. A malicious one costs {setting.malicious_guardrail}. Borrowing any school item has to be bought with Eagle Bucks." warning

    form "Move some bucks" {
      into ledger
      ask hero "Whose bucks?"
      ask amount "How many? Put a minus in front of bucks going out."
      ask kind "What moved them?"
      ask points_used "Points handed in, if this is an exchange"
      ask reason "Why?"
      allow admin, secretary
      submit "Post it to the ledger"
    }

    list ledger {
      title "Every buck in and out"
      columns hero, amount, kind, points_used, reason, by, created
      sort newest
      limit 60
      empty "The ledger is empty. The first line is usually somebody cashing in points."
      allow remove admin
    }

    divider

    heading "Asking another learner"

    note "A learner may ask another for Eagle Bucks. Town Hall can debate whether the request is a fair one - if it stands, the Shopkeeper posts a transfer to the ledger and the request comes off this list."

    form "Ask someone for bucks" {
      into request
      ask hero "Who is asking?"
      ask asked "Who are they asking?"
      ask amount "How many bucks?"
      ask why "What for?"
      submit "File the request"
    }

    list request {
      title "On the table"
      columns hero, asked, amount, why, created
      sort newest
      limit 30
      empty "No requests waiting."
      allow remove admin, secretary
    }
  }

  page shop {
    title "The Shop"
    icon shopping-bag
    nav true
    subtitle "What Eagle Bucks buy, and what they bought lately."

    note "Your balance: {my.balance} Eagle Bucks. {setting.shopkeeper} keeps the till." info

    list price {
      title "The price list"
      columns item, cost, notes
      sort az
      limit 40
      empty "Nothing priced yet. A lunch period of video games is 2 Eagle Bucks; first pick of the Studio-Maintenance job is 1."
      allow remove admin, secretary
    }

    form "Price something" {
      into price
      ask item "What's for sale?"
      ask cost "How many Eagle Bucks?"
      ask notes "Anything to know?"
      allow admin, secretary
      submit "Add it to the list"
    }

    divider

    list ledger {
      title "Bought lately"
      columns hero, amount, reason, created
      where ledger.kind is "purchase"
      sort newest
      limit 20
      empty "Nothing bought yet."
    }
  }

  panel on town-hall {
    title "Eagle Bucks on the table"
    note "Requests waiting on a debate: {my.waiting}."
    list request {
      columns hero, asked, amount, why
      limit 5
      empty "No requests waiting."
    }
  }
}`,
  },
];

/**
 * Publishes the starters and deletes the retired ones.
 *
 * Runs every boot and is idempotent: a Tac-On already in the market is left
 * exactly as it is, version and all. Anything that fails to compile is skipped
 * with a loud log rather than taking the server down with it - a broken starter
 * is a bug in Eagle Bot, not a reason an academy can't sign in.
 */
export async function seedStarters(): Promise<void> {
  await retireStarters();

  for (const starter of STARTERS) {
    const result = compile(starter.source);
    if (!result.ok) {
      const first = result.diagnostics.find((entry) => entry.severity === "error");
      console.error(
        `[tacons] the starter "${starter.slug}" doesn't compile - line ${first?.line}: ${first?.message}`,
      );
      continue;
    }

    const manifest = result.manifest;
    const [already] = await db
      .select({ id: tacons.id })
      .from(tacons)
      .where(eq(tacons.slug, manifest.slug))
      .limit(1);
    // Someone is already running it. Publishing over a version that exists is
    // refused everywhere else in Eagle Bot, and startup is no exception.
    if (already) continue;

    const [tacon] = await db
      .insert(tacons)
      .values({
        slug: manifest.slug,
        name: manifest.name,
        tagline: starter.tagline,
        description: starter.description,
        icon: manifest.icon,
        category: starter.category,
        academyId: null,
        authorName: "Eagle Bot",
        official: true,
        visibility: "public",
      })
      .returning();

    const [version] = await db
      .insert(taconVersions)
      .values({
        taconId: tacon.id,
        version: manifest.version,
        source: starter.source,
        manifest: manifest as unknown as Record<string, unknown>,
        changelog: "First release.",
      })
      .returning();

    await db
      .update(tacons)
      .set({ latestVersionId: version.id })
      .where(eq(tacons.id, tacon.id));

    console.log(`[tacons] published the official Tac-On "${manifest.slug}" to the market`);
  }
}

/**
 * Removes the official Tac-Ons that no longer ship.
 *
 * This deletes rows an academy recorded, which is the same bargain removing any
 * Tac-On makes - so it counts them first and says so in the log. Only official
 * listings are touched: a learner's own Tac-On is never anybody else's to pull.
 */
async function retireStarters(): Promise<void> {
  const doomed = await db
    .select({ id: tacons.id, slug: tacons.slug })
    .from(tacons)
    .where(and(inArray(tacons.slug, [...RETIRED_STARTER_SLUGS]), eq(tacons.official, true)));

  if (doomed.length === 0) return;

  const ids = doomed.map((row) => row.id);
  const installs = await db
    .select({ id: taconInstalls.id })
    .from(taconInstalls)
    .where(inArray(taconInstalls.taconId, ids));

  let records = 0;
  if (installs.length > 0) {
    const [counted] = await db
      .select({ total: sql<number>`count(*)` })
      .from(taconRecords)
      .where(inArray(taconRecords.installId, installs.map((row) => row.id)));
    records = Number(counted?.total ?? 0);
  }

  // Versions, installs and records all cascade from the listing.
  await db.delete(tacons).where(inArray(tacons.id, ids));

  console.log(
    `[tacons] retired ${doomed.length} official Tac-On(s) (${doomed
      .map((row) => row.slug)
      .join(", ")}): ${installs.length} install(s) and ${records} recorded row(s) deleted`,
  );
}
