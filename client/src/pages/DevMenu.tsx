/**
 * The dev menu.
 *
 * Where a learner with dev status writes a Tac-On, sees it fail to compile,
 * fixes it, and ships it. The editor validates against the same compiler the
 * server publishes with, on every keystroke, so the feedback loop is the same
 * one a real developer has - which is the entire point of the exercise.
 *
 * Nothing here is a toy. Publishing puts a listing in the market that admins at
 * this academy can install, and the stats tab shows how many took it.
 */

import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Code2,
  FileCode,
  Plus,
  Rocket,
  Upload,
} from "lucide-react";
import { ApiError, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import {
  Banner,
  Chip,
  EmptyState,
  LoadingPage,
  Modal,
  PageHeader,
  Spinner,
  Stat,
} from "@/components/ui";
import type { AppCheck, AppPackage } from "@shared/tacons";
import { AppPackagePicker } from "@/tacons/AppPackagePicker";

type MyTacon = {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string;
  icon: string;
  category: string;
  visibility: "draft" | "unlisted" | "public";
  official: boolean;
  suspendedReason: string | null;
  installCount: number;
  version: string | null;
  /** The latest version as an app package; null if it was TacScript. */
  app: AppPackage | null;
  /** The latest version's TacScript, for a Tac-On not yet rebuilt as an app. */
  legacySource: string | null;
  updatedAt: string;
  stats: {
    active: number;
    onLatest: number;
    academies: number;
    lastInstalledAt: string | null;
  };
};


export function DevMenu() {
  const { user, can } = useSession();
  const formatDate = useDateFormat();
  const [editing, setEditing] = useState<MyTacon | "new" | null>(null);
  const [stats, setStats] = useState<MyTacon | null>(null);

  const query = useQuery<{ tacons: MyTacon[] }>({
    queryKey: ["dev-tacons"],
    queryFn: () => apiGet("/tacons/dev/mine"),
    enabled: can("tacons.develop"),
  });

  if (!can("tacons.develop")) {
    return (
      <EmptyState icon={Code2} title="Dev status isn't switched on for you">
        An admin can give you dev status from the People page. It lets you write and publish
        Tac-Ons, and gives you a dev profile other academies can see.
      </EmptyState>
    );
  }

  if (query.isLoading) return <LoadingPage />;
  const mine = query.data?.tacons ?? [];

  return (
    <>
      <PageHeader
        title="Dev menu"
        subtitle="Build a Tac-On app, publish it, and watch who installs it."
      >
        {user?.devHandle && (
          <Link href={`/devs/${user.devHandle}`} className="btn-secondary">
            My dev profile
          </Link>
        )}
        <button onClick={() => setEditing("new")} className="btn-primary">
          <Plus className="h-4 w-4" /> New Tac-On
        </button>
      </PageHeader>

      {mine.length === 0 ? (
        <EmptyState
          icon={FileCode}
          title="Nothing published yet"
          action={
            <button onClick={() => setEditing("new")} className="btn-primary">
              <Plus className="h-4 w-4" /> Write your first one
            </button>
          }
        >
          A Tac-On is a small web app that adds something to Eagle Bot: a folder with a manifest.json
          and an index.html. The Tac-On Guide has a complete example to start from.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {mine.map((tacon) => (
            <div key={tacon.id} className="card flex flex-col">
              <div className="border-b border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-gray-900">{tacon.name}</h2>
                    <p className="truncate text-xs text-gray-500">{tacon.slug}</p>
                  </div>
                  <Chip
                    tone={
                      tacon.visibility === "public"
                        ? "green"
                        : tacon.visibility === "unlisted"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {tacon.visibility}
                  </Chip>
                </div>
                <p className="mt-2 text-sm text-gray-600">{tacon.tagline}</p>
                {tacon.suspendedReason && (
                  <p className="mt-2 flex gap-1.5 text-xs text-red-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Pulled by the dev portal: {tacon.suspendedReason}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 p-4 text-center">
                <div>
                  <div className="text-lg font-bold tabular-nums text-gray-900">
                    {tacon.installCount}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">installs</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums text-gray-900">
                    {tacon.stats.active}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">active</div>
                </div>
                <div>
                  <div className="text-lg font-bold tabular-nums text-gray-900">
                    {tacon.version ?? "—"}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500">version</div>
                </div>
              </div>

              {tacon.stats.active > tacon.stats.onLatest && (
                <p className="px-4 pb-2 text-xs text-amber-700">
                  {tacon.stats.active - tacon.stats.onLatest} install
                  {tacon.stats.active - tacon.stats.onLatest === 1 ? " is" : "s are"} still on an
                  older version.
                </p>
              )}

              <div className="mt-auto flex flex-wrap gap-2 border-t border-gray-200 bg-gray-50 p-3">
                <button onClick={() => setEditing(tacon)} className="btn-secondary btn-sm">
                  <Code2 className="h-3.5 w-3.5" /> Edit & publish
                </button>
                <button onClick={() => setStats(tacon)} className="btn-secondary btn-sm">
                  <BarChart3 className="h-3.5 w-3.5" /> Stats
                </button>
                <Link href={`/tacons/${tacon.slug}`} className="btn-ghost btn-sm">
                  View listing
                </Link>
                <span className="ml-auto self-center text-[11px] text-gray-400">
                  {formatDate(tacon.updatedAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Editor
          tacon={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {stats && <StatsModal tacon={stats} onClose={() => setStats(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  The editor                                                                 */
/* -------------------------------------------------------------------------- */

function Editor({ tacon, onClose }: { tacon: MyTacon | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [pkg, setPkg] = useState<AppPackage | null>(null);
  const [tagline, setTagline] = useState(tacon?.tagline ?? "");
  const [description, setDescription] = useState(tacon?.description ?? "");
  const [changelog, setChangelog] = useState("");
  const [visibility, setVisibility] = useState(tacon?.visibility ?? "draft");
  const [error, setError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () =>
      apiPost<{ version: { version: string } }>("/tacons/dev/publish", {
        app: pkg,
        tagline: tagline.trim() || undefined,
        description: description.trim() || undefined,
        changelog: changelog.trim() || undefined,
        visibility,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dev-tacons"] });
      void queryClient.invalidateQueries({ queryKey: ["tacon-market"] });
      onClose();
    },
    onError: (publishError: Error) => {
      const checks = publishError instanceof ApiError ? (publishError.payload?.checks as AppCheck[] | undefined) : undefined;
      const failed = checks?.filter((check) => !check.ok).map((check) => check.message).join(" ");
      setError(failed ? `${publishError.message} ${failed}` : publishError.message);
    },
  });

  const saveListing = useMutation({
    mutationFn: () =>
      apiPatch(`/tacons/dev/${tacon!.id}`, {
        tagline: tagline.trim(),
        description,
        visibility,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dev-tacons"] });
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  // A new version has to keep the Tac-On's name, or it would be a different Tac-On.
  const nameMismatch = !!tacon && !!pkg && pkg.manifest.name !== tacon.slug;
  const sameVersion = !!tacon && !!pkg && pkg.manifest.version === tacon.version;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={tacon ? `Edit ${tacon.name}` : "New Tac-On"}
      description="A Tac-On is a small web app: a folder with manifest.json and index.html. It runs in a sandbox and uses Eagle Bot through the EagleBot SDK."
      footer={
        <>
          {tacon && (
            <button
              onClick={() => saveListing.mutate()}
              disabled={saveListing.isPending}
              className="btn-secondary mr-auto"
            >
              {saveListing.isPending && <Spinner />} Save listing only
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => publish.mutate()}
            disabled={publish.isPending || !pkg || nameMismatch || sameVersion}
            className="btn-primary"
            title={
              !pkg
                ? "Choose an app that passes its checks first"
                : nameMismatch
                  ? "Keep this Tac-On's name, or use New Tac-On"
                  : sameVersion
                    ? "Raise the version in manifest.json first"
                    : undefined
            }
          >
            {publish.isPending ? <Spinner /> : <Rocket className="h-4 w-4" />} Publish
            {pkg ? ` ${pkg.manifest.version}` : ""}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}

        {tacon?.legacySource && (
          <Banner tone="info" title="This Tac-On was written in TacScript">
            TacScript has been retired. Rebuild it as an app with <code>"name": "{tacon.slug}"</code> in its
            manifest and publish that as the next version. When an academy updates, every record it saved
            comes with it — <code>EagleBot.api.getRecords()</code> returns them, tagged with the store they
            were saved in. The installs running it now keep working until then.
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium">See the TacScript source</summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-white p-2 text-[11px]">{tacon.legacySource}</pre>
            </details>
          </Banner>
        )}

        <AppPackagePicker current={tacon?.app ?? null} onChange={setPkg} disabled={publish.isPending} />

        {nameMismatch && (
          <Banner tone="error" title="This app belongs to a different Tac-On">
            This editor is for <code>{tacon.slug}</code>, but the manifest says <code>{pkg.manifest.name}</code>.
            Change the manifest's name back, or use New Tac-On to publish it as a separate listing.
          </Banner>
        )}
        {sameVersion && (
          <Banner tone="warning" title="That version is already published">
            Raise <code>version</code> in manifest.json — Eagle Bot never overwrites a version an academy is running.
          </Banner>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="tagline">
              One-line blurb
            </label>
            <input
              id="tagline"
              className="input"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              placeholder="What an admin reads on the tile."
            />
          </div>
          <div>
            <label className="label" htmlFor="visibility">
              Who can find it
            </label>
            <select
              id="visibility"
              className="input"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as MyTacon["visibility"])}
            >
              <option value="draft">Draft — only this academy</option>
              <option value="unlisted">Unlisted — anyone with the link</option>
              <option value="public">Public — in the market</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="description">
            The details page (markdown)
          </label>
          <textarea
            id="description"
            className="input min-h-[100px]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What it does, who it's for, anything an admin should know before installing."
          />
        </div>

        <div>
          <label className="label" htmlFor="changelog">
            What changed in this version
          </label>
          <input
            id="changelog"
            className="input"
            value={changelog}
            onChange={(event) => setChangelog(event.target.value)}
            placeholder="Fixed the total counting spends twice."
          />
          <p className="hint">Admins see this when they decide whether to update.</p>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Statistics                                                                 */
/* -------------------------------------------------------------------------- */

type StatsPayload = {
  tacon: { id: number; name: string; installCount: number };
  versions: { id: number; version: string; changelog: string | null; createdAt: string; running: number }[];
  installs: {
    total: number;
    enabled: number;
    academies: number;
    timeline: { day: string; installs: number }[];
  };
};

function StatsModal({ tacon, onClose }: { tacon: MyTacon; onClose: () => void }) {
  const formatDate = useDateFormat();
  const query = useQuery<StatsPayload>({
    queryKey: ["dev-stats", tacon.id],
    queryFn: () => apiGet(`/tacons/dev/${tacon.id}/stats`),
  });

  const peak = Math.max(1, ...(query.data?.installs.timeline ?? []).map((point) => point.installs));

  return (
    <Modal open wide onClose={onClose} title={`${tacon.name} — statistics`}>
      {query.isLoading || !query.data ? (
        <LoadingPage />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Installs" value={query.data.installs.total} />
            <Stat label="Still on" value={query.data.installs.enabled} tone="good" />
            <Stat label="Academies" value={query.data.installs.academies} />
            <Stat label="Versions" value={query.data.versions.length} />
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">Installs over time</h3>
            {query.data.installs.timeline.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">Nobody has installed it yet.</p>
            ) : (
              <div className="mt-3 flex items-end gap-1" style={{ height: 96 }}>
                {query.data.installs.timeline.map((point) => (
                  <div key={point.day} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full rounded-t bg-brand-500"
                      style={{ height: `${(point.installs / peak) * 80}px` }}
                      title={`${point.installs} on ${point.day}`}
                    />
                    <span className="text-[10px] text-gray-400">{point.day.slice(5)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900">Versions</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-1.5">Version</th>
                  <th className="py-1.5">Published</th>
                  <th className="py-1.5">Running</th>
                  <th className="py-1.5">Notes</th>
                </tr>
              </thead>
              <tbody>
                {query.data.versions.map((version) => (
                  <tr key={version.id} className="border-b border-gray-100 last:border-0">
                    <td className="py-1.5 font-medium text-gray-800">{version.version}</td>
                    <td className="py-1.5 text-gray-500">{formatDate(version.createdAt)}</td>
                    <td className="py-1.5 tabular-nums text-gray-700">{version.running}</td>
                    <td className="py-1.5 text-gray-500">{version.changelog ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Banner tone="info">
            <span className="inline-flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5" /> Pushing an update never changes an academy's copy
              on its own — an admin chooses when to take it.
            </span>
          </Banner>
        </div>
      )}
    </Modal>
  );
}
