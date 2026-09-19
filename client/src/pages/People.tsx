import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Code2, Pencil } from "lucide-react";
import { apiGet, apiPatch, apiPost, fileToDataUrl } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import {
  Avatar,
  Banner,
  Chip,
  LoadingPage,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { StudioTag } from "@/components/StudioSwitcher";
import { TaconPanels } from "@/pages/TaconPage";

type StudioRow = {
  id: number;
  name: string;
  color: string;
  ageRange: string | null;
  orderIndex: number;
  archived: boolean;
};

type PersonRow = {
  id: number;
  name: string;
  email: string | null;
  role: string;
  studioId: number | null;
  avatarUrl: string | null;
  bio: string | null;
  nga: string | null;
  currentPositions: string[];
};

export function People() {
  const { studioId, studios: myStudios } = useSession();
  const [showEveryone, setShowEveryone] = useState(studioId === null);

  const query = useQuery<{ people: PersonRow[]; studios: StudioRow[] }>({
    queryKey: ["people-all"],
    queryFn: () => apiGet("/profiles"),
  });

  if (query.isLoading) return <LoadingPage />;
  const people = query.data?.people ?? [];
  const studios = (query.data?.studios ?? []).filter((studio) => !studio.archived);

  // Default to the studio you're in: a Middle Studio learner opening People
  // wants their own roster, not ninety names across four studios.
  const visible = showEveryone
    ? people
    : people.filter((person) => person.studioId === studioId);

  const groups = [
    ...studios
      .filter((studio) => showEveryone || studio.id === studioId)
      .map((studio) => ({
        key: String(studio.id),
        label: studio.name,
        color: studio.color,
        people: visible.filter((person) => person.studioId === studio.id),
      })),
    {
      key: "none",
      label: "Not in a studio",
      color: null as string | null,
      people: visible.filter((person) => person.studioId === null),
    },
  ].filter((group) => group.people.length > 0);

  const currentStudioName = myStudios.find((entry) => entry.id === studioId)?.name;

  return (
    <>
      <PageHeader
        title="People"
        subtitle={
          showEveryone
            ? `${people.length} in the academy, across ${studios.length} studio${studios.length === 1 ? "" : "s"}.`
            : `${visible.length} in ${currentStudioName ?? "this studio"}.`
        }
      >
        {studioId !== null && (
          <button
            onClick={() => setShowEveryone((value) => !value)}
            className="btn-secondary btn-sm"
          >
            {showEveryone ? `Just ${currentStudioName ?? "my studio"}` : "Show the whole academy"}
          </button>
        )}
      </PageHeader>

      <div className="space-y-6">
        {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-2.5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {group.color && (
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: group.color }}
                  />
                )}
                {group.label}
                <span className="font-normal normal-case text-gray-400">
                  {group.people.length}
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.people.map((person) => (
                  <Link
                    key={person.id}
                    href={`/people/${person.id}`}
                    className="card flex items-start gap-3 p-4 transition hover:border-brand-300"
                  >
                    <Avatar name={person.name} src={person.avatarUrl} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-gray-900">{person.name}</div>
                      <Chip tone={person.role === "guide" ? "neutral" : "brand"} className="mt-1">
                        {person.role}
                      </Chip>
                      {/* Only shown when the academy has turned addresses on. */}
                      {person.email && (
                        <div className="mt-1 truncate text-xs text-gray-500">{person.email}</div>
                      )}
                      {person.currentPositions.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {person.currentPositions.map((title) => (
                            <Chip key={title} tone="purple">
                              {title}
                            </Chip>
                          ))}
                        </div>
                      )}
                      {person.nga && (
                        <p className="mt-1.5 line-clamp-2 text-xs text-gray-500">{person.nga}</p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
      </div>
      <TaconPanels host="people" />
    </>
  );
}

/* -------------------------------- profile --------------------------------- */

type ProfileResponse = {
  person: {
    id: number;
    name: string;
    email: string | null;
    role: string;
    studioId: number | null;
    bio: string | null;
    nga: string | null;
    avatarUrl: string | null;
    createdAt: string;
    /** Dev status is granted per person, not per role - see the Tac-Ons docs. */
    devStatus: boolean;
    devHandle: string | null;
  };
  studio: { id: number; name: string; color: string } | null;
  positions: {
    holder: { id: number; startedAt: string; endedAt: string | null; note: string | null };
    title: string;
    description: string | null;
    studioId: number | null;
  }[];
  isSelf: boolean;
  canEdit: boolean;
};

export function Profile({ id }: { id: number }) {
  const [editing, setEditing] = useState(false);
  const formatDate = useDateFormat();

  const query = useQuery<ProfileResponse>({
    queryKey: ["profile", id],
    queryFn: () => apiGet(`/profiles/${id}`),
  });

  if (query.isLoading) return <LoadingPage />;
  if (!query.data) return <Banner tone="error">No such person.</Banner>;

  const { person, studio, positions, canEdit } = query.data;
  const current = positions.filter((entry) => !entry.holder.endedAt);
  const past = positions.filter((entry) => entry.holder.endedAt);

  return (
    <>
      <Link href="/people" className="btn-ghost btn-sm -ml-2 mb-3">
        <ArrowLeft className="h-3.5 w-3.5" /> Everyone
      </Link>

      <div className="card mb-5 p-6">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={person.name} src={person.avatarUrl} size={80} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{person.name}</h1>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Chip tone={person.role === "guide" ? "neutral" : "brand"}>{person.role}</Chip>
              {studio ? (
                <StudioTag name={studio.name} color={studio.color} />
              ) : (
                <Chip>Not in a studio</Chip>
              )}
              {person.email && <Chip>{person.email}</Chip>}
              {person.devStatus && person.devHandle && (
                <Link href={`/devs/${person.devHandle}`}>
                  <Chip tone="purple">
                    <Code2 className="h-3 w-3" /> Dev
                  </Chip>
                </Link>
              )}
            </div>
            {person.nga && (
              <p className="mt-3 text-sm">
                <span className="font-medium text-gray-700">Next Great Adventure:</span>{" "}
                <span className="text-gray-600">{person.nga}</span>
              </p>
            )}
            {person.bio && <p className="mt-2.5 text-sm text-gray-600">{person.bio}</p>}
          </div>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="btn-secondary btn-sm shrink-0">
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h2 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
            Serving now
          </h2>
          {current.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No current positions.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {current.map((entry) => (
                <li key={entry.holder.id} className="p-4">
                  <div className="font-medium text-gray-900">{entry.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Since {formatDate(entry.holder.startedAt)}
                  </div>
                  {entry.holder.note && (
                    <p className="mt-1 text-xs text-gray-500">{entry.holder.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="border-b border-gray-200 p-4 text-sm font-semibold text-gray-900">
            Has served as
          </h2>
          {past.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">Nothing yet — this is the start of the story.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {past.map((entry) => (
                <li key={entry.holder.id} className="p-4">
                  <div className="font-medium text-gray-900">{entry.title}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {formatDate(entry.holder.startedAt)} — {formatDate(entry.holder.endedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <DevStatusCard person={person} />

      {editing && (
        <EditProfileModal profile={query.data} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

/**
 * Dev status.
 *
 * An admin grants it to a learner who is ready to build Tac-Ons. It is not a
 * promotion - it changes nothing about governance, voting or the wiki - so it
 * sits here on the profile rather than next to the role, where it would read
 * like a fifth role.
 */
function DevStatusCard({
  person,
}: {
  person: { id: number; name: string; devStatus: boolean; devHandle: string | null };
}) {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [error, setError] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPost("/tacons/devs/grant", { userId: person.id, enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile", person.id] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (grantError: Error) => setError(grantError.message),
  });

  if (!can("tacons.grant_dev")) return null;

  return (
    <div className="card-pad mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Code2 className="h-4 w-4" /> Dev status
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            {person.devStatus
              ? `${person.name} can write and publish Tac-Ons, and has a public dev profile.`
              : `Lets ${person.name} write Tac-Ons in the dev menu and publish them to the market. It changes nothing else — they vote and read exactly as they do now.`}
          </p>
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </div>
        <button
          onClick={() => grant.mutate(!person.devStatus)}
          disabled={grant.isPending}
          className={person.devStatus ? "btn-danger shrink-0" : "btn-secondary shrink-0"}
        >
          {grant.isPending && <Spinner />}
          {person.devStatus ? "Remove dev status" : "Give dev status"}
        </button>
      </div>
    </div>
  );
}

function EditProfileModal({
  profile,
  onClose,
}: {
  profile: ProfileResponse;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { refresh, studios, user, learnerNoun } = useSession();
  const isAdmin = user?.role === "admin";
  const [name, setName] = useState(profile.person.name);
  const [bio, setBio] = useState(profile.person.bio ?? "");
  const [nga, setNga] = useState(profile.person.nga ?? "");
  const [studioId, setStudioId] = useState<number | null>(profile.person.studioId);
  const [avatarUrl, setAvatarUrl] = useState(profile.person.avatarUrl);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/profiles/${profile.person.id}`, {
        name: name.trim(),
        bio: bio.trim() || null,
        nga: nga.trim() || null,
        avatarUrl,
        // Moving someone between studios changes what they can vote on, so only
        // an admin sends this field at all.
        ...(isAdmin ? { studioId } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile", profile.person.id] });
      await queryClient.invalidateQueries({ queryKey: ["people-all"] });
      if (profile.isSelf) await refresh();
      onClose();
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setAvatarUrl(await fileToDataUrl(file, 700_000));
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Couldn't read that image.");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit profile"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary">
            {save.isPending && <Spinner />} Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}

        <div className="flex items-center gap-4">
          <Avatar name={name} src={avatarUrl} size={64} />
          <div>
            <label className="btn-secondary btn-sm cursor-pointer">
              <Camera className="h-3.5 w-3.5" /> Change photo
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => pickAvatar(event.target.files?.[0])}
              />
            </label>
            {avatarUrl && (
              <button onClick={() => setAvatarUrl(null)} className="btn-ghost btn-sm ml-1">
                Remove
              </button>
            )}
            <p className="hint">Under 700KB.</p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="profile-name">
            Name
          </label>
          <input
            id="profile-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        {isAdmin ? (
          <div>
            <label className="label" htmlFor="profile-studio">
              Studio
            </label>
            <select
              id="profile-studio"
              className="input"
              value={studioId ?? ""}
              onChange={(event) =>
                setStudioId(event.target.value === "" ? null : Number(event.target.value))
              }
            >
              <option value="">Not in a studio</option>
              {studios.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.ageRange ? ` (${option.ageRange})` : ""}
                </option>
              ))}
            </select>
            <p className="hint">
              This decides which wiki they read, which Town Halls they're in, and which ballots
              they can cast. Only an admin can change it.
            </p>
          </div>
        ) : (
          <div>
            <span className="label">Studio</span>
            <div className="input bg-gray-50 text-gray-500">
              {studios.find((entry) => entry.id === profile.person.studioId)?.name ??
                "Not in a studio"}
            </div>
            <p className="hint">Ask an admin if this is wrong.</p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="profile-nga">
            Next Great Adventure
          </label>
          <input
            id="profile-nga"
            className="input"
            value={nga}
            onChange={(event) => setNga(event.target.value)}
            placeholder="Marine biology, or a bike shop, or still figuring it out"
          />
          <p className="hint">
            Shows under your name when you run for a position in your studio.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="profile-bio">
            About you
          </label>
          <textarea
            id="profile-bio"
            className="input min-h-[110px]"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="What you're working on, what you care about, what you'd want people to know before they vote for you."
          />
        </div>
      </div>
    </Modal>
  );
}
