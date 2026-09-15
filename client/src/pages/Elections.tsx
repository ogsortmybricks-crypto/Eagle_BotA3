import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Vote } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import { Banner, Chip, EmptyState, LoadingPage, Modal, PageHeader, Spinner } from "@/components/ui";
import { StudioTag } from "@/components/StudioSwitcher";
import { StudioPicker } from "@/components/StudioPicker";

type ElectionRow = {
  election: {
    id: number;
    title: string;
    description: string | null;
    type: string;
    status: string;
    seats: number;
    studioId: number | null;
    closesAt: string | null;
    createdByType: string;
  };
  positionTitle: string | null;
  studioName: string | null;
  studioColor: string | null;
  candidateCount: number;
  voterCount: number;
  hasVoted: boolean;
  /** Whether *this* person votes in *this* ballot - it varies per election. */
  canVote: boolean;
};

type Position = {
  id: number;
  title: string;
  seats: number;
  elected: boolean;
  studioId: number | null;
  studioName: string | null;
};

export const STATUS_TONE: Record<string, "neutral" | "brand" | "green" | "amber" | "red"> = {
  draft: "neutral",
  open: "green",
  closed: "amber",
  certified: "brand",
  cancelled: "red",
};

export function Elections() {
  const { can, studio, studioId } = useSession();
  const [creating, setCreating] = useState(false);

  const query = useQuery<{ elections: ElectionRow[]; canVote: boolean }>({
    queryKey: ["elections", studioId],
    queryFn: () => apiGet("/elections"),
  });

  if (query.isLoading) return <LoadingPage />;

  const rows = query.data?.elections ?? [];
  const open = rows.filter((row) => row.election.status === "open");
  const other = rows.filter((row) => row.election.status !== "open");

  return (
    <>
      <PageHeader
        title={studio ? `${studio.name} — Elections` : "Elections"}
        subtitle={
          studio
            ? `Positions and rule changes ${studio.name} votes on.`
            : "Every ballot across the academy. Each one is decided by its own studio."
        }
      >
        {can("elections.manage") && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> New election
          </button>
        )}
      </PageHeader>

      {rows.length > 0 && !query.data?.canVote && (
        <div className="mb-4">
          <Banner tone="info">
            You can follow these votes, but you don't cast one in any of them — a ballot belongs to
            the studio holding it.
          </Banner>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Vote}
          title="No elections yet"
          action={
            can("elections.manage") ? (
              <button onClick={() => setCreating(true)} className="btn-primary">
                <Plus className="h-4 w-4" /> Create one
              </button>
            ) : undefined
          }
        >
          Elections show up here when an admin creates one, or when the AI spots something in Town
          Hall notes that needs a vote and someone approves it.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Open now
              </h2>
              <div className="card divide-y divide-gray-100">
                {open.map((row) => (
                  <ElectionRowItem key={row.election.id} row={row} />
                ))}
              </div>
            </section>
          )}
          {other.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {open.length > 0 ? "Everything else" : "All elections"}
              </h2>
              <div className="card divide-y divide-gray-100">
                {other.map((row) => (
                  <ElectionRowItem key={row.election.id} row={row} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {creating && <CreateElectionModal onClose={() => setCreating(false)} />}
    </>
  );
}

function ElectionRowItem({ row }: { row: ElectionRow }) {
  const { election, positionTitle, studioName, studioColor, candidateCount, voterCount, hasVoted } =
    row;
  const { studioId } = useSession();
  const formatDate = useDateFormat();

  return (
    <Link
      href={`/elections/${election.id}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition hover:bg-gray-50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900">{election.title}</span>
          <Chip tone={STATUS_TONE[election.status] ?? "neutral"}>{election.status}</Chip>
          {/* Worth naming the studio whenever more than one is on screen. */}
          {(studioId === null || election.studioId === null) && (
            <StudioTag
              name={studioName}
              color={studioColor}
              shared={election.studioId === null}
            />
          )}
          {election.createdByType === "ai" && <Chip tone="purple">from Town Hall</Chip>}
          {hasVoted && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> you voted
            </span>
          )}
          {/* Says plainly why there's no ballot button, instead of just not having one. */}
          {!row.canVote && election.status === "open" && (
            <span className="text-xs text-gray-400">not your studio's vote</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
          <span>{election.type === "position" ? (positionTitle ?? "Position") : "Rule change"}</span>
          <span>
            {candidateCount} option{candidateCount === 1 ? "" : "s"}
          </span>
          <span>
            {voterCount} vote{voterCount === 1 ? "" : "s"} cast
          </span>
          {election.closesAt && <span>closes {formatDate(election.closesAt)}</span>}
        </div>
      </div>
    </Link>
  );
}

function CreateElectionModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { studioId, studios, settings, effective } = useSession();
  const [type, setType] = useState<"position" | "rule">("position");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [positionId, setPositionId] = useState<number | null>(null);
  const [proposalBody, setProposalBody] = useState("");
  const [targetStudio, setTargetStudio] = useState<number | null | undefined>(
    studioId === null ? undefined : studioId,
  );
  // Prefilled from the academy's default voting window, or the studio's own.
  const [closesAt, setClosesAt] = useState(() => {
    const days = effective?.electionDurationDays ?? settings.elections.defaultDurationDays;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  });
  const [error, setError] = useState<string | null>(null);

  const positions = useQuery<{ positions: Position[] }>({
    queryKey: ["positions", studioId],
    queryFn: () => apiGet("/positions"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost("/elections", {
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        positionId: type === "position" ? positionId : null,
        proposalBody: type === "rule" ? proposalBody : null,
        closesAt: closesAt || null,
        ...(targetStudio === undefined ? {} : { studioId: targetStudio }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["elections"] });
      onClose();
    },
    onError: (createError: Error) => setError(createError.message),
  });

  // A position vote inherits the seat's studio, so the picker is redundant there.
  const chosenPosition = positions.data?.positions.find((entry) => entry.id === positionId);

  const valid =
    title.trim().length >= 3 &&
    (type === "position" ? positionId !== null : proposalBody.trim().length > 0) &&
    (type === "position" || targetStudio !== undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title="New election"
      description="It starts as a draft. Add candidates, then open it for voting."
      wide
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!valid || create.isPending}
            className="btn-primary"
          >
            {create.isPending && <Spinner />} Create draft
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}

        <div className="grid grid-cols-2 gap-2.5">
          {(
            [
              ["position", "Fill a position", "Elect people into a role."],
              ["rule", "Change a rule", "Vote a proposal up or down."],
            ] as const
          ).map(([value, label, blurb]) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={`rounded-lg border-2 p-3.5 text-left transition ${
                type === value ? "border-brand-600 bg-brand-50" : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="text-sm font-semibold text-gray-900">{label}</div>
              <div className="mt-0.5 text-xs text-gray-500">{blurb}</div>
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="election-title">
            Title
          </label>
          <input
            id="election-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={
              type === "position" ? "Hero Buck Committee — Spring session" : "Raise the appeal cost"
            }
            autoFocus
          />
        </div>

        {type === "position" ? (
          <div>
            <label className="label" htmlFor="position">
              Which position?
            </label>
            <select
              id="position"
              className="input"
              value={positionId ?? ""}
              onChange={(event) => setPositionId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Pick one</option>
              {positions.data?.positions
                .filter((position) => position.elected)
                .map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.studioName ? `${position.studioName} — ` : ""}
                    {position.title} ({position.seats} seat{position.seats === 1 ? "" : "s"})
                  </option>
                ))}
            </select>
            <p className="hint">
              The winners are seated automatically when the vote is certified.
              {chosenPosition?.studioName
                ? ` This ballot goes to ${chosenPosition.studioName}, because that's whose seat it is.`
                : chosenPosition && chosenPosition.studioId === null
                  ? " This one is academy-wide, so everyone votes."
                  : ""}
            </p>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="proposal">
              Exactly what is being voted on
            </label>
            <textarea
              id="proposal"
              className="input min-h-[110px] font-mono text-[13px]"
              value={proposalBody}
              onChange={(event) => setProposalBody(event.target.value)}
              placeholder="An appeal to the Hero Buck Committee costs 1 Hero Buck. A second appeal costs 2."
            />
            <p className="hint">
              Word it the way it should read in the wiki. If it passes, the AI files this text
              where it belongs and repeals whatever it replaces.
            </p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="election-desc">
            Context (optional)
          </label>
          <textarea
            id="election-desc"
            className="input min-h-[70px]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Why this is being voted on."
          />
        </div>

        {type === "rule" && (
          <StudioPicker
            value={targetStudio}
            onChange={setTargetStudio}
            label="Who votes on this?"
            hint="Only that studio's members cast a ballot. Academy-wide opens it to everyone."
          />
        )}

        <div>
          <label className="label" htmlFor="closes">
            Voting closes
          </label>
          <input
            id="closes"
            type="date"
            className="input"
            value={closesAt}
            onChange={(event) => setClosesAt(event.target.value)}
          />
          <p className="hint">
            Prefilled from this academy's default voting window. Votes close automatically at the
            deadline{settings.elections.autoCloseOnDeadline ? "" : " only if that's switched on in Settings"}.
          </p>
        </div>
      </div>
    </Modal>
  );
}
