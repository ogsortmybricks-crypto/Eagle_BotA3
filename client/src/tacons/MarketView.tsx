import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, CircleDollarSign, Pencil, Plus, RotateCcw, ShoppingBag } from "lucide-react";
import { apiPatch, apiPost } from "@/lib/api";
import { Banner, Spinner } from "@/components/ui";
import type { MarketEntry, MarketProduct, MarketPurchase, ViewMarket } from "@shared/tacons/view";
import type { RenderTarget } from "./Renderer";

type MarketProps = { market: ViewMarket; target: RenderTarget };

const targetFields = (target: RenderTarget) => ({
  ...(target.page ? { page: target.page } : {}),
  ...(target.panel ? { panel: target.panel } : {}),
  ...(target.position ? { position: target.position } : {}),
});

function money(points: number, rate: number) {
  const bucks = points / rate;
  return `${points.toLocaleString()} pts · ${bucks.toLocaleString(undefined, {
    minimumFractionDigits: bucks % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} Eagle Bucks`;
}

function newRequestId() {
  return crypto.randomUUID();
}

export function MarketView({ market, target }: MarketProps) {
  const queryClient = useQueryClient();
  const overdraft = "overdraft" in market && market.overdraft === true;
  const canUsePersonal = market.canLogPoints || market.canPurchase;
  const canUseManagement = market.canManage || market.canAwardPoints || market.canViewLogs;
  const [requestedView, setRequestedView] = useState<"wallet" | "manage">(
    target.position ? "manage" : "wallet",
  );
  const viewMode = requestedView === "manage"
    ? canUseManagement ? "manage" : "wallet"
    : canUsePersonal ? "wallet" : "manage";
  const [purchaseBalance, setPurchaseBalance] = useState<{ before: number; after: number } | null>(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [learnerId, setLearnerId] = useState("");
  const [earnRequestId, setEarnRequestId] = useState("");
  const [purchaseRequest, setPurchaseRequest] = useState<{ productId: number; requestId: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [productForm, setProductForm] = useState<{ id?: number; name: string; description: string; pricePoints: string; active: boolean }>({
    name: "", description: "", pricePoints: "", active: true,
  });
  useEffect(() => {
    setEarnRequestId("");
    setLearnerId("");
  }, [viewMode]);
  useEffect(() => {
    if (purchaseBalance && market.balancePoints !== purchaseBalance.before) setPurchaseBalance(null);
  }, [market.balancePoints, purchaseBalance]);

  const base = `/tacons/view/${target.installId}/markets/${encodeURIComponent(market.market)}`;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["tacon-view"] });
    void queryClient.invalidateQueries({ queryKey: ["tacon-desks"] });
    target.onChanged();
  };

  const earn = useMutation({
    mutationFn: ({ requestId, mode, recipientId }: { requestId: string; mode: "wallet" | "manage"; recipientId: string }) =>
      apiPost(`${base}/points`, {
        ...targetFields(target),
        index: market.index,
        points: Number(points),
        reason: reason.trim(),
        ...(mode === "manage" && market.canAwardPoints && recipientId ? { learnerId: Number(recipientId) } : {}),
        requestId,
      }),
    onSuccess: () => {
      setPoints("");
      setReason("");
      setEarnRequestId("");
      setNotice({ tone: "success", text: "Points recorded." });
      refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const buy = useMutation({
    mutationFn: ({ productId, requestId }: { productId: number; requestId: string; balanceBefore: number; pricePoints: number }) =>
      apiPost<{ balancePoints: number }>(`${base}/purchase`, {
        ...targetFields(target),
        index: market.index,
        productId,
        requestId,
      }),
    onSuccess: (result, variables) => {
      const balanceAfter = result.balancePoints;
      setPurchaseBalance({ before: variables.balanceBefore, after: balanceAfter });
      setPurchaseRequest(null);
      setNotice({
        tone: "success",
        text: `Purchase placed. Your balance is now ${money(balanceAfter, market.rate)}.${overdraft && balanceAfter < 0 ? " Warning: this purchase leaves your balance negative (or increases the amount owed)." : ""}`,
      });
      refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const saveProduct = useMutation({
    mutationFn: () => {
      const body = {
        ...targetFields(target),
        index: market.index,
        name: productForm.name.trim(),
        description: productForm.description.trim(),
        pricePoints: Number(productForm.pricePoints),
        active: productForm.active,
      };
      return productForm.id
        ? apiPatch(`${base}/products/${productForm.id}`, body)
        : apiPost(`${base}/products`, body);
    },
    onSuccess: () => {
      setProductForm({ name: "", description: "", pricePoints: "", active: true });
      setNotice({ tone: "success", text: productForm.id ? "Catalog item updated." : "Catalog item added." });
      refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const toggleProduct = useMutation({
    mutationFn: ({ product, active }: { product: MarketProduct; active: boolean }) =>
      apiPatch(`${base}/products/${product.id}`, {
        ...targetFields(target),
        index: market.index,
        name: product.name,
        description: product.description,
        pricePoints: product.pricePoints,
        active,
      }),
    onSuccess: (_, variables) => {
      setNotice({ tone: "success", text: variables.active ? "Item added back to the catalog." : "Item removed from the catalog." });
      refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const fulfill = useMutation({
    mutationFn: (purchaseId: number) =>
      apiPost(`${base}/purchases/${purchaseId}/fulfill`, {
        ...targetFields(target),
        index: market.index,
      }),
    onSuccess: () => {
      setNotice({ tone: "success", text: "Purchase marked fulfilled." });
      refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: error.message }),
  });

  const products = viewMode === "manage" ? market.products : market.products.filter((product) => product.active);
  const amount = Number(points);
  const canSubmitPoints = Number.isSafeInteger(amount) && amount > 0 && reason.trim().length > 0 &&
    (!market.canAwardPoints || market.canLogPoints || Boolean(learnerId));
  const displayedBalance = purchaseBalance?.before === market.balancePoints ? purchaseBalance.after : market.balancePoints;

  const beginEdit = (product: MarketProduct) => {
    setProductForm({
      id: product.id,
      name: product.name,
      description: product.description,
      pricePoints: String(product.pricePoints),
      active: product.active,
    });
  };

  const cancelEdit = () => setProductForm({ name: "", description: "", pricePoints: "", active: true });
  const date = (value: string) => new Date(value).toLocaleString();

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-[#fffdf7] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-200 bg-[#f8f0d9] px-5 py-5 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#eedcae] text-[#73541b]">
            <CircleDollarSign className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#81672f]">Studio market</p>
            <h2 className="text-xl font-bold text-[#342d1e]">{market.title}</h2>
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-[#fffaf0] px-4 py-2 text-right">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#81672f]">Your balance</div>
          <div className={`font-semibold tabular-nums ${displayedBalance < 0 ? "text-[#8b5542]" : "text-[#342d1e]"}`}>{money(displayedBalance, market.rate)}</div>
        </div>
      </header>

      <div className="space-y-7 p-4 sm:p-7">
        {canUseManagement && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Market views">
            {canUsePersonal && (
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "wallet"}
                className={viewMode === "wallet" ? "btn-primary" : "btn-secondary"}
                onClick={() => {
                  setRequestedView("wallet");
                  setEarnRequestId("");
                  setLearnerId("");
                }}
              >
                My wallet
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "manage"}
              className={viewMode === "manage" ? "btn-primary" : "btn-secondary"}
              onClick={() => {
                setRequestedView("manage");
                setEarnRequestId("");
                setLearnerId("");
              }}
            >
              Manage market
            </button>
          </div>
        )}
        <p className="text-sm text-[#645b49]">
          Every {market.rate.toLocaleString()} points equals 1 Eagle Buck. Prices and earnings are recorded in points.
        </p>
        {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
        {overdraft && displayedBalance < 0 && (
          <div className="rounded-xl border border-[#d9b8a8] bg-[#fff5f0] px-4 py-3 text-sm text-[#784b3b]" role="status">
            <strong>Negative balance:</strong> You owe {money(Math.abs(displayedBalance), market.rate)} in points. Assignment earnings reduce the amount owed. Your balance cannot exceed {market.cap.toLocaleString()} points.
          </div>
        )}

        {(viewMode === "wallet" ? market.canLogPoints : market.canLogPoints || market.canAwardPoints) && (
          <section className="rounded-xl border border-[#e9dfc9] bg-white/70 p-4 sm:p-5" aria-labelledby={`earn-${market.index}`}>
            <div className="mb-4">
              <h3 id={`earn-${market.index}`} className="font-semibold text-[#342d1e]">
                  {viewMode === "wallet" ? "Record my assignment points" : market.canAwardPoints && !market.canLogPoints ? "Record points for a wallet" : "Record points"}
              </h3>
              <p className="mt-1 text-sm text-[#756d5d]">
                Enter a positive whole number and its source. Earnings repay negative balances; your resulting balance cannot exceed {market.cap.toLocaleString()} points.
              </p>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!canSubmitPoints || earn.isPending) return;
                setNotice(null);
                const requestId = earnRequestId || newRequestId();
                setEarnRequestId(requestId);
                earn.mutate({ requestId, mode: viewMode, recipientId: learnerId });
              }}
            >
              {viewMode === "manage" && market.canAwardPoints && (
                <label className="text-sm font-medium text-[#4e4739]">
                  Wallet
                  <select
                    className="input mt-1"
                    value={learnerId}
                    onChange={(event) => {
                      setLearnerId(event.target.value);
                      setEarnRequestId("");
                    }}
                    disabled={earn.isPending}
                    required={market.canAwardPoints && !market.canLogPoints}
                  >
                    <option value="">{market.canLogPoints ? "Record for myself" : "Choose a learner"}</option>
                    {market.learners.map((learner) => (
                      <option key={learner.id} value={learner.id}>
                        {learner.name} · {money(learner.balancePoints, market.rate)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-sm font-medium text-[#4e4739]">
                Points earned
                <input
                  className="input mt-1"
                  type="number"
                  min="1"
                  max={Number.MAX_SAFE_INTEGER}
                  step="1"
                  inputMode="numeric"
                  value={points}
                  onChange={(event) => {
                    setPoints(event.target.value);
                    setEarnRequestId("");
                  }}
                  disabled={earn.isPending}
                  required
                />
              </label>
              <label className="text-sm font-medium text-[#4e4739] sm:col-span-2">
                Source or reason
                <input
                  className="input mt-1"
                  type="text"
                  maxLength={240}
                  placeholder="What did the points come from?"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setEarnRequestId("");
                  }}
                  disabled={earn.isPending}
                  required
                />
              </label>
              <div className="sm:col-span-2">
                <button className="btn-primary" type="submit" disabled={!canSubmitPoints || earn.isPending}>
                  {earn.isPending && <Spinner />} Record points
                </button>
              </div>
            </form>
          </section>
        )}

          <section aria-labelledby={`catalog-${market.index}`}>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id={`catalog-${market.index}`} className="font-semibold text-[#342d1e]">{viewMode === "manage" ? "Market catalog" : "Available in the market"}</h3>
              <p className="mt-1 text-sm text-[#756d5d]">{viewMode === "manage" ? "Manage the items available in your market." : "Purchases use points from your balance. There are no cash payments."}</p>
            </div>
            <span className="text-xs text-[#827965]">{products.length} {products.length === 1 ? "item" : "items"}</span>
          </div>

          {products.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#d9cba9] bg-[#fffaf0] px-5 py-8 text-center">
              <ShoppingBag className="mx-auto h-7 w-7 text-[#aa9567]" aria-hidden="true" />
              <p className="mt-2 font-medium text-[#514832]">Nothing in the catalog yet</p>
              <p className="mt-1 text-sm text-[#756d5d]">Check back when an item is added to the catalog.</p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {products.map((product) => {
                return (
                  <article key={product.id} className="flex min-w-0 flex-col rounded-xl border border-[#e9dfc9] bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="break-words font-semibold text-[#342d1e]">{product.name}</h4>
                        {product.description && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#756d5d]">{product.description}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold tabular-nums text-[#73541b]">{money(product.pricePoints, market.rate)}</div>
                        {!overdraft && market.balancePoints < product.pricePoints && (
                          <span className="text-xs text-[#8a7860]">Not enough points</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#f0e9da] pt-3">
                      {viewMode === "wallet" && product.active ? (
                        market.canPurchase ? (
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={buy.isPending || (!overdraft && market.balancePoints < product.pricePoints)}
                            onClick={() => {
                              if (!window.confirm(`Buy “${product.name}” for ${money(product.pricePoints, market.rate)}?`)) return;
                              setNotice(null);
                              const requestId = purchaseRequest?.productId === product.id
                                ? purchaseRequest.requestId
                                : newRequestId();
                              setPurchaseRequest({ productId: product.id, requestId });
                              buy.mutate({
                                productId: product.id,
                                requestId,
                                balanceBefore: market.balancePoints,
                                pricePoints: product.pricePoints,
                              });
                            }}
                          >
                            {buy.isPending && <Spinner />} Buy item
                          </button>
                        ) : (
                          <span className="text-xs text-[#827965]">Purchases are unavailable</span>
                        )
                      ) : viewMode === "manage" && !product.active ? (
                        <span className="rounded-full bg-[#f5efdf] px-2.5 py-1 text-xs font-medium text-[#74664a]">Archived</span>
                      ) : null}
                      {viewMode === "manage" && market.canManage && (
                        <>
                          <button type="button" className="btn-secondary" onClick={() => beginEdit(product)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Edit
                          </button>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={toggleProduct.isPending}
                            onClick={() => toggleProduct.mutate({ product, active: !product.active })}
                          >
                            {product.active
                              ? <><Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Remove from catalog</>
                              : <><RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Add back to catalog</>}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {viewMode === "manage" && market.canManage && (
          <section className="rounded-xl border border-[#e9dfc9] bg-[#fbf7ec] p-4 sm:p-5" aria-labelledby={`manage-${market.index}`}>
            <div className="mb-4 flex items-center gap-2">
              <Plus className="h-4 w-4 text-[#73541b]" aria-hidden="true" />
              <h3 id={`manage-${market.index}`} className="font-semibold text-[#342d1e]">
                {productForm.id ? "Edit catalog item" : "Add a catalog item"}
              </h3>
            </div>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!productForm.name.trim() || !Number.isInteger(Number(productForm.pricePoints)) || Number(productForm.pricePoints) < 0) return;
                setNotice(null);
                saveProduct.mutate();
              }}
            >
              <label className="text-sm font-medium text-[#4e4739]">
                Item name
                <input className="input mt-1" value={productForm.name} maxLength={100} required onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} />
              </label>
              <label className="text-sm font-medium text-[#4e4739]">
                Price in points
                <input className="input mt-1" type="number" min="0" step="1" inputMode="numeric" value={productForm.pricePoints} required onChange={(event) => setProductForm({ ...productForm, pricePoints: event.target.value })} />
                {productForm.pricePoints !== "" && Number.isInteger(Number(productForm.pricePoints)) && (
                  <span className="mt-1 block text-xs font-normal text-[#756d5d]">
                    Displays as {money(Number(productForm.pricePoints), market.rate)}
                  </span>
                )}
              </label>
              <label className="text-sm font-medium text-[#4e4739] sm:col-span-2">
                Description
                <textarea className="input mt-1 min-h-[76px]" maxLength={500} value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button className="btn-primary" type="submit" disabled={saveProduct.isPending}>
                  {saveProduct.isPending && <Spinner />} {productForm.id ? "Save changes" : "Add item"}
                </button>
                {productForm.id && <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel edit</button>}
              </div>
            </form>
          </section>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {viewMode === "manage" ? (
            market.canViewLogs ? (
              <>
          <section aria-labelledby={`activity-${market.index}`}>
            <div className="mb-3">
              <h3 id={`activity-${market.index}`} className="font-semibold text-[#342d1e]">
                Points ledger
              </h3>
              <p className="mt-1 text-xs text-[#827965]">Showing the most recent 200 entries provided by the server.</p>
            </div>
              <Ledger entries={market.entries} rate={market.rate} date={date} />
          </section>
          <section aria-labelledby={`orders-${market.index}`}>
            <div className="mb-3">
              <h3 id={`orders-${market.index}`} className="font-semibold text-[#342d1e]">
                Purchase log
              </h3>
              <p className="mt-1 text-xs text-[#827965]">
                Recent orders for the Shopkeeper to track.
              </p>
            </div>
            <PurchaseList
              purchases={market.purchases}
              rate={market.rate}
              date={date}
              canFulfill
              pending={fulfill.isPending}
              onFulfill={(id) => {
                setNotice(null);
                fulfill.mutate(id);
              }}
            />
          </section>
              </>
            ) : (
              <p className="text-sm text-[#756d5d]">Market logs are not available in this view.</p>
            )
          ) : (
            <>
              <section aria-labelledby={`activity-${market.index}`}>
                <div className="mb-3">
                  <h3 id={`activity-${market.index}`} className="font-semibold text-[#342d1e]">Your points history</h3>
                  <p className="mt-1 text-xs text-[#827965]">Your recent points activity.</p>
                </div>
                <Ledger entries={market.ownEntries} rate={market.rate} date={date} />
              </section>
              <section aria-labelledby={`orders-${market.index}`}>
                <div className="mb-3">
                  <h3 id={`orders-${market.index}`} className="font-semibold text-[#342d1e]">Your purchases</h3>
                  <p className="mt-1 text-xs text-[#827965]">Your recent market orders.</p>
                </div>
                <PurchaseList
                  purchases={market.ownPurchases}
                  rate={market.rate}
                  date={date}
                  canFulfill={false}
                  pending={false}
                  onFulfill={() => undefined}
                />
              </section>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Ledger({ entries, rate, date }: { entries: MarketEntry[]; rate: number; date: (value: string) => string }) {
  if (entries.length === 0) {
    return <div className="rounded-xl border border-dashed border-[#d9cba9] px-4 py-6 text-center text-sm text-[#756d5d]">No points activity to show yet.</div>;
  }
  return (
    <ul className="divide-y divide-[#eee6d5] rounded-xl border border-[#e9dfc9] bg-white">
      {entries.map((entry) => (
        <li key={entry.id} className="flex min-w-0 items-start justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-[#342d1e]">{entry.reason}</p>
            <p className="mt-1 text-xs text-[#827965]">
              {entry.learnerName} · {entry.actorName} · {date(entry.createdAt)}
            </p>
          </div>
          <span className={`shrink-0 text-right text-sm font-semibold tabular-nums ${entry.kind === "earn" ? "text-[#496b47]" : "text-[#8b5542]"}`}>
            {entry.kind === "earn" ? "+" : "−"}{money(Math.abs(entry.points), rate)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PurchaseList({
  purchases, rate, date, canFulfill, pending, onFulfill,
}: {
  purchases: MarketPurchase[];
  rate: number;
  date: (value: string) => string;
  canFulfill: boolean;
  pending: boolean;
  onFulfill: (id: number) => void;
}) {
  if (purchases.length === 0) {
    return <div className="rounded-xl border border-dashed border-[#d9cba9] px-4 py-6 text-center text-sm text-[#756d5d]">No purchases to show yet.</div>;
  }
  return (
    <ul className="divide-y divide-[#eee6d5] rounded-xl border border-[#e9dfc9] bg-white">
      {purchases.map((purchase) => (
        <li key={purchase.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-[#342d1e]">{purchase.productName}</p>
            <p className="mt-1 text-xs text-[#827965]">{purchase.learnerName} · {date(purchase.createdAt)}</p>
            <p className="mt-1 text-xs font-medium tabular-nums text-[#73541b]">{money(purchase.pricePoints, rate)}</p>
          </div>
          <div className="flex items-center gap-2">
            {purchase.status === "fulfilled" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#e9f0e2] px-2.5 py-1 text-xs font-medium text-[#496b47]">
                <Check className="h-3 w-3" aria-hidden="true" /> Fulfilled
              </span>
            ) : canFulfill ? (
              <button type="button" className="btn-secondary" disabled={pending} onClick={() => onFulfill(purchase.id)}>
                {pending && <Spinner />} Mark fulfilled
              </button>
            ) : (
              <span className="rounded-full bg-[#f5efdf] px-2.5 py-1 text-xs font-medium text-[#74664a]">Pending</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}