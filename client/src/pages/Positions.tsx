import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, Shield, UserPlus, Vote, X } from "lucide-react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import {
  Avatar,
  Banner,
  Chip,
  EmptyState,
  LoadingPage,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { StudioTag } from "@/components/StudioSwitcher";
import { StudioPicker } from "@/components/StudioPicker";
import { SharedWithNote, SharedWithPicker } from "@/components/SharedWithPicker";

type Holder = {
  id: number;
  userId: number;
  name: string;
  avatarUrl: string | null;
  note: string | null;
};

type Position = {
  id: number;
  studioId: number | null;
  studioName: string | null;
  studioColor: string | null;
  shared: boolean;
  sharedStudioIds: number[];
  sharedWith: string[];
  title: string;
  description: string | null;
  responsibilities: string[];
  seats: number;
  termLength: string | null;
  elected: boolean;
  archived: boolean;
  sourceType: string;
  current: Holder[];
  past: { id: number; name: string; endedAt: string }[];
  activeElection: { id: number; title: string; status: string } | null;
};

type Person = { id: number; name: string; studioId: number | null };

export function Positions() {
  const { can, studio, studioId } = useSession();
  const formatDate = useDateFormat();
  const [editing, setEditing] = useState<Position | null>(null);
  const [creating, setCreating] = useState(false);
  const [appointing, setAppointing] = useState<Position | null>(null);

  const query = useQuery<{ positions: Position[] }>({
    queryKey: ["positions", studioId],
    queryFn: () => apiGet("/positions"),
  });

  if (query.isLoading) return <LoadingPage />;
  const positions = query.data?.positions ?? [];

  return (
    <>
      <PageHeader
        title={studio ? `${studio.name} — Positions` : "Positions"}
        subtitle={
          studio
            ? `Every role ${studio.name} elects or appoints, and who holds it now.`
            : "Every role across the academy, and who holds it now."
        }
      >
        {can("positions.manage") && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Add position
          </button>
        )}
      </PageHeader>

      {positions.length === 0 ? (
        <EmptyState icon={Shield} title="No positions recorded">
          When the AI reads {studio ? `${studio.name}'s` : "a studio's"} documents it pulls out
          every elected role it finds. You can also add them by hand.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {positions.map((position) => (
            <div key={position.id} className="card flex flex-col">
              <div className="flex items-start justify-between gap-2 border-b border-gray-200 p-4">
                <div className="min-w-0">
                  <h2 className="font-semibold text-gray-900">{position.title}</h2>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(studioId === null || position.shared) && (
                      <StudioTag
                        name={position.studioName}
                        color={position.studioColor}
                        shared={position.shared}
                      />
                    )}
                    <SharedWithNote names={position.sharedWith} />
                    <Chip tone={position.elected ? "brand" : "neutral"}>
                      {position.elected ? "elected" : "appointed"}
                    </Chip>
                    <Chip>
                      {position.seats} seat{position.seats === 1 ? "" : "s"}
                    </Chip>
                    {position.termLength && <Chip>{position.termLength}</Chip>}
                  </div>
                </div>
                {can("positions.manage") && (
                  <button onClick={() => setEditing(position)} className="btn-ghost p-1.5">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex-1 p-4">
                {position.description && (
                  <p className="text-sm text-gray-600">{position.description}</p>
                )}
                {position.responsibilities.length > 0 && (
                  <ul className="mt-2.5 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                    {position.responsibilities.map((duty, index) => (
                      <li key={index}>{duty}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Currently held by
                  </div>
                  {position.current.length === 0 ? (
                    <p className="mt-1.5 text-sm text-gray-400">Vacant.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {position.current.map((holder) => (
                        <li key={holder.id}>
                          <Link
                            href={`/people/${holder.userId}`}
                            className="flex items-center gap-2 text-sm text-gray-800 hover:underline"
                          >
                            <Avatar name={holder.name} src={holder.avatarUrl} size={24} />
                            {holder.name}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {position.past.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
                      {position.past.length} past holder{position.past.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                      {position.past.map((holder) => (
                        <li key={holder.id}>
                          {holder.name} — until {formatDate(holder.endedAt)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              {(can("positions.manage") || can("elections.manage")) && (
                <div className="flex flex-wrap gap-2 border-t border-gray-200 bg-gray-50 p-3">
                  {position.activeElection ? (
                    <Link
                      href={`/elections/${position.activeElection.id}`}
                      className="btn-secondary btn-sm"
                    >
                      <Vote className="h-3.5 w-3.5" /> Election {position.activeElection.status}
                    </Link>
                  ) : (
                    can("positions.manage") && (
                      <button
                        onClick={() => setAppointing(position)}
                        className="btn-secondary btn-sm"
                        disabled={position.current.length >= position.seats}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        {position.current.length >= position.seats ? "Seats full" : "Appoint"}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <PositionModal position={editing} onClose={() => (setEditing(null), setCreating(false))} />
      )}
      {appointing && (
        <AppointModal position={appointing} onClose={() => setAppointing(null)} />
      )}
    </>
  );
}

function PositionModal({ position, onClose }: { position: Position | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { studioId: viewingStudioId } = useSession();
  const [title, setTitle] = useState(position?.title ?? "");
  const [description, setDescription] = useState(position?.description ?? "");
  const [responsibilities, setResponsibilities] = useState<string[]>(
    position?.responsibilities ?? [],
  );
  const [duty, setDuty] = useState("");
  const [seats, setSeats] = useState(position?.seats ?? 1);
  const [termLength, setTermLength] = useState(position?.termLength ?? "");
  const [elected, setElected] = useState(position?.elected ?? true);
  const [targetStudio, setTargetStudio] = useState<number | null | undefined>(
    position ? position.studioId : viewingStudioId === null ? undefined : viewingStudioId,
  );
  const [sharedWith, setSharedWith] = useState<number[]>(position?.sharedStudioIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        responsibilities,
        seats,
        termLength: termLength.trim() || undefined,
        elected,
        ...(targetStudio === undefined ? {} : { studioId: targetStudio }),
        sharedStudioIds:
          targetStudio === null ? [] : sharedWith.filter((id) => id !== targetStudio),
      };
      return position ? apiPatch(`/positions/${position.id}`, body) : apiPost("/positions", body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      onClose();
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  const archive = useMutation({
    mutationFn: () => apiPatch(`/positions/${position!.id}`, { archived: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={position ? "Edit position" : "Add a position"}
      footer={
        <>
          {position && (
            <button
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
              className="btn-danger mr-auto"
            >
              <Archive className="h-3.5 w-3.5" /> Archive
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || title.trim().length < 2 || targetStudio === undefined}
            className="btn-primary"
          >
            {save.isPending && <Spinner />} Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <div>
          <label className="label" htmlFor="pos-title">
            Title
          </label>
          <input
            id="pos-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Hero Buck Committee"
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="pos-desc">
            What is it for?
          </label>
          <textarea
            id="pos-desc"
            className="input min-h-[70px]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div>
          <span className="label">Responsibilities</span>
          {responsibilities.length > 0 && (
            <ul className="mb-2 space-y-1">
              {responsibilities.map((item, index) => (
                <li key={index} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="flex-1">{item}</span>
                  <button
                    onClick={() =>
                      setResponsibilities((current) => current.filter((_, i) => i !== index))
                    }
                    className="btn-ghost p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              className="input"
              value={duty}
              onChange={(event) => setDuty(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && duty.trim()) {
                  event.preventDefault();
                  setResponsibilities((current) => [...current, duty.trim()]);
                  setDuty("");
                }
              }}
              placeholder="Hear appeals and decide them"
            />
            <button
              onClick={() => {
                if (!duty.trim()) return;
                setResponsibilities((current) => [...current, duty.trim()]);
                setDuty("");
              }}
              className="btn-secondary shrink-0"
            >
              Add
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="seats">
              Seats
            </label>
            <input
              id="seats"
              type="number"
              min={1}
              max={20}
              className="input"
              value={seats}
              onChange={(event) => setSeats(Math.max(1, Number(event.target.value)))}
            />
          </div>
          <div>
            <label className="label" htmlFor="term">
              Term length
            </label>
            <input
              id="term"
              className="input"
              value={termLength}
              onChange={(event) => setTermLength(event.target.value)}
              placeholder="One session"
            />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={elected}
            onChange={(event) => setElected(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          <span>
            <span className="font-medium text-gray-900">Filled by election</span>
            <span className="ml-1.5 text-gray-500">rather than appointment</span>
          </span>
        </label>

        <StudioPicker
          value={targetStudio}
          onChange={setTargetStudio}
          label="This position belongs to"
          hint="Only that studio elects it, and only its members can hold it."
        />

        <SharedWithPicker
          ownerStudioId={targetStudio}
          value={sharedWith}
          onChange={setSharedWith}
          noun="position"
        />
      </div>
    </Modal>
  );
}

function AppointModal({ position, onClose }: { position: Position; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { settings, studios } = useSession();
  const [userId, setUserId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const people = useQuery<{ people: Person[] }>({
    queryKey: ["people-all"],
    queryFn: () => apiGet("/profiles"),
  });

  // A Middle Studio seat held by someone in Launchpad is nearly always a
  // mistake, so the picker only offers people who can actually hold it. The
  // server enforces the same rule; this just stops the mistake being offered.
  const eligibleStudios = [position.studioId, ...(position.sharedStudioIds ?? [])];
  const restricted = settings.governance.restrictCandidatesToStudio && position.studioId !== null;
  const candidates = (people.data?.people ?? []).filter(
    (person) => !restricted || eligibleStudios.includes(person.studioId),
  );
  const eligibleNames = studios
    .filter((entry) => eligibleStudios.includes(entry.id))
    .map((entry) => entry.name);

  const appoint = useMutation({
    mutationFn: () => apiPost(`/positions/${position.id}/holders`, { userId, note }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["positions"] });
      onClose();
    },
    onError: (appointError: Error) => setError(appointError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Appoint someone to ${position.title}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => appoint.mutate()}
            disabled={!userId || appoint.isPending}
            className="btn-primary"
          >
            {appoint.isPending && <Spinner />} Appoint
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        {position.elected && (
          <Banner tone="warning">
            This is an elected position. Appointing directly bypasses the studio's vote — worth
            doing only to record an election that happened offline.
          </Banner>
        )}
        <div>
          <label className="label" htmlFor="person">
            Who?
          </label>
          <select
            id="person"
            className="input"
            value={userId ?? ""}
            onChange={(event) => setUserId(event.target.value ? Number(event.target.value) : null)}
          >
            <option value="">Pick a person</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {restricted && (
            <p className="hint">
              {candidates.length === 0
                ? `Nobody in ${eligibleNames.join(" or ") || "that studio"} yet. Move someone there first, or turn off the studio restriction in Settings.`
                : `Only people in ${eligibleNames.join(" and ")} can hold this.`}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="note">
            Note (optional)
          </label>
          <input
            id="note"
            className="input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Elected at the Town Hall on the 3rd"
          />
        </div>
      </div>
    </Modal>
  );
}
