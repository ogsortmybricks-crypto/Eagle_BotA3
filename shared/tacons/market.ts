/** Reserved names cannot be declared as ordinary TacScript stores. */
export function marketStore(name: string, kind: "catalog" | "ledger" | "purchases"): string {
  return `__market_${name}_${kind}`;
}