import { useSession } from "@/lib/session";

/**
 * "Which studio does this belong to?"
 *
 * Shown on every create form. When one studio is open it just confirms where
 * the thing is going; when the person is viewing all studios at once it is the
 * one field they must answer, because filing a rule against the wrong studio is
 * worse than an extra click.
 */
export function StudioPicker({
  value,
  onChange,
  label = "Which studio?",
  hint,
  allowShared,
  disabled,
}: {
  /** undefined = follow the current view, null = academy-wide, number = that studio. */
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  label?: string;
  hint?: string;
  /** Only admins may file academy-wide; defaults to whatever the role allows. */
  allowShared?: boolean;
  disabled?: boolean;
}) {
  const { studios, studio, studioId, can } = useSession();
  const canShare = allowShared ?? can("academy.manage");
  const resolved = value === undefined ? studioId : value;

  // With one studio and no academy-wide option there is nothing to ask.
  if (studios.length <= 1 && !canShare && studioId !== null) {
    return null;
  }

  const mustChoose = studioId === null && resolved === undefined;

  return (
    <div>
      <label className="label" htmlFor="studio-picker">
        {label}
      </label>
      <select
        id="studio-picker"
        className="input"
        disabled={disabled}
        value={resolved === null ? "shared" : resolved === undefined ? "" : String(resolved)}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "shared" ? null : Number(next));
        }}
      >
        {mustChoose && <option value="">Pick a studio</option>}
        {studios.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
            {entry.ageRange ? ` (${entry.ageRange})` : ""}
          </option>
        ))}
        {canShare && <option value="shared">Academy-wide — every studio sees it</option>}
      </select>
      <p className="hint">
        {hint ??
          (studio
            ? `Defaults to ${studio.name}, the studio you're in. Other studios won't see it.`
            : "You're viewing every studio, so this one needs an answer.")}
      </p>
    </div>
  );
}
