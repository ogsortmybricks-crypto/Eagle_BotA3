import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Pencil } from "lucide-react";
import { apiGet, apiPatch, fileToDataUrl } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Avatar,
  Banner,
  Chip,
  LoadingPage,
  Modal,
  PageHeader,
  Spinner,
} from "@/components/ui";

const STUDIOS = [
  { value: "spark", label: "Spark" },
  { value: "elementary", label: "Elementary / Discovery" },
  { value: "middle", label: "Middle Studio" },
  { value: "launchpad", label: "Launchpad" },
  { value: "staff", label: "Staff" },
];

type PersonRow = {
  id: number;
  name: string;
  role: string;
  studio: string | null;
  avatarUrl: string | null;
  bio: string | null;
  nga: string | null;
  currentPositions: string[];
};

export function People() {
  const query = useQuery<{ people: PersonRow[] }>({
    queryKey: ["people"],
    queryFn: () => apiGet("/profiles"),
  });

  if (query.isLoading) return <LoadingPage />;
  const people = query.data?.people ?? [];

  const byStudio = STUDIOS.map((studio) => ({
    ...studio,
    people: people.filter((person) => person.studio === studio.value),
  })).filter((group) => group.people.length > 0);
  const unassigned = people.filter((person) => !person.studio);

  return (
    <>
      <PageHeader title="People" subtitle={`${people.length} in the academy.`} />

      <div className="space-y-6">
        {[...byStudio, { value: "none", label: "No studio set", people: unassigned }]
          .filter((group) => group.people.length > 0)
          .map((group) => (
            <section key={group.value}>
              <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-gray-500">
                {group.label}
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
    </>
  );
}

/* -------------------------------- profile --------------------------------- */

type ProfileResponse = {
  person: {
    id: number;
    name: string;
    email: string;
    role: string;
    studio: string | null;
    bio: string | null;
    nga: string | null;
    avatarUrl: string | null;
    createdAt: string;
  };
  positions: {
    holder: { id: number; startedAt: string; endedAt: string | null; note: string | null };
    title: string;
    description: string | null;
  }[];
  isSelf: boolean;
  canEdit: boolean;
};

export function Profile({ id }: { id: number }) {
  const [editing, setEditing] = useState(false);

  const query = useQuery<ProfileResponse>({
    queryKey: ["profile", id],
    queryFn: () => apiGet(`/profiles/${id}`),
  });

  if (query.isLoading) return <LoadingPage />;
  if (!query.data) return <Banner tone="error">No such person.</Banner>;

  const { person, positions, canEdit } = query.data;
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
              {person.studio && (
                <Chip>{STUDIOS.find((s) => s.value === person.studio)?.label ?? person.studio}</Chip>
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
                    Since {new Date(entry.holder.startedAt).toLocaleDateString()}
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
                    {new Date(entry.holder.startedAt).toLocaleDateString()} —{" "}
                    {new Date(entry.holder.endedAt!).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <EditProfileModal profile={query.data} onClose={() => setEditing(false)} />
      )}
    </>
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
  const { refresh } = useSession();
  const [name, setName] = useState(profile.person.name);
  const [bio, setBio] = useState(profile.person.bio ?? "");
  const [nga, setNga] = useState(profile.person.nga ?? "");
  const [studio, setStudio] = useState(profile.person.studio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile.person.avatarUrl);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/profiles/${profile.person.id}`, {
        name: name.trim(),
        bio: bio.trim() || null,
        nga: nga.trim() || null,
        studio: studio || null,
        avatarUrl,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile", profile.person.id] });
      await queryClient.invalidateQueries({ queryKey: ["people"] });
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

        <div>
          <label className="label" htmlFor="profile-studio">
            Studio
          </label>
          <select
            id="profile-studio"
            className="input"
            value={studio}
            onChange={(event) => setStudio(event.target.value)}
          >
            <option value="">Not set</option>
            {STUDIOS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

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
          <p className="hint">Shows under your name when you run for a position.</p>
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
