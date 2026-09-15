import { useSession } from "@/lib/session";

/**
 * "Which other studios share this?"
 *
 * Between "one studio only" and "the whole academy" sits the case Actons
 * actually hit: Middle and Launchpad run one Hero Bucks system that Spark has
 * nothing to do with. Making that academy-wide pushes it into Spark; keeping
 * two copies lets them drift. So the space stays owned by one studio and names
 * the others that share it.
 */
export function SharedWithPicker({
  ownerStudioId,
  value,
  onChange,
  noun = "section",
}: {
  /** The studio that owns it. Null (academy-wide) makes sharing meaningless. */
  ownerStudioId: number | null | undefined;
  value: number[];
  onChange: (value: number[]) => void;
  noun?: string;
}) {
  const { studios, can } = useSession();

  // Only someone who can see the whole academy can hand one studio's rules to
  // another, and an academy-wide space is already shared with everyone.
  if (!can("academy.manage") || ownerStudioId === null || ownerStudioId === undefined) return null;

  const others = studios.filter((studio) => studio.id !== ownerStudioId);
  if (others.length === 0) return null;

  function toggle(studioId: number) {
    onChange(
      value.includes(studioId)
        ? value.filter((id) => id !== studioId)
        : [...value, studioId],
    );
  }

  return (
    <div>
      <span className="label">Also shared with</span>
      <div className="flex flex-wrap gap-2">
        {others.map((studio) => {
          const on = value.includes(studio.id);
          return (
            <button
              key={studio.id}
              type="button"
              onClick={() => toggle(studio.id)}
              aria-pressed={on}
              className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1.5 text-xs font-medium transition ${
                on
                  ? "border-transparent text-gray-900"
                  : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
              style={on ? { background: `${studio.color}26`, borderColor: studio.color } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: studio.color }} />
              {studio.name}
            </button>
          );
        })}
      </div>
      <p className="hint">
        {value.length === 0
          ? `Only the owning studio sees this ${noun}.`
          : `These studios will see this ${noun} in their own wiki. It stays owned by the studio above — one copy, one history.`}
      </p>
    </div>
  );
}

/** Reads back which studios share something, for display next to its title. */
export function SharedWithNote({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <span className="chip border border-dashed border-gray-300 bg-white text-gray-500">
      shared with {names.join(", ")}
    </span>
  );
}
