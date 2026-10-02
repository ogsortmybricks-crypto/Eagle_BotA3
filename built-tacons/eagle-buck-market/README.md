# Eagle Buck Market

An installable Tac-On for the extended Eagle Bot TacScript engine. Source:
[`eagle-buck-market.tacon`](./eagle-buck-market.tacon).

## Rules

- **100 points = 1 Eagle Buck.** Balances keep every point, including amounts below one Buck.
- **Upper wallet balance: 1,000 points / 10 Eagle Bucks.** This is not a per-entry cap. Positive earnings first repay any negative balance; the wallet cannot end up above 1,000 points.
- **Overdraft is enabled for this market.** Purchases may take a wallet below zero. Markets that omit `overdraft true` keep the default behavior: a purchase with insufficient funds is rejected.
- Learners record their own earned points with a required source/reason. This is a **self-reporting ledger**, not an approval queue.
- An admin or the current Shopkeeper can record earnings for a learner in the install's scope.
- Admins and the current Shopkeeper can add, edit, archive, or reactivate catalog items. Prices are positive whole points. Archived items cannot be purchased; their purchase history remains intact.
- A learner holding the Shopkeeper position has **My wallet** and **Manage market** tabs. Market management is also shown by default on the Shopkeeper position desk. Their personal self-earning always records to their own wallet and requires a source/reason.
- Admins also have a personal wallet: they can self-earn with a required source/reason and buy items, as well as manage the market. Other learners each have one personal wallet.
- Admins and the current Shopkeeper manage catalog items. Removing an item uses **Remove from catalog**; it removes the item from the active catalog, not its purchase or ledger history.
- The server chooses the buyer, current catalog price, and product name. A learner cannot choose somebody else's wallet or change a price.
- Each purchase immediately deducts its cost and records a pending purchase. The admin/current Shopkeeper marks it fulfilled when delivered, without a second deduction.
- The current Shopkeeper gets the full recent points ledger (including sources) and purchase log on their position desk and on the marketplace. Admins also have oversight. Other learners see only their own history.
- Every earning and purchase has an audit entry identifying the learner, actor, reason or item, and time. Financial history cannot be deleted through ordinary Tac-On forms/lists.
- Concurrent purchases/earnings are serialized per installed market, and retrying the same submission does not charge or credit twice.

## Publish and install

1. Run the updated Eagle Bot engine that includes the built-in `market` declaration/widget. Old versions of TacScript cannot compile this file.
2. In the **Dev portal**, select **Tac-Ons → Publish official → Choose folder**.
3. Select the `eagle-buck-market` folder on your computer. The portal imports its `.tacon` file and validates it against the server; the README and tests are ignored. Check the preview, optionally add a blurb/details, then click **Publish**. The academy **Dev menu → New Tac-On** source editor remains another publishing route.
4. As an academy admin, open **Tac-Ons → Market**, find **Eagle Buck Market**, and install it **academy-wide**. Studio-only installs are rejected so learners cannot hold multiple separate wallets.
5. Open **Positions** and elect/appoint a Shopkeeper using the normal position workflow.
6. As an admin or current Shopkeeper, add your real catalog items and prices on **Eagle Buck Market** or the Shopkeeper's position desk.

The folder is not automatically published or installed. No example products or learner balances are seeded.

## Updating existing installations

This package is version **1.1.0**. To deliver it to academies already using the market, publish the new package version, then have an academy admin update the existing installation through the Tac-Ons listing or installed row. The update flow moves that installation to the published version; it is not automatically applied to a live installation. Do **not** uninstall and reinstall to update: removing the Tac-On deletes its records.

## Scope and persistence

This Tac-On requires one academy-wide install. Learners share the same wallet across studio views, so switching studios does not bypass the 10-Buck limit. Other academies have entirely separate catalogs and wallets. Other Tac-Ons' points markets are independent; Eagle Bucks here are the balance in this Tac-On, not real money.

Balances are calculated from the entire stored ledger, not the generic Tac-On runtime's 2,000-row read window. The UI displays the most recent 200 history entries; older history remains stored and still counts toward balances.

Turn the Tac-On **off** to preserve its records while hiding it. **Removing it deletes its records**, as with other Tac-Ons.

## Engine extension

The top-level `market wallet { ... }` defines the conversion, limit, and responsible position. `market wallet` inside a page or position renders the appropriate role-aware UI. Storage and purchase operations are built into Eagle Bot, not arbitrary code shipped with this Tac-On.

See [TacScript](../../Documentation/TacScript.md) for the language and [Tac-Ons](../../Documentation/Tac-Ons.md) for publishing/installing.

## Checks

```sh
npm run check
npm run build
npx tsx --test tacons/eagle-buck-market/compile.test.ts
```

To run transaction and HTTP permission tests explicitly against the **development**
database, use:

```sh
NODE_ENV=development RUN_TACON_MARKET_DB_TESTS=true npx tsx --test server/tacons/market.integration.test.ts
```

The database test creates an isolated temporary academy and removes it in
`finally`. It checks concurrent negative-balance purchases and upper-cap
reservation, duplicate submissions/retries, authoritative prices and identities,
Shopkeeper term changes, private learner histories, admin personal-wallet
histories, archived catalog items, and balances beyond 2,000 ledger entries.
Never run it against a production database.