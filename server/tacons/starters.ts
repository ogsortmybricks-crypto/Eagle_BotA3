/**
 * The Tac-Ons that ship with Eagle Bot.
 *
 * They exist for three reasons. An empty market teaches nobody anything. An
 * academy that installs one gets something genuinely useful on day one. And a
 * learner opening the dev menu can read the source of a Tac-On they have
 * already seen working, which is how most people start writing their first.
 *
 * They are seeded once, when the registry is empty, and are ordinary Tac-Ons
 * afterwards: an academy can uninstall them, and a dev can fork the source.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { taconVersions, tacons } from "@shared/schema";
import { compile } from "@shared/tacons";

type Starter = {
  slug: string;
  tagline: string;
  description: string;
  category: string;
  source: string;
};

export const STARTERS: Starter[] = [
  {
    slug: "hero-bucks",
    tagline: "A ledger for the currency your studio already runs on.",
    category: "tracking",
    description: `Most Actons run some form of Hero Bucks, and most of them run it on a
whiteboard that gets wiped. This keeps the ledger where the rest of governance lives.

**What it adds**

- A *Hero Bucks* page with every entry, and a running total.
- A form the Secretary and Admin can log earnings and spends with.
- A balance for each Hero, readable by other Tac-Ons.
- Ten bucks awarded automatically to whoever wins an election.

Other Tac-Ons can read \`entry\` and \`balance\`, so a shop or a raffle can be
built on top of it without copying the ledger.`,
    source: `# Hero Bucks - the ledger, not the whiteboard.
tacon hero-bucks {
  name "Hero Bucks"
  version 1.0.0
  about "Every buck earned and spent, in one place instead of on a whiteboard."
  icon coins
  category tracking
  provides entry, balance

  setting election_award {
    label "Bucks for winning an election"
    type number
    default 10
  }

  store entry {
    label "Ledger entry"
    field hero person required
    field amount number required
    field kind choice earn, spend
    field reason text
  }

  ask balance sum of entry.amount where entry.hero is me.id

  page bucks {
    title "Hero Bucks"
    icon coins
    nav true
    subtitle "The studio's ledger. Every line says who, how much and why."

    note "You're holding {my.balance} bucks."

    stat "In circulation" {
      value sum of entry.amount
      hint "Across every entry in the ledger."
    }

    stat "Entries" count of entry

    form "Log some bucks" {
      into entry
      ask hero "Who?"
      ask amount "How many?"
      ask kind
      ask reason "What for?"
      allow admin, secretary
      submit "Log it"
    }

    list entry {
      title "The ledger"
      columns hero, amount, kind, reason, created
      sort newest
      limit 50
      empty "Nothing logged yet. The first entry is usually somebody being kind."
      allow remove admin
    }
  }

  # Winning an election is worth something.
  when election.certified {
    only if event.winner above 0
    add entry {
      hero: event.winner
      amount: setting.election_award
      kind: "earn"
      reason: "Elected"
    }
    notify "Awarded bucks for a certified election."
  }
}`,
  },
  {
    slug: "quest-board",
    tagline: "The quests running right now, and who signed up.",
    category: "quests",
    description: `A studio runs several quests at once and the list of them lives, at best,
on a wall. This puts the board in the app, next to the Contract that governs it.

**What it adds**

- A *Quests* page listing every quest, its badge and its status.
- A sign-up form for Heroes.
- A panel on the Town Hall page showing what's running, so the Secretary can see it while taking notes.`,
    source: `# The quest board, on the same shelf as the Contract.
tacon quest-board {
  name "Quest Board"
  version 1.0.0
  about "Every quest the studio is running, who is on it, and what it is worth."
  icon compass
  category quests
  provides quest

  store quest {
    label "Quest"
    field title text required
    field badge text
    field status choice running, planned, finished
    field guide person
    field notes longtext
  }

  store signup {
    label "Sign-up"
    field hero person required
    field quest text required
  }

  ask running count of quest where quest.status is "running"

  page quests {
    title "Quests"
    icon compass
    nav true
    subtitle "What the studio is working on right now."

    stat "Running now" count of quest where quest.status is "running"
    stat "Finished" count of quest where quest.status is "finished"

    list quest {
      title "The board"
      columns title, badge, status, guide
      where quest.status is not "finished"
      sort newest
      limit 30
      empty "No quests on the board yet."
      allow remove admin, secretary
    }

    form "Add a quest" {
      into quest
      ask title
      ask badge "Badge it earns"
      ask status
      ask guide "Guide running it"
      allow admin, secretary, guide
      submit "Put it on the board"
    }

    divider

    heading "Sign-ups"

    form "Sign up for a quest" {
      into signup
      ask hero "Who?"
      ask quest "Which quest?"
      submit "Sign me up"
    }

    list signup {
      columns hero, quest, created
      sort newest
      limit 40
      empty "Nobody has signed up yet."
    }
  }

  panel on town-hall {
    title "Quests running"
    note "{my.running} quests are running right now."
    list quest {
      columns title, status
      where quest.status is "running"
      limit 5
      empty "Nothing running."
    }
  }
}`,
  },
  {
    slug: "gratitude-wall",
    tagline: "Say something true about somebody, in public.",
    category: "community",
    description: `A one-screen Tac-On: anybody can post a short thank-you naming another
Hero, and the wall keeps them. No roles, no approvals, no editing - which is
the point.

**What it adds**

- A *Gratitude* page with a form and the wall.
- A panel on the People page showing the most recent few.`,
    source: `# The simplest useful Tac-On there is.
tacon gratitude-wall {
  name "Gratitude Wall"
  version 1.0.0
  about "Anyone can thank anyone, in public, and it stays up."
  icon heart
  category community

  store thanks {
    label "Thank-you"
    field about person required
    field message longtext required
  }

  page gratitude {
    title "Gratitude"
    icon heart
    nav true
    subtitle "Say something true about somebody."

    stat "Thank-yous" count of thanks

    form "Thank someone" {
      into thanks
      ask about "Who?"
      ask message "What did they do?"
      submit "Put it on the wall"
    }

    list thanks {
      title "The wall"
      columns about, message, by, created
      sort newest
      limit 60
      empty "The wall is empty. Somebody has to go first."
      allow remove admin
    }
  }

  panel on people {
    title "Lately on the wall"
    list thanks {
      columns about, message
      limit 3
      empty "Nothing on the wall yet."
    }
  }
}`,
  },
  {
    slug: "buck-shop",
    tagline: "Spend Hero Bucks on things the studio actually stocks.",
    category: "fun",
    description: `Built on top of **Hero Bucks**, and a worked example of one Tac-On
reading another. It does not keep its own ledger - it reads the balance the
Hero Bucks Tac-On publishes, and records purchases of its own.

Install Hero Bucks first; without it the shop still lists its stock, but the
balance line reads zero.`,
    source: `# Reads another Tac-On rather than copying it.
tacon buck-shop {
  name "Buck Shop"
  version 1.0.0
  about "A shop that spends the balance Hero Bucks keeps."
  icon shopping-bag
  category fun
  use hero-bucks as bucks

  store item {
    label "Item"
    field name text required
    field price number required
    field stock number
  }

  store purchase {
    label "Purchase"
    field hero person required
    field item text required
    field paid number
  }

  page shop {
    title "Buck Shop"
    icon shopping-bag
    nav true
    subtitle "What the studio stocks, and what it costs."

    note "You have {bucks.balance} bucks to spend." info

    list item {
      title "In stock"
      columns name, price, stock
      sort az
      limit 40
      empty "The shelves are empty. An admin can stock them below."
      allow remove admin
    }

    form "Stock an item" {
      into item
      ask name
      ask price
      ask stock
      allow admin, secretary
      submit "Add to the shop"
    }

    divider

    form "Record a purchase" {
      into purchase
      ask hero "Who bought it?"
      ask item "What?"
      ask paid "How much?"
      allow admin, secretary
      submit "Record it"
    }

    list purchase {
      title "Recent purchases"
      columns hero, item, paid, created
      sort newest
      limit 20
      empty "Nothing bought yet."
    }
  }
}`,
  },
];

/**
 * Publishes the starters, once. Anything that fails to compile is skipped with
 * a loud log rather than taking the server down with it - a broken starter is
 * a bug in Eagle Bot, not a reason an academy can't sign in.
 */
export async function seedStarters(): Promise<void> {
  const [existing] = await db.select({ total: sql<number>`count(*)` }).from(tacons);
  if (Number(existing?.total ?? 0) > 0) return;

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
  }

  console.log(`[tacons] seeded ${STARTERS.length} official Tac-Ons into the market`);
}
