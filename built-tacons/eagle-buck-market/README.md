# Eagle Buck Market

An installable Tac-On for the extended Eagle Bot TacScript engine. Source:
[`eagle-buck-market.tacon`](./eagle-buck-market.tacon).

## Rules

- **100 points = 1 Eagle Buck.** Balances keep every point, including amounts below one Buck.
- **Maximum balance: 1,000 points / 10 Eagle Bucks.** An earning entry that would exceed the limit is rejected in full; points are not silently discarded.
- Learners record their own earned points with a required source/reason. This is a **self-reporting ledger**, not an approval queue.
- An admin or the current Shopkeeper can record earnings for a learner in the install's scope.
- Admins and the current Shopkeeper can add, edit, archive, or reactivate catalog items. Prices are positive whole points. Archived items cannot be purchased; their purchase history remains intact.
- A learner holding the Shopkeeper position can choose **Record for myself** to add their own points with a source/reason. The same 1,000-point wallet cap applies.
- Only learners can purchase. The server chooses the buyer, current catalog price, and product name, and checks the available balance. Learners cannot choose somebody else's wallet or change a price.
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
`finally`. It checks concurrent cap/overdraw attempts, duplicate submissions,
authoritative prices and identities, Shopkeeper term changes, private learner
histories, archived catalog items, and balances beyond 2,000 ledger entries.
Never run it against a production database.