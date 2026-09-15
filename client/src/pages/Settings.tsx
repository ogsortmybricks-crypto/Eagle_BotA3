import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  Bot,
  Building2,
  Eye,
  Gavel,
  KeyRound,
  Layers,
  Lock,
  Monitor,
  Palette as PaletteIcon,
  Plus,
  RotateCcw,
  Save,
  Scale,
  Vote,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, fileToDataUrl } from "@/lib/api";
import { applyPalette, useSession, type Palette as PaletteType } from "@/lib/session";
import { Banner, Chip, LoadingPage, Modal, PageHeader, Spinner } from "@/components/ui";
import {
  FieldRow,
  NumberInput,
  SelectInput,
  SettingCard,
  ToggleRow,
} from "@/components/SettingControls";
import type { AcademySettings, StudioOverrides } from "@shared/settings";

const TABS = [
  { id: "academy", label: "Academy", icon: Building2, admin: true },
  { id: "studios", label: "Studios", icon: Layers, admin: true },
  { id: "governance", label: "Governance", icon: Scale, admin: true },
  { id: "elections", label: "Elections", icon: Vote, admin: true },
  { id: "townhall", label: "Town Hall", icon: Gavel, admin: true },
  { id: "ai", label: "AI", icon: Bot, admin: true },
  { id: "notifications", label: "Notifications", icon: Bell, admin: true },
  { id: "access", label: "Access", icon: Lock, admin: true },
  { id: "display", label: "Display", icon: Monitor, admin: true },
  { id: "account", label: "My account", icon: KeyRound, admin: false },
] as const;

type TabId = (typeof TABS)[number]["id"];

type ServerInfo = {
  aiConfigured: boolean;
  emailConfigured: boolean;
  model: string;
  appUrl: string;
};

export function Settings() {
  const { can } = useSession();
  const isAdmin = can("settings.manage");
  const [tab, setTab] = useState<TabId>(isAdmin ? "academy" : "account");

  const info = useQuery<{ server: ServerInfo }>({
    queryKey: ["settings-info"],
    queryFn: () => apiGet("/settings"),
  });

  const visible = TABS.filter((entry) => !entry.admin || isAdmin);
  const server = info.data?.server;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          isAdmin
            ? "How Eagle Bot behaves for this academy and each of its studios."
            : "Your account."
        }
      />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200">
        {visible.map((entry) => (
          <button
            key={entry.id}
            onClick={() => setTab(entry.id)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${
              tab === entry.id
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <entry.icon className="h-4 w-4" /> {entry.label}
          </button>
        ))}
      </div>

      <div className="max-w-3xl">
        {tab === "academy" && <AcademyTab />}
        {tab === "studios" && <StudiosTab />}
        {tab === "governance" && <GovernanceTab />}
        {tab === "elections" && <ElectionsTab />}
        {tab === "townhall" && <TownHallTab />}
        {tab === "ai" && <AiTab server={server} />}
        {tab === "notifications" && <NotificationsTab server={server} />}
        {tab === "access" && <AccessTab />}
        {tab === "display" && <DisplayTab />}
        {tab === "account" && <AccountTab />}
      </div>
    </>
  );
}

/* -------------------------- section save plumbing -------------------------- */

type Section = keyof AcademySettings;

/**
 * One editable settings section.
 *
 * Each section saves on its own so two admins in different tabs can't clobber
 * each other's work - the PATCH is a deep partial and only touches what this
 * form owns.
 */
function useSectionDraft<S extends Section>(section: S) {
  const { settings, refresh } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AcademySettings[S]>(settings[section]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(settings[section]);
  }, [settings, section]);

  const save = useMutation({
    mutationFn: () => apiPatch("/settings", { [section]: draft }),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries();
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  const reset = useMutation({
    mutationFn: () => apiPost(`/settings/reset/${section}`),
    onSuccess: async () => {
      await refresh();
      await queryClient.invalidateQueries();
    },
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings[section]);

  function set<K extends keyof AcademySettings[S]>(key: K, value: AcademySettings[S][K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const footer = (
    <>
      {saved && <span className="mr-auto text-sm text-emerald-600">Saved.</span>}
      {!saved && dirty && <span className="mr-auto text-sm text-amber-600">Unsaved changes.</span>}
      <button
        onClick={() => reset.mutate()}
        disabled={reset.isPending}
        className="btn-ghost btn-sm"
        title="Put this section back to the shipped defaults"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Defaults
      </button>
      <button
        onClick={() => save.mutate()}
        disabled={save.isPending || !dirty}
        className="btn-primary btn-sm"
      >
        {save.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
        Save
      </button>
    </>
  );

  return { draft, set, footer, error };
}

/* --------------------------------- academy --------------------------------- */

const PALETTES: { name: string; palette: PaletteType }[] = [
  { name: "Sky", palette: { primary: "#0284c7", accent: "#f97316", surface: "#f8fafc" } },
  { name: "Forest", palette: { primary: "#15803d", accent: "#ca8a04", surface: "#f7faf7" } },
  { name: "Ember", palette: { primary: "#b91c1c", accent: "#0891b2", surface: "#fbf8f7" } },
  { name: "Ink", palette: { primary: "#1e293b", accent: "#d97706", surface: "#f8fafc" } },
  { name: "Violet", palette: { primary: "#6d28d9", accent: "#059669", surface: "#faf9fd" } },
  { name: "Clay", palette: { primary: "#9a3412", accent: "#0f766e", surface: "#fcf9f6" } },
];

function AcademyTab() {
  const { academy, refresh } = useSession();
  const [name, setName] = useState(academy?.name ?? "");
  const [learnerNoun, setLearnerNoun] = useState(academy?.learnerNoun ?? "Hero");
  const [logoUrl, setLogoUrl] = useState(academy?.logoUrl ?? null);
  const [palette, setPalette] = useState<PaletteType>(academy?.palette ?? PALETTES[0].palette);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => apiPatch("/admin/academy", { name, learnerNoun, logoUrl, palette }),
    onSuccess: async () => {
      applyPalette(palette);
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try {
      setLogoUrl(await fileToDataUrl(file, 500_000));
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Couldn't read that image.");
    }
  }

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}

      <SettingCard
        title="Identity"
        description="What this academy is called, and what it calls the people in it."
        footer={
          <>
            {saved && <span className="mr-auto text-sm text-emerald-600">Saved.</span>}
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="btn-primary btn-sm"
            >
              {save.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
          </>
        }
      >
        <FieldRow label="Academy name">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </FieldRow>
        <FieldRow
          label="What you call learners"
          hint="Used throughout the app. A studio can override this with its own word."
        >
          <input
            className="input"
            value={learnerNoun}
            onChange={(event) => setLearnerNoun(event.target.value)}
          />
        </FieldRow>
        <FieldRow
          label="Email domain"
          hint="Fixed at setup. Changing it would orphan everyone's account."
        >
          <div className="input bg-gray-50 text-gray-500">@{academy?.emailDomain}</div>
        </FieldRow>
      </SettingCard>

      <SettingCard title="Look" description="The academy's colours and logo.">
        <div className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900">
            <PaletteIcon className="h-4 w-4" /> Palette
          </div>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {PALETTES.map((option) => (
              <button
                key={option.name}
                type="button"
                onClick={() => {
                  setPalette(option.palette);
                  applyPalette(option.palette);
                }}
                className={`rounded-lg border-2 p-2.5 text-left transition ${
                  palette.primary === option.palette.primary
                    ? "border-gray-900"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="mb-1.5 flex gap-1">
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: option.palette.primary }}
                  />
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ background: option.palette.accent }}
                  />
                </div>
                <span className="text-[11px] font-medium text-gray-700">{option.name}</span>
              </button>
            ))}
          </div>
        </div>

        <FieldRow label="Logo" hint="Shown in the sidebar and on invite emails. Under 500KB." wide>
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                className="h-16 w-16 rounded-xl border border-gray-200 object-contain p-1"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-gray-300 text-xs text-gray-400">
                None
              </div>
            )}
            <div>
              <label className="btn-secondary btn-sm cursor-pointer">
                Choose image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => pickLogo(event.target.files?.[0])}
                />
              </label>
              {logoUrl && (
                <button onClick={() => setLogoUrl(null)} className="btn-ghost btn-sm ml-1">
                  Remove
                </button>
              )}
            </div>
          </div>
        </FieldRow>
      </SettingCard>
    </div>
  );
}

/* --------------------------------- studios --------------------------------- */

type StudioRow = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  ageRange: string | null;
  color: string;
  learnerNoun: string | null;
  simpleMode: boolean;
  orderIndex: number;
  archived: boolean;
  overrides: StudioOverrides;
  counts: { rules: number; members: number; positions: number; meetings: number };
};

const STUDIO_COLORS = [
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ef4444",
  "#0891b2",
  "#ec4899",
  "#64748b",
];

function StudiosTab() {
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const [editing, setEditing] = useState<StudioRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery<{
    studios: StudioRow[];
    shared: { rules: number; members: number; positions: number; meetings: number };
  }>({
    queryKey: ["studios"],
    queryFn: () => apiGet("/studios"),
  });

  const archive = useMutation({
    mutationFn: (id: number) => apiDelete<{ warnings: string[] }>(`/studios/${id}`),
    onSuccess: async (data) => {
      setNotice(data.warnings.length ? data.warnings.join(" ") : null);
      await queryClient.invalidateQueries({ queryKey: ["studios"] });
      await refresh();
    },
    onError: (archiveError: Error) => setNotice(archiveError.message),
  });

  if (query.isLoading) return <LoadingPage />;
  const studios = query.data?.studios ?? [];
  const shared = query.data?.shared;

  return (
    <div className="space-y-5">
      {notice && <Banner tone="warning">{notice}</Banner>}

      <Banner tone="info" title="Studios govern themselves">
        Rules, positions, Town Halls and elections all belong to exactly one studio. A studio can
        also <strong>share</strong> a particular section or position with specific other studios —
        a Hero Bucks system Middle and Launchpad run together, say — which you arrange on the Wiki
        and Positions pages. Anything filed academy-wide shows up everywhere, so use that sparingly.
      </Banner>

      <div className="flex flex-wrap justify-end gap-2">
        <PreviewSimpleButton />
        <button onClick={() => setCreating(true)} className="btn-primary btn-sm">
          <Plus className="h-3.5 w-3.5" /> Add a studio
        </button>
      </div>

      <div className="space-y-3">
        {studios.map((studio) => (
          <div key={studio.id} className="card p-4">
            <div className="flex items-start gap-3">
              <span
                className="mt-1 h-8 w-8 shrink-0 rounded-lg"
                style={{ background: studio.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-gray-900">{studio.name}</h3>
                  {studio.ageRange && <Chip>{studio.ageRange}</Chip>}
                  {studio.learnerNoun && <Chip tone="purple">{studio.learnerNoun}s</Chip>}
                  {studio.simpleMode && <Chip tone="amber">Simple view</Chip>}
                </div>
                {studio.description && (
                  <p className="mt-1 text-sm text-gray-600">{studio.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>{studio.counts.members} people</span>
                  <span>{studio.counts.rules} rules</span>
                  <span>{studio.counts.positions} positions</span>
                  <span>{studio.counts.meetings} Town Halls</span>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => setEditing(studio)} className="btn-secondary btn-sm">
                  Edit
                </button>
                <button
                  onClick={() => archive.mutate(studio.id)}
                  disabled={archive.isPending}
                  className="btn-ghost btn-sm text-gray-400 hover:text-red-600"
                  title="Archive this studio"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {shared && (
        <div className="card border-dashed p-4">
          <div className="flex items-start gap-3">
            <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300">
              <Layers className="h-4 w-4 text-gray-400" />
            </span>
            <div>
              <h3 className="font-semibold text-gray-900">Academy-wide</h3>
              <p className="mt-1 text-sm text-gray-600">
                Not a studio. Anything filed here appears inside every studio's view.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>{shared.members} people with no studio</span>
                <span>{shared.rules} shared rules</span>
                <span>{shared.positions} shared positions</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {(creating || editing) && (
        <StudioModal
          studio={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Lets an admin look at the app the way a Spark learner does.
 *
 * Reversible and session-only. A mode designed for six-year-olds is very hard
 * to judge from a checkbox, so it's worth being able to actually see it.
 */
function PreviewSimpleButton() {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => apiPost("/auth/preview-simple", { enabled: true }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      window.location.href = "/wiki";
    },
  });

  return (
    <button
      onClick={() => start.mutate()}
      disabled={start.isPending}
      className="btn-secondary btn-sm"
      title="See what a learner in a simple-view studio sees"
    >
      {start.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      Preview the simple view
    </button>
  );
}

function StudioModal({ studio, onClose }: { studio: StudioRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { refresh, settings } = useSession();
  const [name, setName] = useState(studio?.name ?? "");
  const [description, setDescription] = useState(studio?.description ?? "");
  const [ageRange, setAgeRange] = useState(studio?.ageRange ?? "");
  const [color, setColor] = useState(studio?.color ?? STUDIO_COLORS[2]);
  const [learnerNoun, setLearnerNoun] = useState(studio?.learnerNoun ?? "");
  const [simpleMode, setSimpleMode] = useState(studio?.simpleMode ?? false);
  const [overrides, setOverrides] = useState<StudioOverrides>(
    studio?.overrides ?? {
      guidesCanVote: "inherit",
      selfNomination: "inherit",
      quorumMode: "inherit",
      quorumFixed: 10,
      electionDurationDays: 0,
      aiGuidance: "",
    },
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        ageRange: ageRange.trim() || null,
        color,
        learnerNoun: learnerNoun.trim() || null,
        simpleMode,
        settings: overrides,
      };
      return studio ? apiPatch(`/studios/${studio.id}`, body) : apiPost("/studios", body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["studios"] });
      await refresh();
      onClose();
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  const triOptions = (inheritLabel: string) => [
    { value: "inherit" as const, label: `Inherit — ${inheritLabel}` },
    { value: "yes" as const, label: "Yes" },
    { value: "no" as const, label: "No" },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={studio ? `Edit ${studio.name}` : "Add a studio"}
      description="The description is read by the AI when it writes this studio's wiki, so make it specific."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || name.trim().length < 2}
            className="btn-primary"
          >
            {save.isPending && <Spinner />} Save
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}

        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <div>
            <label className="label" htmlFor="studio-name">
              Name
            </label>
            <input
              id="studio-name"
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Middle Studio"
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="studio-ages">
              Ages
            </label>
            <input
              id="studio-ages"
              className="input"
              value={ageRange}
              onChange={(event) => setAgeRange(event.target.value)}
              placeholder="11-14"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="studio-desc">
            What this studio is
          </label>
          <textarea
            id="studio-desc"
            className="input min-h-[80px]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Quests, Exhibitions and apprenticeships. Governance is run entirely by the learners, and the Contract is long."
          />
          <p className="hint">
            The AI uses this to pitch the studio's rules at the right level. Mention the age group
            and anything unusual about how this studio governs itself.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="label">Colour</span>
            <div className="flex flex-wrap gap-1.5">
              {STUDIO_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setColor(option)}
                  aria-label={`Colour ${option}`}
                  className={`h-7 w-7 rounded-full transition ${
                    color === option ? "ring-2 ring-gray-900 ring-offset-2" : "hover:scale-110"
                  }`}
                  style={{ background: option }}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="studio-noun">
              What this studio calls its learners
            </label>
            <input
              id="studio-noun"
              className="input"
              value={learnerNoun}
              onChange={(event) => setLearnerNoun(event.target.value)}
              placeholder="Leave blank to inherit"
            />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200">
          <ToggleRow
            label="Use the simple view in this studio"
            hint="Three big screens — our rules, voting, jobs — in large type, with the provenance trail and editing tools taken away. Applies to the learners in this studio; guides and admins keep the full app because they're the ones who fix things."
            checked={simpleMode}
            onChange={setSimpleMode}
          />
        </div>

        <div className="rounded-lg border border-gray-200">
          <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-gray-900">Overrides for this studio</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Leave everything on Inherit unless this studio genuinely runs differently.
            </p>
          </div>
          <div className="divide-y divide-gray-100">
            <FieldRow label="Guides can vote" hint="Adults casting ballots in this studio.">
              <SelectInput
                value={overrides.guidesCanVote}
                onChange={(value) => setOverrides((c) => ({ ...c, guidesCanVote: value }))}
                options={triOptions(settings.governance.guidesCanVote ? "yes" : "no")}
              />
            </FieldRow>
            <FieldRow label="Self-nomination" hint="Whether learners can put their own name forward.">
              <SelectInput
                value={overrides.selfNomination}
                onChange={(value) => setOverrides((c) => ({ ...c, selfNomination: value }))}
                options={triOptions(settings.elections.selfNominationDefault ? "yes" : "no")}
              />
            </FieldRow>
            <FieldRow label="Town Hall quorum" hint="How many have to be present to decide anything.">
              <SelectInput
                value={overrides.quorumMode}
                onChange={(value) => setOverrides((c) => ({ ...c, quorumMode: value }))}
                options={[
                  { value: "inherit", label: `Inherit — ${settings.townHall.quorumMode}` },
                  { value: "none", label: "No quorum rule" },
                  { value: "majority", label: "Simple majority" },
                  { value: "two_thirds", label: "Two thirds" },
                  { value: "fixed", label: "A fixed number" },
                ]}
              />
            </FieldRow>
            {overrides.quorumMode === "fixed" && (
              <FieldRow label="People needed">
                <NumberInput
                  value={overrides.quorumFixed}
                  onChange={(value) => setOverrides((c) => ({ ...c, quorumFixed: value }))}
                  min={1}
                  max={500}
                  suffix="people"
                />
              </FieldRow>
            )}
            <FieldRow
              label="Default voting window"
              hint="0 inherits the academy's default."
            >
              <NumberInput
                value={overrides.electionDurationDays}
                onChange={(value) => setOverrides((c) => ({ ...c, electionDurationDays: value }))}
                min={0}
                max={60}
                suffix="days"
              />
            </FieldRow>
            <FieldRow label="Extra AI guidance for this studio" wide>
              <textarea
                className="input min-h-[70px] text-[13px]"
                value={overrides.aiGuidance}
                onChange={(event) =>
                  setOverrides((c) => ({ ...c, aiGuidance: event.target.value }))
                }
                placeholder="e.g. This studio's Contract is read aloud at Launch, so keep every rule to one sentence."
              />
            </FieldRow>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- governance -------------------------------- */

function GovernanceTab() {
  const { draft, set, footer, error } = useSectionDraft("governance");
  const { learnerNoun } = useSession();

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      <SettingCard
        title="Who decides what"
        description="The Acton default is that adults observe and learners govern. Change these only if your academy genuinely works differently."
        footer={footer}
      >
        <ToggleRow
          label="Guides can vote in elections"
          hint="Off keeps the ballot box with the learners. A studio can override this for itself."
          checked={draft.guidesCanVote}
          onChange={(value) => set("guidesCanVote", value)}
        />
        <ToggleRow
          label="Admins can vote in every studio"
          hint="For small academies where the same few people really are in every room. Otherwise an admin only votes in their own studio."
          checked={draft.adminsVoteInAllStudios}
          onChange={(value) => set("adminsVoteInAllStudios", value)}
        />
        <ToggleRow
          label={`${learnerNoun}s can edit the wiki directly`}
          hint="Off means rules change through a Town Hall or an admin. On is faster but loses the provenance trail."
          checked={draft.learnersCanEditWiki}
          onChange={(value) => set("learnersCanEditWiki", value)}
        />
        <ToggleRow
          label="Secretaries can run elections"
          hint="On lets a secretary create, open and certify votes. Off restricts that to admins."
          checked={draft.secretariesCanManageElections}
          onChange={(value) => set("secretariesCanManageElections", value)}
        />
        <ToggleRow
          label="Every wiki edit needs a reason"
          hint="Blocks saving a rule change without saying why. The history is what makes the wiki trustworthy a year later."
          checked={draft.requireRationaleOnEdits}
          onChange={(value) => set("requireRationaleOnEdits", value)}
        />
      </SettingCard>

      <SettingCard
        title="Crossing between studios"
        description="Who can see, and stand for, a studio that isn't theirs."
        footer={footer}
      >
        <ToggleRow
          label="Guides see every studio"
          hint="On by default — an adult who can't read the Spark studio's rules can't help anybody."
          checked={draft.guidesSeeAllStudios}
          onChange={(value) => set("guidesSeeAllStudios", value)}
        />
        <ToggleRow
          label={`${learnerNoun}s see every studio`}
          hint="Off by default. Another studio's governance is genuinely not their business, and it saves a lot of confusion."
          checked={draft.learnersSeeAllStudios}
          onChange={(value) => set("learnersSeeAllStudios", value)}
        />
        <ToggleRow
          label="Positions are restricted to their studio"
          hint="On stops someone from Launchpad holding a Middle Studio seat. Turn it off only if roles genuinely span studios."
          checked={draft.restrictCandidatesToStudio}
          onChange={(value) => set("restrictCandidatesToStudio", value)}
        />
      </SettingCard>
    </div>
  );
}

/* -------------------------------- elections -------------------------------- */

function ElectionsTab() {
  const { draft, set, footer, error } = useSectionDraft("elections");

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      <SettingCard title="How votes run" footer={footer}>
        <FieldRow
          label="Default voting window"
          hint="Prefills the closing date on a new election. A studio can set its own."
        >
          <NumberInput
            value={draft.defaultDurationDays}
            onChange={(value) => set("defaultDurationDays", value)}
            min={1}
            max={60}
            suffix="days"
          />
        </FieldRow>
        <FieldRow
          label="Minimum options on a ballot"
          hint="A vote can't open until it has this many. Two is the honest floor."
        >
          <NumberInput
            value={draft.minOptions}
            onChange={(value) => set("minOptions", value)}
            min={2}
            max={10}
            suffix="options"
          />
        </FieldRow>
        <FieldRow
          label="Turnout needed to certify"
          hint="A result nobody turned out for isn't a mandate. 0 turns this off."
        >
          <NumberInput
            value={draft.quorumPercent}
            onChange={(value) => set("quorumPercent", value)}
            min={0}
            max={100}
            suffix="%"
          />
        </FieldRow>
        <ToggleRow
          label="Close votes automatically at the deadline"
          hint="A vote that says it closes Friday should stop accepting ballots on Friday."
          checked={draft.autoCloseOnDeadline}
          onChange={(value) => set("autoCloseOnDeadline", value)}
        />
      </SettingCard>

      <SettingCard title="Ballots" footer={footer}>
        <ToggleRow
          label="Self-nomination is on by default"
          hint="Learners can put their own name forward without asking. Each election can still be set individually."
          checked={draft.selfNominationDefault}
          onChange={(value) => set("selfNominationDefault", value)}
        />
        <ToggleRow
          label="Ballots are anonymous by default"
          hint="Nobody, including admins, can see which way a person voted. The activity log records that they voted, never how."
          checked={draft.anonymousDefault}
          onChange={(value) => set("anonymousDefault", value)}
        />
        <ToggleRow
          label="People can change their vote"
          hint="On lets someone update their ballot until voting closes. Off makes the first ballot final."
          checked={draft.allowVoteChanges}
          onChange={(value) => set("allowVoteChanges", value)}
        />
        <ToggleRow
          label="Show the tally while voting is open"
          hint="Off by default. A running count changes how later voters behave, which is usually not what a studio wants."
          checked={draft.showLiveTallies}
          onChange={(value) => set("showLiveTallies", value)}
        />
      </SettingCard>
    </div>
  );
}

/* -------------------------------- town hall -------------------------------- */

function TownHallTab() {
  const { draft, set, footer, error } = useSectionDraft("townHall");

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      <SettingCard title="Quorum" description="How many have to be present for a meeting to count." footer={footer}>
        <FieldRow label="Quorum rule">
          <SelectInput
            value={draft.quorumMode}
            onChange={(value) => set("quorumMode", value)}
            options={[
              { value: "two_thirds", label: "Two thirds present" },
              { value: "majority", label: "Simple majority" },
              { value: "fixed", label: "A fixed number" },
              { value: "none", label: "No quorum rule" },
            ]}
          />
        </FieldRow>
        {draft.quorumMode === "fixed" && (
          <FieldRow label="People needed">
            <NumberInput
              value={draft.quorumFixed}
              onChange={(value) => set("quorumFixed", value)}
              min={1}
              max={500}
              suffix="people"
            />
          </FieldRow>
        )}
        <ToggleRow
          label="Guides count toward quorum"
          hint="Off by default. Counting adults toward the quorum of a meeting they don't decide in inflates the bar learners have to clear."
          checked={draft.guidesCountTowardQuorum}
          onChange={(value) => set("guidesCountTowardQuorum", value)}
        />
        <ToggleRow
          label="Refuse to process a meeting that never had quorum"
          hint="A meeting without quorum didn't decide anything, so folding it into the wiki would record decisions the studio never legitimately made."
          checked={draft.requireQuorumToProcess}
          onChange={(value) => set("requireQuorumToProcess", value)}
        />
      </SettingCard>

      <SettingCard title="The workspace" footer={footer}>
        <FieldRow
          label="Default meeting title"
          hint="{date} and {studio} are filled in when a meeting starts."
        >
          <input
            className="input"
            value={draft.titleTemplate}
            onChange={(event) => set("titleTemplate", event.target.value)}
          />
        </FieldRow>
        <ToggleRow
          label="Carry open action items into the next meeting"
          hint="Nothing promised in a Town Hall quietly disappears. Items only carry within the same studio."
          checked={draft.carryOverActionItems}
          onChange={(value) => set("carryOverActionItems", value)}
        />
        <ToggleRow
          label="Lock the notes once the AI has processed them"
          hint="Stops the record drifting away from what the wiki says came out of it. An admin can still reprocess."
          checked={draft.lockAfterProcessing}
          onChange={(value) => set("lockAfterProcessing", value)}
        />
      </SettingCard>
    </div>
  );
}

/* ----------------------------------- AI ------------------------------------ */

function AiTab({ server }: { server?: ServerInfo }) {
  const { draft, set, footer, error } = useSectionDraft("ai");

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      {server && !server.aiConfigured && (
        <Banner tone="warning" title="No API key on the server">
          <code>ANTHROPIC_API_KEY</code> isn't set, so nothing here takes effect until it is.
        </Banner>
      )}

      <SettingCard
        title="What the AI is allowed to do"
        description="Every AI change is logged with a reason and can be undone in one click, whatever these say."
        footer={footer}
      >
        <ToggleRow
          label="AI features are on"
          hint="Off disables building the wiki and processing Town Hall notes. Everything else keeps working."
          checked={draft.enabled}
          onChange={(value) => set("enabled", value)}
        />
        <ToggleRow
          label="Repeal rules a decision contradicts"
          hint="On is the whole point of the tool — it strikes out what a Town Hall overrode. Off makes it raise a contradiction for a human instead."
          checked={draft.autoRepealContradictions}
          onChange={(value) => set("autoRepealContradictions", value)}
          disabled={!draft.enabled}
        />
        <ToggleRow
          label="Propose elections from Town Hall notes"
          hint="The AI never creates one on its own — it suggests, and someone approves. Off stops it suggesting."
          checked={draft.proposeElections}
          onChange={(value) => set("proposeElections", value)}
          disabled={!draft.enabled}
        />
        <ToggleRow
          label="Detect elected positions"
          hint="Pulls roles out of documents and meeting notes into the Positions tab."
          checked={draft.detectPositions}
          onChange={(value) => set("detectPositions", value)}
          disabled={!draft.enabled}
        />
      </SettingCard>

      <SettingCard title="How hard it thinks" footer={footer}>
        <FieldRow
          label="Reasoning effort"
          hint="Higher catches more contradictions and costs more. High is right for governance documents."
        >
          <SelectInput
            value={draft.effort}
            onChange={(value) => set("effort", value)}
            options={[
              { value: "low", label: "Low — fast and cheap" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High (recommended)" },
              { value: "xhigh", label: "Extra high" },
              { value: "max", label: "Maximum" },
            ]}
          />
        </FieldRow>
        <FieldRow
          label="Output budget"
          hint="A first wiki build from a pile of documents needs room. If a run reports that Claude ran out of space, raise this."
        >
          <NumberInput
            value={draft.maxOutputTokens}
            onChange={(value) => set("maxOutputTokens", value)}
            min={4000}
            max={64000}
            suffix="tokens"
          />
        </FieldRow>
        {server && (
          <FieldRow label="Model" hint="Set on the server with ANTHROPIC_MODEL.">
            <div className="input bg-gray-50 font-mono text-xs text-gray-500">{server.model}</div>
          </FieldRow>
        )}
      </SettingCard>

      <SettingCard
        title="House rules"
        description="Added to every prompt, on top of the academy-wide Acton guidance. Studios can add their own on top of this."
        footer={footer}
      >
        <FieldRow label="Extra guidance" wide>
          <textarea
            className="input min-h-[120px] text-[13px]"
            value={draft.extraGuidance}
            onChange={(event) => set("extraGuidance", event.target.value)}
            placeholder={`e.g. We say "Eagle Buck", not "Hero Buck".\nOur Contract is renegotiated every session, so prefer the most recent Town Hall over anything older.\nNever fold appeals into the consequences section — they have their own.`}
          />
          <p className="hint">
            This can't loosen the rules that matter: the AI still won't invent a rule or quietly
            resolve a contradiction, whatever you write here.
          </p>
        </FieldRow>
      </SettingCard>
    </div>
  );
}

/* ------------------------------ notifications ------------------------------ */

function NotificationsTab({ server }: { server?: ServerInfo }) {
  const { draft, set, footer, error } = useSectionDraft("notifications");

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      {server && !server.emailConfigured && (
        <Banner tone="info" title="Email isn't configured">
          Set <code>SMTP_USER</code> and <code>SMTP_PASS</code> (a Google App Password) on the
          server. Until then invites still work — you get a link to pass along yourself.
        </Banner>
      )}

      <SettingCard
        title="What gets emailed"
        description="Mail only ever goes to the studio concerned, never the whole academy."
        footer={footer}
      >
        <ToggleRow
          label="When a vote opens"
          hint="Everyone eligible to vote in that particular ballot gets a link."
          checked={draft.emailOnElectionOpen}
          onChange={(value) => set("emailOnElectionOpen", value)}
        />
        <ToggleRow
          label="When a result is certified"
          hint="Who won, and by how much."
          checked={draft.emailOnElectionCertified}
          onChange={(value) => set("emailOnElectionCertified", value)}
        />
        <ToggleRow
          label="When a Town Hall lands in the wiki"
          hint="Tells the studio its rules just moved, with a summary of what changed."
          checked={draft.emailOnMeetingProcessed}
          onChange={(value) => set("emailOnMeetingProcessed", value)}
        />
      </SettingCard>

      <SettingCard title="Invites" footer={footer}>
        <FieldRow
          label="Invites expire after"
          hint="An unused link stops working. Shorter is safer; longer is kinder to families."
        >
          <NumberInput
            value={draft.inviteExpiryDays}
            onChange={(value) => set("inviteExpiryDays", value)}
            min={1}
            max={90}
            suffix="days"
          />
        </FieldRow>
      </SettingCard>
    </div>
  );
}

/* --------------------------------- access ---------------------------------- */

function AccessTab() {
  const { draft, set, footer, error } = useSectionDraft("access");

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      <SettingCard title="Accounts" footer={footer}>
        <FieldRow
          label="Minimum password length"
          hint="Applies to new accounts and password changes. Existing passwords aren't affected."
        >
          <NumberInput
            value={draft.minPasswordLength}
            onChange={(value) => set("minPasswordLength", value)}
            min={8}
            max={64}
            suffix="characters"
          />
        </FieldRow>
        <FieldRow label="Invites default to" hint="What the role dropdown starts on.">
          <SelectInput
            value={draft.defaultInviteRole}
            onChange={(value) => set("defaultInviteRole", value)}
            options={[
              { value: "learner", label: "Learner" },
              { value: "secretary", label: "Secretary" },
              { value: "guide", label: "Guide" },
              { value: "admin", label: "Admin" },
            ]}
          />
        </FieldRow>
      </SettingCard>

      <SettingCard title="Privacy" footer={footer}>
        <ToggleRow
          label="People can edit their own profile"
          hint="Off means only admins change names, photos and bios. Worth it in a younger studio."
          checked={draft.allowProfileEditing}
          onChange={(value) => set("allowProfileEditing", value)}
        />
        <ToggleRow
          label="Show email addresses in the directory"
          hint="Off by default. Everyone can still see who's who, just not their address."
          checked={draft.showEmailsInDirectory}
          onChange={(value) => set("showEmailsInDirectory", value)}
        />
      </SettingCard>
    </div>
  );
}

/* --------------------------------- display --------------------------------- */

function DisplayTab() {
  const { draft, set, footer, error } = useSectionDraft("display");

  return (
    <div className="space-y-5">
      {error && <Banner tone="error">{error}</Banner>}
      <SettingCard
        title="How the app reads"
        description="Applies to everyone in the academy."
        footer={footer}
      >
        <FieldRow label="Date format" hint="An academy with families in two countries cares about this.">
          <SelectInput
            value={draft.dateFormat}
            onChange={(value) => set("dateFormat", value)}
            options={[
              { value: "local", label: "Follow the browser" },
              { value: "iso", label: "2026-03-04" },
              { value: "us", label: "03/04/2026" },
              { value: "uk", label: "04/03/2026" },
            ]}
          />
        </FieldRow>
        <FieldRow label="Opening page" hint="Where signing in lands you.">
          <SelectInput
            value={draft.startPage}
            onChange={(value) => set("startPage", value)}
            options={[
              { value: "wiki", label: "Wiki" },
              { value: "town-hall", label: "Town Hall" },
              { value: "elections", label: "Elections" },
              { value: "positions", label: "Positions" },
              { value: "people", label: "People" },
            ]}
          />
        </FieldRow>
        <FieldRow label="Density" hint="Compact fits more on a Chromebook screen.">
          <SelectInput
            value={draft.density}
            onChange={(value) => set("density", value)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </FieldRow>
      </SettingCard>
    </div>
  );
}

/* -------------------------------- account ---------------------------------- */

function AccountTab() {
  const { user, academy, studio, settings, learnerNoun } = useSession();
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <div className="space-y-5">
      <SettingCard title="You" description="Your profile lives on the People page.">
        <FieldRow label="Name">
          <div className="input bg-gray-50 text-gray-600">{user?.name}</div>
        </FieldRow>
        <FieldRow label="Email">
          <div className="input bg-gray-50 text-gray-600">{user?.email}</div>
        </FieldRow>
        <FieldRow label="Role">
          <div className="input bg-gray-50 text-gray-600">{user?.role}</div>
        </FieldRow>
        <FieldRow
          label="Studio"
          hint="Only an admin can move you — it changes what you can vote on."
        >
          <div className="input bg-gray-50 text-gray-600">
            {studio?.name ?? "Not in a studio"}
          </div>
        </FieldRow>
      </SettingCard>

      <SettingCard
        title="Security"
        description={`Passwords here need at least ${settings.access.minPasswordLength} characters.`}
        footer={
          <button onClick={() => setPasswordOpen(true)} className="btn-secondary btn-sm">
            <KeyRound className="h-3.5 w-3.5" /> Change my password
          </button>
        }
      >
        <div className="p-4 text-sm text-gray-500">
          You're signed in to {academy?.name}
          {studio ? ` as a ${learnerNoun === "Hero" ? "member" : learnerNoun} of ${studio.name}` : ""}.
        </div>
      </SettingCard>

      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const { settings } = useSession();
  const minimum = settings.access.minPasswordLength;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: () => apiPost("/auth/password", { current, next }),
    onSuccess: () => setDone(true),
    onError: (changeError: Error) => setError(changeError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Change your password"
      footer={
        done ? (
          <button onClick={onClose} className="btn-primary">
            Done
          </button>
        ) : (
          <>
            <button onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => change.mutate()}
              disabled={change.isPending || next.length < minimum}
              className="btn-primary"
            >
              {change.isPending && <Spinner />} Change it
            </button>
          </>
        )
      }
    >
      {done ? (
        <Banner tone="success">Password changed.</Banner>
      ) : (
        <div className="space-y-4">
          {error && <Banner tone="error">{error}</Banner>}
          <div>
            <label className="label" htmlFor="current-pw">
              Current password
            </label>
            <input
              id="current-pw"
              type="password"
              className="input"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="new-pw">
              New password
            </label>
            <input
              id="new-pw"
              type="password"
              className="input"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              placeholder={`At least ${minimum} characters`}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
