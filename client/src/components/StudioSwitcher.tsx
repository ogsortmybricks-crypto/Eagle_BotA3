import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Layers } from "lucide-react";
import { useSession } from "@/lib/session";

/**
 * Switching studio is the most consequential control in the app - it changes
 * which Contract you're reading and which ballot you're looking at - so it sits
 * at the top of the sidebar rather than buried in a menu, and it always says
 * which studio you're in even when there's only one.
 */
export function StudioSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { studios, studio, studioId, canSeeAllStudios, selectStudio } = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (studios.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        You're not in a studio yet. An admin can place you in one.
      </div>
    );
  }

  // One studio and no "all" view means there is nothing to switch between.
  const canSwitch = studios.length > 1 || canSeeAllStudios;

  async function choose(next: number | null) {
    if (next === studioId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    await selectStudio(next);
    setBusy(false);
    setOpen(false);
    onNavigate?.();
  }

  const label = studio?.name ?? "All studios";
  const sub = studio
    ? (studio.ageRange ?? "Studio")
    : `${studios.length} studios at once`;

  const swatch = (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: studio?.color ?? "linear-gradient(90deg,#64748b,#94a3b8)" }}
    />
  );

  if (!canSwitch) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg bg-gray-50 px-3 py-2">
        {swatch}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-gray-900">{label}</div>
          <div className="truncate text-[11px] text-gray-500">{sub}</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left transition hover:border-gray-300 disabled:opacity-60"
      >
        {swatch}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">{label}</div>
          <div className="truncate text-[11px] text-gray-500">{sub}</div>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          <ul className="max-h-80 overflow-y-auto p-1">
            {studios.map((entry) => (
              <li key={entry.id}>
                <button
                  role="option"
                  aria-selected={entry.id === studioId}
                  onClick={() => choose(entry.id)}
                  className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-gray-50"
                >
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: entry.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {entry.name}
                      </span>
                      {entry.ageRange && (
                        <span className="shrink-0 text-[11px] text-gray-400">{entry.ageRange}</span>
                      )}
                    </span>
                    {entry.description && (
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-gray-500">
                        {entry.description}
                      </span>
                    )}
                  </span>
                  {entry.id === studioId && (
                    <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-600" />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {canSeeAllStudios && (
            <div className="border-t border-gray-200 p-1">
              <button
                role="option"
                aria-selected={studioId === null}
                onClick={() => choose(null)}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-gray-50"
              >
                <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900">All studios</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">
                    Everything at once. Useful for a look across the academy, but you'll be asked
                    which studio anything new belongs to.
                  </span>
                </span>
                {studioId === null && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-600" />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A small tag naming the studio a row belongs to, or marking it academy-wide. */
export function StudioTag({
  name,
  color,
  shared,
}: {
  name?: string | null;
  color?: string | null;
  shared?: boolean;
}) {
  if (shared) {
    return (
      <span className="chip border border-dashed border-gray-300 bg-white text-gray-500">
        Academy-wide
      </span>
    );
  }
  if (!name) return null;
  return (
    <span
      className="chip"
      style={{
        background: `${color ?? "#64748b"}1a`,
        color: color ?? "#334155",
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color ?? "#64748b" }} />
      {name}
    </span>
  );
}
