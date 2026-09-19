import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  FileText,
  History,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api";
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
  type ChipTone,
} from "@/components/ui";
import { StudioTag } from "@/components/StudioSwitcher";
import { StudioPicker } from "@/components/StudioPicker";
import { SharedWithNote, SharedWithPicker } from "@/components/SharedWithPicker";
import { JobProgress, useJob } from "@/components/JobStatus";
import { TaconPanels } from "@/pages/TaconPage";

type Rule = {
  id: number;
  sectionId: number;
  title: string;
  body: string;
  status: string;
  citation: string | null;
  sourceType: string;
  updatedAt: string;
};

type Section = {
  id: number;
  studioId: number | null;
  studioName: string | null;
  studioColor: string | null;
  shared: boolean;
  sharedStudioIds: number[];
  sharedWith: string[];
  title: string;
  slug: string;
  summary: string | null;
  rules: Rule[];
};

type Finding = {
  id: number;
  studioId: number | null;
  type: string;
  severity: string;
  title: string;
  description: string;
  options: string[];
  relatedRuleIds: number[];
  status: string;
};

type Doc = {
  id: number;
  filename: string;
  sizeBytes: number;
  status: string;
  studioId: number | null;
  createdAt: string;
  uploaderName: string | null;
  characters: number;
};

const SOURCE_LABEL: Record<string, string> = {
  document: "From uploaded docs",
  town_hall: "From a Town Hall",
  election: "From an election",
  manual: "Added by hand",
};

const FINDING_LABEL: Record<string, string> = {
  contradiction: "Contradiction",
  gap: "Gap",
  ambiguity: "Unclear",
  election_needed: "Needs a vote",
};

export function Wiki() {
  const { can, studio, studioId } = useSession();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [showRepealed, setShowRepealed] = useState(false);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creatingIn, setCreatingIn] = useState<Section | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [sharingSection, setSharingSection] = useState<Section | null>(null);
  const [historyFor, setHistoryFor] = useState<Rule | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wiki = useQuery<{
    sections: Section[];
    counts: { active: number; repealed: number; shared: number };
  }>({
    queryKey: ["wiki", showRepealed, studioId],
    queryFn: () => apiGet(`/wiki?includeRepealed=${showRepealed}`),
  });

  const findings = useQuery<{ findings: Finding[] }>({
    queryKey: ["findings", studioId],
    queryFn: () => apiGet("/wiki/findings?status=open"),
  });

  const jobQuery = useJob(jobId);
  const job = jobQuery.data?.job ?? null;

  // When a build finishes, pull the fresh wiki in.
  const lastStatus = useRef<string | null>(null);
  if (job && job.status !== lastStatus.current) {
    lastStatus.current = job.status;
    if (job.status === "succeeded" || job.status === "awaiting_input") {
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      void queryClient.invalidateQueries({ queryKey: ["findings"] });
    }
  }

  const build = useMutation({
    mutationFn: () => apiPost<{ jobId: number }>("/wiki/build", { studioId }),
    onSuccess: (data) => {
      setJobId(data.jobId);
      setError(null);
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const sections = wiki.data?.sections ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return sections;
    return sections
      .map((section) => ({
        ...section,
        rules: section.rules.filter(
          (rule) =>
            rule.title.toLowerCase().includes(needle) || rule.body.toLowerCase().includes(needle),
        ),
      }))
      .filter(
        (section) => section.rules.length > 0 || section.title.toLowerCase().includes(needle),
      );
  }, [sections, search]);

  const visible = activeSection
    ? filtered.filter((section) => section.id === activeSection)
    : filtered;

  if (wiki.isLoading) return <LoadingPage label="Loading the wiki..." />;

  const isEmpty = sections.length === 0;
  const openFindings = findings.data?.findings ?? [];

  return (
    <>
      <PageHeader
        title={studio ? `${studio.name} — Wiki` : "Wiki"}
        subtitle={
          isEmpty
            ? studio
              ? `${studio.name}'s rules, once they're in here.`
              : "Each studio's rules, once they're in here."
            : `${wiki.data?.counts.active ?? 0} rules in force${
                wiki.data?.counts.repealed ? `, ${wiki.data.counts.repealed} repealed` : ""
              }${
                wiki.data?.counts.shared
                  ? ` · ${wiki.data.counts.shared} academy-wide section${wiki.data.counts.shared === 1 ? "" : "s"}`
                  : ""
              }.`
        }
      >
        {can("wiki.edit") && !isEmpty && (
          <button onClick={() => setAddingSection(true)} className="btn-secondary">
            <Plus className="h-4 w-4" /> Section
          </button>
        )}
        {can("documents.upload") && (
          <button onClick={() => setDocsOpen(true)} className="btn-secondary">
            <FileText className="h-4 w-4" /> Documents
          </button>
        )}
        {can("wiki.ai_build") && (
          <button
            onClick={() => build.mutate()}
            disabled={
              build.isPending ||
              studioId === null ||
              job?.status === "running" ||
              job?.status === "queued"
            }
            title={
              studioId === null
                ? "Pick a studio first — the AI builds one studio's wiki at a time."
                : undefined
            }
            className="btn-primary"
          >
            {build.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />}
            {isEmpty ? "Build the wiki" : "Re-read documents"}
          </button>
        )}
      </PageHeader>

      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        {studioId === null && can("wiki.ai_build") && (
          <Banner tone="info" title="You're looking at every studio at once">
            Rules from each studio are shown together, tagged with where they came from. Switch to
            a single studio to build or rebuild its wiki — the AI works on one Contract at a time,
            which is what keeps Spark's rules out of Launchpad's.
          </Banner>
        )}
        {job && <JobProgress job={job} />}

        {openFindings.length > 0 && <FindingsPanel findings={openFindings} />}

        {isEmpty ? (
          <EmptyState
            icon={BookOpen}
            title={studio ? `${studio.name} has no rules recorded yet` : "Nothing in the wiki yet"}
            action={
              can("documents.upload") ? (
                <button onClick={() => setDocsOpen(true)} className="btn-primary">
                  <Upload className="h-4 w-4" /> Upload {studio ? `${studio.name}'s` : "your"}{" "}
                  documents
                </button>
              ) : undefined
            }
          >
            Upload {studio ? `${studio.name}'s` : "the studio's"} existing rule documents — the
            Google Docs, the Contract, the ROE — and Claude will read them, organize them into one
            wiki, and tell you where they contradict each other. Each studio's documents are read
            separately, so nothing bleeds between them.
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-5 lg:flex-row">
            {/* Section rail */}
            <aside className="lg:w-56 lg:shrink-0">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  className="input pl-9"
                  placeholder="Search rules"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <nav className="space-y-0.5">
                <button
                  onClick={() => setActiveSection(null)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm ${
                    activeSection === null
                      ? "bg-brand-50 font-medium text-brand-700"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Everything
                </button>
                {filtered.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm ${
                      activeSection === section.id
                        ? "bg-brand-50 font-medium text-brand-700"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    {/* A dot for the owning studio, so a mixed list stays legible. */}
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        section.shared ? "ring-1 ring-gray-300" : ""
                      }`}
                      style={{ background: section.studioColor ?? "transparent" }}
                    />
                    <span className="min-w-0 flex-1 truncate">{section.title}</span>
                    <span className="shrink-0 text-xs text-gray-400">{section.rules.length}</span>
                  </button>
                ))}
              </nav>
              <label className="mt-4 flex cursor-pointer items-center gap-2 px-3 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={showRepealed}
                  onChange={(event) => setShowRepealed(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600"
                />
                Show repealed rules
              </label>
            </aside>

            {/* Rules */}
            <div className="min-w-0 flex-1 space-y-5">
              {visible.length === 0 && (
                <div className="card px-6 py-10 text-center text-sm text-gray-500">
                  Nothing matches "{search}".
                </div>
              )}
              {visible.map((section) => (
                <section key={section.id} className="card">
                  <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-gray-900">{section.title}</h2>
                        {/* Only worth saying when more than one studio is in view. */}
                        {(studioId === null || section.shared) && (
                          <StudioTag
                            name={section.studioName}
                            color={section.studioColor}
                            shared={section.shared}
                          />
                        )}
                        <SharedWithNote names={section.sharedWith} />
                      </div>
                      {section.summary && (
                        <p className="mt-0.5 text-sm text-gray-500">{section.summary}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      {can("academy.manage") && (
                        <button
                          onClick={() => setSharingSection(section)}
                          className="btn-ghost btn-sm"
                          title="Which studios share this section"
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {can("wiki.edit") && (
                        <button
                          onClick={() => setCreatingIn(section)}
                          className="btn-ghost btn-sm"
                        >
                          <Plus className="h-3.5 w-3.5" /> Rule
                        </button>
                      )}
                    </div>
                  </div>

                  {section.rules.length === 0 ? (
                    <p className="p-5 text-sm text-gray-400">No rules in this section.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {section.rules.map((rule) => (
                        <li
                          key={rule.id}
                          className={`p-5 ${rule.status === "repealed" ? "bg-gray-50/70" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3
                                  className={`font-semibold ${
                                    rule.status === "repealed"
                                      ? "text-gray-400 line-through"
                                      : "text-gray-900"
                                  }`}
                                >
                                  {rule.title}
                                </h3>
                                {rule.status === "repealed" && <Chip tone="red">Repealed</Chip>}
                              </div>
                              <div
                                className={
                                  rule.status === "repealed" ? "mt-2 opacity-50" : "mt-2"
                                }
                              >
                                <Markdown>{rule.body}</Markdown>
                              </div>
                              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                                <span>{SOURCE_LABEL[rule.sourceType] ?? rule.sourceType}</span>
                                {rule.citation && (
                                  <span className="truncate">· {rule.citation}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-0.5">
                              <button
                                onClick={() => setHistoryFor(rule)}
                                className="btn-ghost p-1.5"
                                title="History"
                              >
                                <History className="h-3.5 w-3.5" />
                              </button>
                              {can("wiki.edit") && rule.status !== "repealed" && (
                                <button
                                  onClick={() => setEditing(rule)}
                                  className="btn-ghost p-1.5"
                                  title="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      <DocumentsModal open={docsOpen} onClose={() => setDocsOpen(false)} />
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
      {creatingIn && <RuleCreator section={creatingIn} onClose={() => setCreatingIn(null)} />}
      {addingSection && <SectionCreator onClose={() => setAddingSection(false)} />}
      {sharingSection && (
        <SectionSharing section={sharingSection} onClose={() => setSharingSection(null)} />
      )}
      {historyFor && <HistoryModal rule={historyFor} onClose={() => setHistoryFor(null)} />}
      <TaconPanels host="wiki" />
    </>
  );
}

/* ------------------------------- sections --------------------------------- */

function SectionCreator({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { studioId } = useSession();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [targetStudio, setTargetStudio] = useState<number | null | undefined>(
    studioId === null ? undefined : studioId,
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      apiPost("/wiki/sections", {
        title: title.trim(),
        summary: summary.trim() || undefined,
        ...(targetStudio === undefined ? {} : { studioId: targetStudio }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      onClose();
    },
    onError: (createError: Error) => setError(createError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a section"
      description="A place in the Contract for rules of one kind."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || title.trim().length < 2 || targetStudio === undefined}
            className="btn-primary"
          >
            {create.isPending && <Spinner />} Add section
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <div>
          <label className="label" htmlFor="section-title">
            Title
          </label>
          <input
            id="section-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Hero Bucks & Accountability"
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="section-summary">
            What goes in here (optional)
          </label>
          <input
            id="section-summary"
            className="input"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="How Hero Bucks are earned, spent and appealed."
          />
        </div>
        <StudioPicker value={targetStudio} onChange={setTargetStudio} />
      </div>
    </Modal>
  );
}

/**
 * Who this section belongs to, and who else sees it.
 *
 * Kept separate from the rule editor because moving a section between studios
 * changes who a whole set of rules governs - that deserves its own decision,
 * not a field buried in a form someone opened to fix a typo.
 */
function SectionSharing({ section, onClose }: { section: Section; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { studios } = useSession();
  const [owner, setOwner] = useState<number | null>(section.studioId);
  const [sharedWith, setSharedWith] = useState<number[]>(section.sharedStudioIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      apiPatch(`/wiki/sections/${section.id}`, {
        studioId: owner,
        sharedStudioIds: owner === null ? [] : sharedWith.filter((id) => id !== owner),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      onClose();
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  const ruleCount = section.rules.length;
  const ownerName = studios.find((entry) => entry.id === owner)?.name;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Who sees "${section.title}"?`}
      description={`${ruleCount} rule${ruleCount === 1 ? "" : "s"} in this section.`}
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

        <StudioPicker
          value={owner}
          onChange={setOwner}
          label="This section belongs to"
          hint="The studio whose Contract these rules are part of, and whose Town Hall can change them."
        />

        <SharedWithPicker
          ownerStudioId={owner}
          value={sharedWith}
          onChange={setSharedWith}
          noun="section"
        />

        {owner === null ? (
          <Banner tone="warning">
            Academy-wide means every studio sees these rules, including the youngest. A Town Hall in
            one studio can't change them on its own — the AI will raise it as a finding instead.
          </Banner>
        ) : sharedWith.length > 0 ? (
          <Banner tone="info">
            {ownerName} owns these rules; the studios you picked read the same copy. If{" "}
            {ownerName} changes one, it changes for all of them.
          </Banner>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------- findings --------------------------------- */

function FindingsPanel({ findings }: { findings: Finding[] }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [resolving, setResolving] = useState<Finding | null>(null);

  const bySeverity = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const sorted = [...findings].sort(
    (a, b) => (bySeverity[a.severity] ?? 3) - (bySeverity[b.severity] ?? 3),
  );

  const resolve = useMutation({
    mutationFn: (input: { id: number; status: string; note: string }) =>
      apiPost(`/wiki/findings/${input.id}/resolve`, { status: input.status, note: input.note }),
    onSuccess: () => {
      setResolving(null);
      void queryClient.invalidateQueries({ queryKey: ["findings"] });
    },
  });

  return (
    <>
      <div className="card border-amber-200 bg-amber-50/50">
        <button
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-900">
              {findings.length} thing{findings.length === 1 ? "" : "s"} the AI wants a human to
              settle
            </div>
            <div className="text-xs text-amber-700">
              Contradictions, gaps, and calls it won't make on its own.
            </div>
          </div>
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-amber-600 transition ${open ? "rotate-90" : ""}`}
          />
        </button>

        {open && (
          <ul className="divide-y divide-amber-200/70 border-t border-amber-200">
            {sorted.map((finding) => (
              <li key={finding.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={finding.severity === "high" ? "red" : "amber"}>
                    {FINDING_LABEL[finding.type] ?? finding.type}
                  </Chip>
                  <span className="text-sm font-semibold text-gray-900">{finding.title}</span>
                </div>
                <p className="mt-1.5 text-sm text-gray-700">{finding.description}</p>
                {finding.options.length > 0 && (
                  <div className="mt-2.5">
                    <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Ways to settle it
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-600">
                      {finding.options.map((option, index) => (
                        <li key={index}>{option}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {can("findings.resolve") && (
                  <button
                    onClick={() => setResolving(finding)}
                    className="btn-secondary btn-sm mt-3"
                  >
                    Settle this
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {resolving && (
        <ResolveFindingModal
          finding={resolving}
          onClose={() => setResolving(null)}
          onSubmit={(status, note) => resolve.mutate({ id: resolving.id, status, note })}
          busy={resolve.isPending}
        />
      )}
    </>
  );
}

function ResolveFindingModal({
  finding,
  onClose,
  onSubmit,
  busy,
}: {
  finding: Finding;
  onClose: () => void;
  onSubmit: (status: string, note: string) => void;
  busy: boolean;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      title={finding.title}
      description="Say what the studio decided. It goes in the activity log either way."
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => onSubmit("dismissed", note)}
            disabled={busy}
            className="btn-secondary"
          >
            Not a problem
          </button>
          <button
            onClick={() => onSubmit("resolved", note)}
            disabled={busy || !note.trim()}
            className="btn-primary"
          >
            {busy && <Spinner />} Mark settled
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-gray-600">{finding.description}</p>
      <label className="label" htmlFor="resolution">
        What did you decide?
      </label>
      <textarea
        id="resolution"
        className="input min-h-[100px]"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="e.g. Town Hall on the 12th confirmed quorum is two-thirds. The older doc is out of date."
        autoFocus
      />
      <p className="hint">
        Settling a finding doesn't change the wiki by itself. If a rule needs to change, edit it or
        run it through a Town Hall.
      </p>
    </Modal>
  );
}

/* ------------------------------- documents -------------------------------- */

function DocumentsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can, studioId, studios } = useSession();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [failures, setFailures] = useState<{ filename: string; reason: string }[]>([]);
  const [targetStudio, setTargetStudio] = useState<number | null | undefined>(
    studioId === null ? undefined : studioId,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const formatDate = useDateFormat();

  const docs = useQuery<{ documents: Doc[]; acceptedExtensions: string[] }>({
    queryKey: ["documents", studioId],
    queryFn: () => apiGet("/wiki/documents"),
    enabled: open,
  });

  const studioName = (id: number | null) =>
    id === null ? "Academy-wide" : (studios.find((entry) => entry.id === id)?.name ?? "Another studio");

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setFailures([]);
    const form = new FormData();
    for (const file of Array.from(files)) form.append("files", file);
    // The studio rides along so the AI reads the right pile of documents later.
    if (targetStudio !== undefined) {
      form.append("studioId", targetStudio === null ? "null" : String(targetStudio));
    }
    try {
      const result = await apiUpload<{ saved: string[]; failed: typeof failures }>(
        "/wiki/documents",
        form,
      );
      setFailures(result.failed ?? []);
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (uploadError) {
      setFailures([
        {
          filename: "Upload",
          reason: uploadError instanceof Error ? uploadError.message : "Failed.",
        },
      ]);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const remove = useMutation({
    mutationFn: (id: number) => apiDelete(`/wiki/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Source documents"
      description="What the AI reads when it builds a studio's wiki. Each studio's pile is read on its own."
      wide
    >
      {can("documents.upload") && (
        <div className="mb-4">
          <StudioPicker
            value={targetStudio}
            onChange={setTargetStudio}
            label="These documents belong to"
            hint="The AI only reads a studio's own documents, plus anything filed academy-wide."
          />
        </div>
      )}

      {can("documents.upload") && (
        <label
          className={`mb-4 flex flex-col items-center rounded-xl border-2 border-dashed p-8 text-center transition ${
            targetStudio === undefined
              ? "cursor-not-allowed border-gray-200 opacity-60"
              : uploading
                ? "cursor-pointer border-brand-300 bg-brand-50"
                : "cursor-pointer border-gray-300 hover:border-brand-400"
          }`}
        >
          {uploading ? (
            <Spinner className="h-6 w-6 text-brand-600" />
          ) : (
            <Upload className="h-6 w-6 text-gray-400" />
          )}
          <span className="mt-2.5 text-sm font-medium text-gray-900">
            {targetStudio === undefined
              ? "Choose a studio above first"
              : uploading
                ? "Reading files..."
                : "Drop files here or click to choose"}
          </span>
          <span className="mt-1 text-xs text-gray-500">
            .docx, .md, .txt, .html, .rtf and friends. From Google Docs use File → Download.
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            disabled={uploading || targetStudio === undefined}
            onChange={(event) => upload(event.target.files)}
          />
        </label>
      )}

      {failures.length > 0 && (
        <div className="mb-4">
          <Banner tone="warning" title="Some files didn't go through">
            <ul className="mt-1 space-y-1">
              {failures.map((failure, index) => (
                <li key={index}>
                  <strong>{failure.filename}</strong> — {failure.reason}
                </li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {docs.isLoading ? (
        <LoadingPage />
      ) : (docs.data?.documents.length ?? 0) === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">Nothing uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {docs.data!.documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 py-3">
              <FileText className="h-4 w-4 shrink-0 text-gray-400" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">{doc.filename}</span>
                  <Chip tone={doc.studioId === null ? "neutral" : "brand"}>
                    {studioName(doc.studioId)}
                  </Chip>
                </div>
                <div className="text-xs text-gray-500">
                  {(doc.characters / 1000).toFixed(1)}k characters
                  {doc.uploaderName && ` · ${doc.uploaderName}`}
                  {` · ${formatDate(doc.createdAt)}`}
                  {doc.status === "included" && " · read by the AI"}
                </div>
              </div>
              {can("documents.upload") && (
                <button
                  onClick={() => remove.mutate(doc.id)}
                  className="btn-ghost p-1.5 text-gray-400 hover:text-red-600"
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* -------------------------------- editors --------------------------------- */

function RuleEditor({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { settings } = useSession();
  const rationaleRequired = settings.governance.requireRationaleOnEdits;
  const [title, setTitle] = useState(rule.title);
  const [body, setBody] = useState(rule.body);
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => apiPatch(`/wiki/rules/${rule.id}`, { title, body, rationale }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      onClose();
    },
    onError: (saveError: Error) => setError(saveError.message),
  });

  const repeal = useMutation({
    mutationFn: () =>
      apiPost(`/wiki/rules/${rule.id}/repeal`, { rationale: rationale || undefined }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      onClose();
    },
    onError: (repealError: Error) => setError(repealError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit rule"
      wide
      footer={
        <>
          <button
            onClick={() => repeal.mutate()}
            disabled={repeal.isPending || (rationaleRequired && !rationale.trim())}
            title={
              rationaleRequired && !rationale.trim()
                ? "Say why you're repealing it first."
                : undefined
            }
            className="btn-danger mr-auto"
          >
            {repeal.isPending && <Spinner />} Repeal
          </button>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || (rationaleRequired && !rationale.trim())}
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
          <label className="label" htmlFor="rule-title">
            Title
          </label>
          <input
            id="rule-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="rule-body">
            Rule
          </label>
          <textarea
            id="rule-body"
            className="input min-h-[180px] font-mono text-[13px]"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="hint">Markdown works here.</p>
        </div>
        <div>
          <label className="label" htmlFor="rule-why">
            Why are you changing this?
            {rationaleRequired && <span className="ml-1 text-red-600">*</span>}
          </label>
          <input
            id="rule-why"
            className="input"
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Town Hall voted to raise the appeal cost"
            required={rationaleRequired}
          />
          <p className="hint">
            Goes into the rule's history. Someone reading this in a year will want to know.
            {rationaleRequired && " This academy requires it on every change."}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function RuleCreator({ section, onClose }: { section: Section; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost("/wiki/rules", { sectionId: section.id, title, body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wiki"] });
      onClose();
    },
    onError: (createError: Error) => setError(createError.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add a rule to ${section.title}`}
      wide
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={create.isPending || !title.trim() || !body.trim()}
            className="btn-primary"
          >
            {create.isPending && <Spinner />} Add rule
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Banner tone="error">{error}</Banner>}
        <Banner tone="info">
          Adding a rule by hand skips the studio's normal process. If this came out of a Town Hall,
          record it there instead so the decision keeps its provenance.
        </Banner>
        <div>
          <label className="label" htmlFor="new-title">
            Title
          </label>
          <input
            id="new-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="new-body">
            Rule
          </label>
          <textarea
            id="new-body"
            className="input min-h-[160px] font-mono text-[13px]"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------- history --------------------------------- */

type Revision = {
  revision: {
    id: number;
    changeType: string;
    titleBefore: string | null;
    titleAfter: string | null;
    bodyBefore: string | null;
    bodyAfter: string | null;
    rationale: string | null;
    actorType: string;
    createdAt: string;
  };
  actorName: string | null;
};

const CHANGE_TONE: Record<string, ChipTone> = {
  created: "green",
  amended: "amber",
  repealed: "red",
  moved: "blue",
  restored: "purple",
};

function HistoryModal({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const history = useQuery<{ revisions: Revision[] }>({
    queryKey: ["rule-history", rule.id],
    queryFn: () => apiGet(`/wiki/rules/${rule.id}/history`),
  });

  return (
    <Modal open onClose={onClose} title={rule.title} description="Everything that changed, and why." wide>
      {history.isLoading ? (
        <LoadingPage />
      ) : (
        <ol className="space-y-4">
          {history.data?.revisions.map(({ revision, actorName }) => (
            <li key={revision.id} className="border-l-2 border-gray-200 pl-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={CHANGE_TONE[revision.changeType] ?? "neutral"}>
                  {revision.changeType}
                </Chip>
                <span className="text-xs text-gray-500">
                  {new Date(revision.createdAt).toLocaleString()}
                  {" · "}
                  {revision.actorType === "ai" ? "Eagle Bot AI" : (actorName ?? "someone")}
                </span>
              </div>
              {revision.rationale && (
                <p className="mt-1.5 text-sm text-gray-700">{revision.rationale}</p>
              )}
              {revision.changeType === "amended" && revision.bodyBefore && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-700">
                    See what it said before
                  </summary>
                  <div className="mt-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                    <Markdown>{revision.bodyBefore}</Markdown>
                  </div>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
