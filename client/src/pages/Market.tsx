/**
 * The Tac-Ons market.
 *
 * A grid of tiles, and behind each one a page that tells an admin what they are
 * about to let into their academy: what it adds, what it reads, who wrote it,
 * and how many other academies run it. The permissions list is the part that
 * matters - an admin should never have to read TacScript to know what a Tac-On
 * touches.
 */

import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Download,
  Eye,
  EyeOff,
  Package,
  Puzzle,
  Search,
  ShieldAlert,
  Trash2,
  Zap,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useDateFormat, useSession } from "@/lib/session";
import {
  Banner,
  Chip,
  EmptyState,
  LoadingPage,
  Markdown,
  Modal,
  PageHeader,
  Spinner,
  Stat,
} from "@/components/ui";
import { StudioPicker } from "@/components/StudioPicker";
import type { Manifest } from "@shared/tacons";

type Listing = {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  icon: string;
  category: string;
  official: boolean;
  authorName: string;
  authorHandle: string | null;
  visibility: string;
  installCount: number;
  version: string | null;
  suspended: boolean;
  mine: boolean;
  installs: number;
  updatedAt: string;
};

const CATEGORY_TONES: Record<string, "brand" | "green" | "amber" | "purple" | "blue" | "neutral"> = {
  governance: "brand",
  quests: "green",
  community: "purple",
  tracking: "blue",
  fun: "amber",
  general: "neutral",
};

export function Market() {
  const { can } = useSession();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");

  const query = useQuery<{ tacons: Listing[] }>({
    queryKey: ["tacon-market"],
    queryFn: () => apiGet("/tacons/market"),
  });

  if (query.isLoading) return <LoadingPage />;
  const all = query.data?.tacons ?? [];

  const categories = ["all", ...new Set(all.map((entry) => entry.category))];
  const listings = all.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      (entry.tagline ?? "").toLowerCase().includes(needle) ||
      entry.authorName.toLowerCase().includes(needle)
    );
  });

  return (
    <>
      <PageHeader
        title="Tac-Ons"
        subtitle="Extensions for Eagle Bot. Install one and it becomes part of the app."
      >
        {can("tacons.develop") && (
          <Link href="/dev" className="btn-secondary">
            <Zap className="h-4 w-4" /> Dev menu
          </Link>
        )}
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search Tac-Ons"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((entry) => (
            <button
              key={entry}
              onClick={() => setCategory(entry)}
              className={`chip ${
                category === entry ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700"
              }`}
            >
              {entry}
            </button>
          ))}
        </div>
      </div>

      {listings.length === 0 ? (
        <EmptyState icon={Package} title="Nothing here yet">
          When a dev at this academy publishes a Tac-On it shows up here, next to the official ones.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <Link
              key={listing.id}
              href={`/tacons/${listing.slug}`}
              className="card flex flex-col p-4 transition hover:border-brand-300 hover:shadow"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Puzzle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2 className="truncate font-semibold text-gray-900">{listing.name}</h2>
                    {listing.official && (
                      <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-label="Official" />
                    )}
                  </div>
                  <p className="truncate text-xs text-gray-500">by {listing.authorName}</p>
                </div>
              </div>

              <p className="mt-3 flex-1 text-sm text-gray-600">{listing.tagline}</p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Chip tone={CATEGORY_TONES[listing.category] ?? "neutral"}>{listing.category}</Chip>
                <Chip>
                  <Download className="h-3 w-3" /> {listing.installCount}
                </Chip>
                {listing.installs > 0 && <Chip tone="green">Installed</Chip>}
                {listing.visibility !== "public" && <Chip tone="amber">{listing.visibility}</Chip>}
                {listing.suspended && <Chip tone="red">Pulled</Chip>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  One Tac-On                                                                 */
/* -------------------------------------------------------------------------- */

type Detail = {
  tacon: {
    id: number;
    slug: string;
    name: string;
    tagline: string | null;
    description: string;
    category: string;
    official: boolean;
    authorName: string;
    authorHandle: string | null;
    visibility: string;
    installCount: number;
    suspendedReason: string | null;
    mine: boolean;
    updatedAt: string;
  };
  manifest: Manifest | null;
  source: string;
  versions: { id: number; version: string; changelog: string | null; createdAt: string }[];
  installs: {
    id: number;
    studioId: number | null;
    studioName: string | null;
    enabled: boolean;
    settings: Record<string, unknown>;
    updateAvailable: boolean;
  }[];
};

/** Plain-English readings of the permissions a Tac-On can ask for. */
const NEEDS_WORDS: Record<string, string> = {
  "wiki.read": "Read the wiki and the list of people",
  "positions.read": "Read the positions and who holds them",
  "meetings.read": "Read Town Hall meetings",
  "elections.read": "Read elections and their results",
  "activity.read": "Read the activity log",
};

export function TaconDetail({ slug }: { slug: string }) {
  const { can } = useSession();
  const formatDate = useDateFormat();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [installing, setInstalling] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<Detail>({
    queryKey: ["tacon-detail", slug],
    queryFn: () => apiGet(`/tacons/market/${slug}`),
    retry: false,
  });

  const uninstall = useMutation({
    mutationFn: (installId: number) => apiDelete(`/tacons/installs/${installId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tacon-detail", slug] });
      void queryClient.invalidateQueries({ queryKey: ["tacon-nav"] });
      void queryClient.invalidateQueries({ queryKey: ["tacon-market"] });
    },
    onError: (removeError: Error) => setError(removeError.message),
  });

  const update = useMutation({
    mutationFn: (installId: number) => apiPost(`/tacons/installs/${installId}/update`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tacon-detail", slug] });
      void queryClient.invalidateQueries({ queryKey: ["tacon-nav"] });
    },
    onError: (updateError: Error) => setError(updateError.message),
  });

  const toggle = useMutation({
    mutationFn: ({ installId, enabled }: { installId: number; enabled: boolean }) =>
      apiPatch(`/tacons/installs/${installId}`, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tacon-detail", slug] });
      void queryClient.invalidateQueries({ queryKey: ["tacon-nav"] });
    },
  });

  if (query.isLoading) return <LoadingPage />;
  if (query.error) {
    return (
      <EmptyState icon={Puzzle} title="No Tac-On by that name">
        {(query.error as Error).message}
      </EmptyState>
    );
  }

  const { tacon, manifest, versions, installs, source } = query.data!;

  return (
    <>
      <button onClick={() => navigate("/tacons")} className="btn-ghost mb-4 -ml-2 text-sm">
        <ArrowLeft className="h-4 w-4" /> Market
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Puzzle className="h-7 w-7" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">{tacon.name}</h1>
              {tacon.official && <Chip tone="purple">Official</Chip>}
              {tacon.mine && <Chip tone="brand">From this academy</Chip>}
            </div>
            <p className="mt-1 text-sm text-gray-600">{tacon.tagline}</p>
            <p className="mt-1 text-xs text-gray-500">
              by{" "}
              {tacon.authorHandle ? (
                <Link href={`/devs/${tacon.authorHandle}`} className="text-brand-600 underline">
                  {tacon.authorName}
                </Link>
              ) : (
                tacon.authorName
              )}{" "}
              · {manifest?.version ?? "unpublished"} · updated {formatDate(tacon.updatedAt)}
            </p>
          </div>
        </div>

        {can("tacons.install") && !tacon.suspendedReason && (
          <button onClick={() => setInstalling(true)} className="btn-primary">
            <Download className="h-4 w-4" /> Install
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      {tacon.suspendedReason && (
        <div className="mt-4">
          <Banner tone="error" title="This Tac-On has been pulled from the market">
            {tacon.suspendedReason} Academies already running it keep it and their records; nobody
            new can install it.
          </Banner>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card-pad">
            <Markdown>{tacon.description || tacon.tagline || "No description yet."}</Markdown>
          </div>

          {manifest && (
            <div className="card-pad">
              <h2 className="font-semibold text-gray-900">What it adds</h2>
              <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
                {manifest.pages.map((page) => (
                  <li key={page.name}>
                    <span className="font-medium text-gray-800">{page.title}</span> — a page
                    {page.nav ? " in the sidebar" : ", reachable by link"}
                    {page.showTo.length > 0 && ` (${page.showTo.join(", ")} only)`}
                  </li>
                ))}
                {manifest.panels.map((panel, index) => (
                  <li key={index}>
                    <span className="font-medium text-gray-800">{panel.title}</span> — a panel on the{" "}
                    {panel.host} page
                  </li>
                ))}
                {manifest.hooks.map((hook, index) => (
                  <li key={`hook-${index}`}>
                    Reacts when <code className="rounded bg-gray-100 px-1">{hook.event}</code>{" "}
                    happens
                  </li>
                ))}
                {manifest.stores.map((store) => (
                  <li key={store.name}>
                    Keeps its own records: {store.label} ({store.fields.length} field
                    {store.fields.length === 1 ? "" : "s"})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {manifest && (
            <div className="card-pad">
              <h2 className="font-semibold text-gray-900">What it can read</h2>
              {manifest.needs.length === 0 ? (
                <p className="mt-2 text-sm text-gray-600">
                  Nothing outside its own records.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
                  {manifest.needs.map((need) => (
                    <li key={need} className="flex gap-2">
                      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      {NEEDS_WORDS[need] ?? need}
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">
                A Tac-On can never show somebody more than they could already see. These are the
                parts of Eagle Bot it looks at, for whoever is looking at it.
              </p>
              {manifest.uses.length > 0 && (
                <p className="mt-2 text-sm text-gray-600">
                  Reads other Tac-Ons:{" "}
                  {manifest.uses.map((use) => (
                    <Link key={use.slug} href={`/tacons/${use.slug}`} className="text-brand-600 underline">
                      {use.slug}
                    </Link>
                  ))}
                </p>
              )}
            </div>
          )}

          <div className="card-pad">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">Source</h2>
              <button onClick={() => setShowSource((open) => !open)} className="btn-ghost btn-sm">
                {showSource ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showSource ? "Hide" : "Read it"}
              </button>
            </div>
            <p className="hint">
              Every Tac-On is readable. This is how most people learn to write one.
            </p>
            {showSource && (
              <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
                {source}
              </pre>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Installs" value={tacon.installCount} />
            <Stat label="Versions" value={versions.length} />
          </div>

          <div className="card-pad">
            <h2 className="font-semibold text-gray-900">Installed here</h2>
            {installs.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">Not installed in this academy yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {installs.map((install) => (
                  <li key={install.id} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800">
                        {install.studioName ?? "Whole academy"}
                      </span>
                      <Chip tone={install.enabled ? "green" : "neutral"}>
                        {install.enabled ? "on" : "off"}
                      </Chip>
                    </div>
                    {install.updateAvailable && (
                      <p className="mt-1.5 text-xs text-amber-700">
                        A newer version is published.
                      </p>
                    )}
                    {can("tacons.install") && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {install.updateAvailable && (
                          <button
                            onClick={() => update.mutate(install.id)}
                            className="btn-secondary btn-sm"
                            disabled={update.isPending}
                          >
                            Update
                          </button>
                        )}
                        <button
                          onClick={() =>
                            toggle.mutate({ installId: install.id, enabled: !install.enabled })
                          }
                          className="btn-secondary btn-sm"
                        >
                          {install.enabled ? "Turn off" : "Turn on"}
                        </button>
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                "Removing this Tac-On also deletes everything it has recorded here. That can't be undone. Remove it?",
                              )
                            ) {
                              uninstall.mutate(install.id);
                            }
                          }}
                          className="btn-danger btn-sm"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-pad">
            <h2 className="font-semibold text-gray-900">History</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {versions.map((version) => (
                <li key={version.id}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-800">{version.version}</span>
                    <span className="text-xs text-gray-500">{formatDate(version.createdAt)}</span>
                  </div>
                  {version.changelog && (
                    <p className="text-xs text-gray-500">{version.changelog}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {installing && manifest && (
        <InstallModal
          slug={tacon.slug}
          name={tacon.name}
          manifest={manifest}
          onClose={() => setInstalling(false)}
          onDone={() => {
            setInstalling(false);
            void queryClient.invalidateQueries({ queryKey: ["tacon-detail", slug] });
            void queryClient.invalidateQueries({ queryKey: ["tacon-nav"] });
            void queryClient.invalidateQueries({ queryKey: ["tacon-market"] });
          }}
        />
      )}
    </>
  );
}

function InstallModal({
  slug,
  name,
  manifest,
  onClose,
  onDone,
}: {
  slug: string;
  name: string;
  manifest: Manifest;
  onClose: () => void;
  onDone: () => void;
}) {
  const { studioId: viewingStudioId } = useSession();
  const [target, setTarget] = useState<number | null | undefined>(
    viewingStudioId === null ? undefined : viewingStudioId,
  );
  const [settings, setSettings] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(manifest.settings.map((setting) => [setting.name, setting.default])),
  );
  const [error, setError] = useState<string | null>(null);

  const install = useMutation({
    mutationFn: () =>
      apiPost(`/tacons/market/${slug}/install`, {
        ...(target === undefined ? {} : { studioId: target }),
        settings,
      }),
    onSuccess: onDone,
    onError: (installError: Error) => setError(installError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Install ${name}`}
      description="It appears for everyone in the studio you pick."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => install.mutate()}
            disabled={install.isPending || target === undefined}
            className="btn-primary"
          >
            {install.isPending && <Spinner />} Install
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}

        {manifest.needs.length > 0 && (
          <Banner tone="warning" title="This Tac-On reads">
            <ul className="mt-1 list-disc pl-4">
              {manifest.needs.map((need) => (
                <li key={need}>{NEEDS_WORDS[need] ?? need}</li>
              ))}
            </ul>
          </Banner>
        )}

        <StudioPicker
          value={target}
          onChange={setTarget}
          label="Install for"
          hint="Academy-wide puts it in every studio's sidebar."
        />

        {manifest.settings.map((setting) => (
          <div key={setting.name}>
            <label className="label" htmlFor={`setting-${setting.name}`}>
              {setting.label}
            </label>
            {setting.type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  id={`setting-${setting.name}`}
                  type="checkbox"
                  checked={settings[setting.name] === true}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, [setting.name]: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-gray-300 text-brand-600"
                />
                Yes
              </label>
            ) : setting.type === "choice" ? (
              <select
                id={`setting-${setting.name}`}
                className="input"
                value={String(settings[setting.name] ?? "")}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, [setting.name]: event.target.value }))
                }
              >
                {setting.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`setting-${setting.name}`}
                className="input"
                type={setting.type === "number" ? "number" : "text"}
                value={String(settings[setting.name] ?? "")}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    [setting.name]:
                      setting.type === "number" ? Number(event.target.value) : event.target.value,
                  }))
                }
              />
            )}
            {setting.hint && <p className="hint">{setting.hint}</p>}
          </div>
        ))}
      </div>
    </Modal>
  );
}
