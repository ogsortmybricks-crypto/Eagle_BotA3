import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Archive, CalendarDays, ChevronLeft, ChevronRight, Clipboard, FolderOpen, KeyRound, Plus, Award } from "lucide-react";
import { apiPost, getApiStudio } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Banner, Chip, Spinner } from "@/components/ui";
import type { ApAssignment, ApCertificate, ApProfile } from "../shared/workspace";
import type { PartnerCheckin, ViewPartners } from "../shared/view";
import type { RenderTarget } from "@/tacons/Renderer";

type Props = { view: ViewPartners; target: RenderTarget };
type Notice = { tone: "success" | "error"; message: string } | null;
const targetFields = (target: RenderTarget) => ({
  ...(target.page ? { page: target.page } : {}),
  ...(target.panel ? { panel: target.panel } : {}),
  ...(target.position ? { position: target.position } : {}),
});
const dayString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const monday = (date: Date) => { const copy = new Date(date); copy.setHours(12, 0, 0, 0); copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7)); return dayString(copy); };
const sunday = (week: string) => { const date = new Date(`${week}T12:00:00`); date.setDate(date.getDate() + 6); return dayString(date); };
const shiftMonth = (date: Date, by: number) => new Date(date.getFullYear(), date.getMonth() + by, 1, 12);
const displayDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function useWorkspaceApi({ view, target }: Props) {
  const client = useQueryClient();
  const base = `/tacons/view/${target.installId}/partners/${encodeURIComponent(view.partners)}`;
  const send = (path: string, fields: Record<string, unknown>) =>
    apiPost(`${base}${path}`, { ...targetFields(target), index: view.index, ...fields });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["tacon-view"] });
    void client.invalidateQueries({ queryKey: ["tacon-desks"] });
    target.onChanged();
  };
  return { send, refresh };
}

export function ApWorkspace({ view, target }: Props) {
  const [section, setSection] = useState("assignments");
  const canSeeHistory = view.historyGroups.length > 0;
  const entries = [
    { id: "assignments", label: "Weekly work", Icon: Clipboard },
    { id: "calendar", label: "Calendar", Icon: CalendarDays },
    { id: "settings", label: "My AP settings", Icon: KeyRound },
    ...(canSeeHistory ? [{ id: "history", label: "History folders", Icon: FolderOpen }] : []),
  ];
  if (!entries.some((entry) => entry.id === section)) setSection(entries[0]?.id ?? "calendar");
  return <div className="space-y-5">
    <nav className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2" aria-label="AP learning workspace">
      {entries.map(({ id, label, Icon }) => <button key={id} type="button" onClick={() => setSection(id)} aria-current={section === id ? "page" : undefined}
        className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${section === id ? "bg-[#28453d] text-white" : "text-slate-600 hover:bg-amber-50"}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />{label}
      </button>)}
    </nav>
    {section === "assignments" && <Assignments view={view} target={target} />}
    {section === "calendar" && <ApCalendar view={view} target={target} />}
    {section === "settings" && <ApSettings view={view} target={target} />}
    {section === "history" && canSeeHistory && <HistoryFolders view={view} target={target} />}
  </div>;
}

function Assignments({ view, target }: Props) {
  const api = useWorkspaceApi({ view, target });
  const [week, setWeek] = useState(monday(new Date()));
  const [editing, setEditing] = useState<ApAssignment | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  const [certFor, setCertFor] = useState<ApAssignment | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const activeCategories = view.workspace.categories.filter((category) => !category.archived);
  const coreCategories = ["Writers' Workshop", "Civilization", "Quest"];
  const categoryNames = [...new Set([...coreCategories, ...view.workspace.categories.map((category) => category.name), ...view.workspace.assignments.map((item) => item.category)])];
  const assignableCategoryNames = [...new Set([...coreCategories, ...activeCategories.map((category) => category.name)])];
  const assignments = view.workspace.assignments.filter((item) => item.week === week);

  async function persistAssignment(data: Record<string, unknown>) {
    setSaving(true); setNotice(null);
    try { await api.send("/assignments", data); setFormOpen(false); setEditing(null); api.refresh(); }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Assignment could not be saved." }); }
    finally { setSaving(false); }
  }
  async function archiveAssignment(item: ApAssignment) {
    setSaving(true); setNotice(null);
    try { await api.send("/assignments", { id: item.id, week: item.week, category: item.category, title: item.title, description: item.description, dueDate: item.dueDate, archived: true }); api.refresh(); }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Assignment could not be archived." }); }
    finally { setSaving(false); }
  }
  async function saveCategory() {
    if (!categoryName.trim()) return;
    setSaving(true);
    try { await api.send("/categories", { name: categoryName.trim() }); setCategoryName(""); api.refresh(); }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Category could not be added." }); }
    finally { setSaving(false); }
  }
  async function archiveCategory(id: number, name: string) {
    setSaving(true);
    try { await api.send("/categories", { id, name, archived: true }); api.refresh(); }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Category could not be archived." }); }
    finally { setSaving(false); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-800">{view.workspace.canPlan ? "Planning desk" : "Your learning plan"}</p><h3 className="mt-1 text-xl font-semibold text-slate-900">Weekly assignments</h3></div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost p-2" type="button" aria-label="Previous week" onClick={() => { const d = new Date(`${week}T12:00:00`); d.setDate(d.getDate() - 7); setWeek(dayString(d)); }}><ChevronLeft className="h-4 w-4" /></button>
        <label className="text-sm font-medium text-slate-700">Week starting <input className="input mt-1" aria-label="Select assignment week" type="date" value={week} onChange={(e) => setWeek(monday(new Date(`${e.target.value}T12:00:00`)))} /></label>
        <button className="btn-ghost p-2" type="button" aria-label="Next week" onClick={() => { const d = new Date(`${week}T12:00:00`); d.setDate(d.getDate() + 7); setWeek(dayString(d)); }}><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
    {notice && <Banner tone={notice.tone}>{notice.message}</Banner>}
    {view.workspace.canPlan && <div className="rounded-2xl border border-amber-200 bg-[#fffdf8] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold text-slate-900">Categories</h4><p className="text-sm text-slate-500">The three core strands are ready to use; add a local category when needed.</p></div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void saveCategory(); }}><label className="sr-only" htmlFor="ap-category">New category</label><input id="ap-category" className="input w-40" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="New category" />
          <button className="btn-secondary" type="submit" disabled={saving || !categoryName.trim()}><Plus className="h-4 w-4" />Add</button></form></div>
      <div className="mt-3 flex flex-wrap gap-2">{categoryNames.map((name) => {
        const custom = activeCategories.find((category) => category.name === name && !["Writers' Workshop", "Civilization", "Quest"].includes(category.name));
        return <Chip key={name} tone="brand">{name}{custom && <button type="button" className="ml-2 underline" onClick={() => void archiveCategory(custom.id, custom.name)} aria-label={`Archive ${custom.name}`}>Archive</button>}</Chip>;
      })}</div>
    </div>}
    {view.workspace.canPlan && <div className="flex justify-end"><button type="button" className="btn-primary" onClick={() => { setEditing(null); setFormOpen(!formOpen); }}><Plus className="h-4 w-4" /> New assignment</button></div>}
    {formOpen && view.workspace.canPlan && <AssignmentForm key={`${editing?.id ?? "new"}-${week}`} categories={assignableCategoryNames} item={editing} initialWeek={week}
      saving={saving} onCancel={() => setFormOpen(false)} onSave={(data) => void persistAssignment(data)} />}
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter assignments by category">
      {["All categories", ...categoryNames].map((category) => {
        const count = category === "All categories" ? assignments.length : assignments.filter((item) => item.category === category).length;
        return <button key={category} type="button" aria-pressed={categoryFilter === category} onClick={() => setCategoryFilter(category)}
          className={`rounded-full border px-3 py-2 text-sm font-medium ${categoryFilter === category ? "border-[#28453d] bg-[#28453d] text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-amber-50"}`}>
          {category}<span className={`ml-2 text-xs ${categoryFilter === category ? "text-white/70" : "text-slate-400"}`}>{count}</span>
        </button>;
      })}
    </div>
    <div className="space-y-3">{assignments.filter((item) => categoryFilter === "All categories" || item.category === categoryFilter).length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{categoryFilter === "All categories" ? "No assignments planned for this week yet." : `No ${categoryFilter} assignments planned for this week.`}</p>}
      {assignments.filter((item) => categoryFilter === "All categories" || item.category === categoryFilter).map((item) => {
        const certs = view.workspace.certificates.filter((certificate) => certificate.assignmentId === item.id);
        return <article key={item.id} className={`rounded-2xl border p-4 sm:p-5 ${item.archived ? "border-slate-200 bg-slate-50 opacity-75" : "border-slate-200 bg-white"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Chip tone="brand">{item.category}</Chip>{item.archived && <Chip>Archived</Chip>}<span className="text-xs text-slate-500">Due {displayDate(item.dueDate)}</span></div>
              <h4 className="mt-2 text-lg font-semibold text-slate-900">{item.title}</h4><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{item.description}</p></div>
            {view.workspace.canPlan && <div className="flex gap-1"><button className="btn-ghost p-2" type="button" disabled={certs.length > 0 || saving || item.archived} title={certs.length ? "Certified assignments cannot be edited" : "Edit assignment"} onClick={() => { setEditing(item); setFormOpen(true); }} aria-label={`Edit ${item.title}`}><Clipboard className="h-4 w-4" /></button>
              {!item.archived && <button className="btn-ghost p-2" type="button" disabled={saving} onClick={() => void archiveAssignment(item)} aria-label={`Archive ${item.title}`}><Archive className="h-4 w-4" /></button>}</div>}
          </div>
          {certs.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3"><h5 className="text-sm font-semibold text-slate-700">Completed work</h5><div className="mt-2 flex flex-wrap gap-2">{certs.map((cert) => <CertificateRow key={cert.id} certificate={cert} view={view} target={target} onChanged={api.refresh} />)}</div></div>}
          {view.group?.members.some((member) => member.id !== view.me?.id) && !item.archived && <button type="button" className="btn-secondary mt-4" onClick={() => setCertFor(item)}><Award className="h-4 w-4" /> Verify partner's work</button>}
        </article>;
      })}
    </div>
    {view.workspace.certificates.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h4 className="font-semibold text-slate-900">Certification record</h4>
      <p className="mt-1 text-sm text-slate-500">Permanent links remain available, including for assignments from earlier weeks.</p>
      <div className="mt-3 flex flex-wrap gap-2">{[...view.workspace.certificates].sort((a, b) => b.certifiedAt.localeCompare(a.certifiedAt)).map((certificate) =>
        <CertificateRow key={certificate.id} certificate={certificate} view={view} target={target} onChanged={api.refresh} />)}</div>
    </section>}
    {certFor && <CertifyForm assignment={certFor} view={view} target={target} onClose={() => setCertFor(null)} onChanged={api.refresh} />}
  </div>;
}

function AssignmentForm({ categories, item, initialWeek, saving, onCancel, onSave }: { categories: string[]; item: ApAssignment | null; initialWeek: string; saving: boolean; onCancel: () => void; onSave: (data: Record<string, unknown>) => void }) {
  const [category, setCategory] = useState(item?.category ?? categories[0] ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [week, setWeek] = useState(item?.week ?? initialWeek);
  return <form className="grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); onSave({ ...(item ? { id: item.id } : {}), week, category, title: title.trim(), description: description.trim(), dueDate, archived: false }); }}>
    <label className="text-sm"><span className="label">Category</span><select className="input" required value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
    <label className="text-sm"><span className="label">Week starting</span><input className="input" type="date" required value={week} onChange={(e) => setWeek(monday(new Date(`${e.target.value}T12:00:00`)))} /></label>
    <label className="text-sm sm:col-span-2"><span className="label">Assignment title</span><input className="input" required maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="text-sm sm:col-span-2"><span className="label">What does the learner make or do?</span><textarea className="input min-h-24" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label className="text-sm"><span className="label">Due date</span><input className="input" type="date" required min={week} max={sunday(week)} value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
    <div className="flex items-end justify-end gap-2"><button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button><button className="btn-primary" disabled={saving || !category}>{saving && <Spinner />} Save assignment</button></div>
  </form>;
}

function CertifyForm({ assignment, view, target, onClose, onChanged }: { assignment: ApAssignment; view: ViewPartners; target: RenderTarget; onClose: () => void; onChanged: () => void }) {
  const api = useWorkspaceApi({ view, target });
  const possible = view.group?.members.filter((member) => member.id !== view.me?.id) ?? [];
  const [targetId, setTargetId] = useState(possible[0]?.id ?? 0);
  const [completedDate, setCompletedDate] = useState(dayString(new Date()));
  const [excellence, setExcellence] = useState(false);
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ApCertificate | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setNotice(null); setBusy(true);
    try {
      const result = await api.send("/certify", { assignmentId: assignment.id, targetId, completedDate, excellence, notes: notes.trim(), evidence: evidence.trim(), code });
      const certificate = (result as { certificate: ApCertificate }).certificate;
      setCreated(certificate); setCode(""); onChanged();
    } catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Certification could not be saved." }); }
    finally { setBusy(false); }
  }
  const link = created ? `${window.location.origin}/ap/verify/${encodeURIComponent(created.token)}` : "";
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-4 pt-[6vh]"><div role="dialog" aria-modal="true" aria-labelledby="certify-heading" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl sm:p-7">
    <h3 id="certify-heading" className="text-xl font-semibold text-slate-900">Review the actual work</h3><p className="mt-1 text-sm text-slate-600">{assignment.title}</p>
    {created ? <div className="mt-5 space-y-3"><Banner tone="success" title="Certificate recorded">{created.excellence ? "Work reviewed and certified with excellence." : "Work reviewed and certified as completed."}</Banner><label className="block text-sm"><span className="label">Shareable verification link</span><input readOnly className="input" value={link} /></label><button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(link)}><Clipboard className="h-4 w-4" />Copy link</button><button type="button" className="btn-primary ml-2" onClick={onClose}>Done</button></div> : <form className="mt-5 space-y-3" onSubmit={(e) => void submit(e)}>
      {notice && <Banner tone={notice.tone}>{notice.message}</Banner>}
      <label className="block text-sm"><span className="label">Partner whose work you reviewed</span><select className="input" value={targetId} onChange={(e) => setTargetId(Number(e.target.value))}>{possible.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"><input type="checkbox" required className="mt-1" /><span><strong className="block">I attest that I reviewed this work.</strong><span className="text-slate-600">Certification means you inspected the learner's actual evidence.</span></span></label>
      <label className="block text-sm"><span className="label">Completion date</span><input className="input" type="date" required value={completedDate} onChange={(e) => setCompletedDate(e.target.value)} /></label>
      <fieldset><legend className="label">Review outcome</legend><div className="grid gap-2 sm:grid-cols-2"><label className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm ${!excellence ? "border-emerald-400 bg-emerald-50" : "border-slate-200"}`}><input type="radio" name="outcome" checked={!excellence} onChange={() => setExcellence(false)} /><span><strong className="block">Completed</strong>Work meets the assignment.</span></label><label className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm ${excellence ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}><input type="radio" name="outcome" checked={excellence} onChange={() => setExcellence(true)} /><span><strong className="block">Excellence</strong>Exceptional quality and care.</span></label></div></fieldset>
      <label className="block text-sm"><span className="label">Evidence reference</span><textarea className="input min-h-20" maxLength={1500} required placeholder="Where did you inspect the work?" value={evidence} onChange={(e) => setEvidence(e.target.value)} /></label>
      <label className="block text-sm"><span className="label">Review notes <span className="font-normal text-slate-400">(optional)</span></span><textarea className="input min-h-20" maxLength={1500} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="block text-sm"><span className="label">Your six-digit AP code</span><input className="input" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
      <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || code.length !== 6 || !targetId || !evidence.trim()}>{busy && <Spinner />} Certify review</button></div>
    </form>}
  </div></div>;
}

function CertificateRow({ certificate, view, target, onChanged }: { certificate: ApCertificate; view: ViewPartners; target: RenderTarget; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const own = certificate.checkerId === view.me?.id;
  const canRevoke = !certificate.revoked && (own || view.workspace.canPlan);
  const link = `${window.location.origin}/ap/verify/${encodeURIComponent(certificate.token)}`;
  async function revoke() {
    setBusy(true); setError("");
    try {
      const base = `/tacons/view/${target.installId}/partners/${encodeURIComponent(view.partners)}`;
      await apiPost(`${base}/certificates/${certificate.id}/revoke`, { ...targetFields(target), index: view.index });
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Certificate could not be revoked."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="font-medium text-slate-800">{certificate.learnerName}</span><Chip tone={certificate.revoked ? "red" : certificate.excellence ? "amber" : "green"}>{certificate.revoked ? "Revoked" : certificate.excellence ? "Excellence" : "Completed"}</Chip>
    <a className="text-brand-700 underline" href={link} target="_blank" rel="noreferrer">Verification</a>
    {canRevoke && <button type="button" className="text-xs font-semibold text-red-700 underline" disabled={busy} onClick={() => void revoke()}>{busy ? "Working…" : "Revoke"}</button>}
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}</div>;
}

function ApCalendar({ view, target }: Props) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12));
  const [selected, setSelected] = useState(dayString(new Date()));
  const [member, setMember] = useState(view.me?.id ?? view.historyGroups.find((group) => group.active)?.members[0]?.id ?? 0);
  const [combined, setCombined] = useState(false);
  const people = useMemo(() => {
    if (!view.workspace.canReviewAll) return view.group?.members ?? (view.me ? [view.me] : []);
    const unique = new Map<number, { id: number; name: string }>();
    for (const group of view.historyGroups) for (const person of group.members) unique.set(person.id, person);
    if (view.me) unique.set(view.me.id, view.me);
    return [...unique.values()];
  }, [view.workspace.canReviewAll, view.historyGroups, view.group, view.me]);
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const gridStart = new Date(start); gridStart.setDate(1 - start.getDay());
  const grid = Array.from({ length: 42 }, (_, index) => { const date = new Date(gridStart); date.setDate(gridStart.getDate() + index); return dayString(date); });
  const selectedGroup = view.historyGroups.find((group) => group.active && group.members.some((person) => person.id === member))
    ?? (view.group?.members.some((person) => person.id === member) ? view.group : null);
  const fallbackGroup = view.historyGroups.find((group) => group.active);
  const visibleIds = combined ? (selectedGroup?.members.map((person) => person.id) ?? fallbackGroup?.members.map((person) => person.id) ?? [member]) : [member];
  const profile = (id: number) => view.workspace.profiles.find((entry) => entry.personId === id);
  const marked = (date: string, id: number) => {
    const p = profile(id);
    const attendance = p?.attendanceDays.includes(new Date(`${date}T12:00:00`).getDay()) ?? false;
    const absence = p?.absences.find((entry) => entry.date === date);
    const checkins = view.checkins.filter((item) => (item.targetId === id || item.checkerId === id) && item.date === date);
    return { attendance,
      missingCheckin: attendance && date < dayString(new Date()) && !absence && checkins.length === 0,
      absence,
      checkins,
      milestones: p?.milestones.filter((item) => item.date === date) ?? [],
      certificates: view.workspace.certificates.filter((cert) => cert.learnerId === id && cert.completedDate === date && !cert.revoked) };
  };
  const seenCheckinIds = new Set<number>();
  const details = visibleIds.flatMap((id) => {
    const data = marked(selected, id);
    return [{ id: `${id}-header`, name: people.find((p) => p.id === id)?.name ?? "Learner", data, kind: "header" as const },
      ...data.checkins.filter((item) => {
        if (seenCheckinIds.has(item.id)) return false;
        seenCheckinIds.add(item.id);
        return true;
      }).map((item) => ({ id: `checkin-${item.id}`, name: item.checkerName, data: item, kind: "checkin" as const })),
      ...data.milestones.map((item) => ({ id: `${id}-milestone-${item.id}`, name: item.title, data: item, kind: "milestone" as const })),
      ...data.certificates.map((item) => ({ id: `${id}-cert-${item.id}`, name: item.assignmentTitle, data: item, kind: "certificate" as const }))];
  });
  const week = monday(new Date(`${selected}T12:00:00`));
  const goals = view.goals.filter((entry) => entry.week === week && visibleIds.includes(entry.personId));
  return <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.85fr)]">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-800">Learning rhythm</p><h3 className="text-xl font-semibold text-slate-900">AP calendar</h3></div><div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={combined} onChange={(e) => setCombined(e.target.checked)} />Combined pair</label>{(view.workspace.canReviewAll || people.length > 1) && <label className="text-sm"><span className="sr-only">Calendar member</span><select className="input" value={member} onChange={(e) => setMember(Number(e.target.value))}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}</div></div>
      <div className="mt-4 flex items-center justify-between"><button className="btn-ghost p-2" aria-label="Previous month" type="button" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></button><h4 className="font-semibold text-slate-800">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h4><button className="btn-ghost p-2" aria-label="Next month" type="button" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></button></div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">{grid.map((date) => {
        const data = visibleIds.map((id) => marked(date, id));
        const checkinCount = new Set(data.flatMap((value) => value.checkins.map((item) => item.id))).size;
        const hasAbsence = data.some((value) => value.absence);
        const missingCheckin = data.some((value) => value.missingCheckin);
        const hasMilestone = data.some((value) => value.milestones.length > 0);
        const hasCert = data.some((value) => value.certificates.length > 0);
        const attendance = data.some((value) => value.attendance);
        return <button key={date} type="button" aria-pressed={selected === date} onClick={() => setSelected(date)}
          className={`relative min-h-14 rounded-lg border p-1 text-left text-xs ${date.slice(0, 7) !== dayString(month).slice(0, 7) ? "text-slate-300" : "text-slate-800"} ${selected === date ? "border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700" : "border-slate-100 hover:bg-amber-50"}`}>
          <span className="pl-1 font-semibold">{Number(date.slice(-2))}</span><span className="mt-1 flex flex-wrap gap-0.5">{checkinCount > 0 && <i className="h-1.5 w-1.5 rounded-full bg-emerald-600" title={`${checkinCount} check-ins`} />}{attendance && <i className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Recurring attendance day" />}{hasAbsence && <i className="h-1.5 w-1.5 rounded-full bg-rose-500" title="Absence" />}{missingCheckin && <i className="h-1.5 w-1.5 rounded-full bg-orange-600" title="No check-in recorded" />}{hasMilestone && <i className="h-1.5 w-1.5 rounded-full bg-violet-500" title="Milestone" />}{hasCert && <i className="h-1.5 w-1.5 rounded-full bg-sky-600" title="Completed assignment" />}</span>
        </button>;
      })}</div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600"><span>● Check-in</span><span className="text-amber-700">● Weekly rhythm</span><span className="text-rose-600">● Absence</span><span className="text-orange-700">● Unrecorded check-in</span><span className="text-violet-600">● Milestone</span><span className="text-sky-700">● Completed work</span></div>
    </section>
    <aside className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-[#fffdf8] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected day</p><h3 className="text-lg font-semibold text-slate-900">{displayDate(selected)}</h3></div>
          {!combined && people.length > 1 && !view.workspace.canReviewAll && <label className="text-sm"><span className="sr-only">Calendar member</span><select className="input" value={member} onChange={(e) => setMember(Number(e.target.value))}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>}</div>
        <div className="mt-3 space-y-3">{details.map((item) => item.kind === "header" ? <div key={item.id} className="rounded-lg bg-white p-3 text-sm"><div className="flex justify-between gap-2"><strong>{item.name}</strong><span className="text-xs text-slate-500">{item.data.missingCheckin ? "Usual attendance day · no check-in recorded" : item.data.attendance ? "Usual attendance day" : ""}</span></div>{item.data.absence && <p className="mt-1 text-rose-700">Absent · {item.data.absence.reason}: {item.data.absence.notes}</p>}</div> :
          item.kind === "checkin" ? <ArchiveCheckin key={item.id} checkin={item.data as PartnerCheckin} view={view} target={target} /> :
          item.kind === "milestone" ? <div key={item.id} className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm"><strong>Milestone: {item.name}</strong><p className="text-slate-600">{(item.data as ApProfile["milestones"][number]).notes}</p></div> :
          <div key={item.id} className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm"><strong>Completed: {item.name}</strong><p>{(item.data as ApCertificate).excellence ? "Certified with excellence" : "Certified as completed"}</p><a className="mt-1 inline-block text-brand-700 underline" target="_blank" rel="noreferrer" href={`${window.location.origin}/ap/verify/${encodeURIComponent((item.data as ApCertificate).token)}`}>Open verification record</a></div>)}
          {details.every((item) => item.kind === "header" && !(item.data as ReturnType<typeof marked>).absence && !(item.data as ReturnType<typeof marked>).attendance && !(item.data as ReturnType<typeof marked>).missingCheckin) && <p className="py-4 text-sm text-slate-500">No recorded activity on this day.</p>}</div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="font-semibold text-slate-900">Goals for the week</h3><p className="text-xs text-slate-500">Week starting {displayDate(week)}</p>{goals.length === 0 ? <p className="mt-2 text-sm text-slate-500">No goals recorded for this week.</p> : goals.map((entry) => <div key={entry.personId} className="mt-3"><p className="text-sm font-medium">{people.find((p) => p.id === entry.personId)?.name}</p><ul className="mt-1 list-inside list-disc text-sm text-slate-600">{Object.entries(entry.goals).filter(([, value]) => value).map(([key, value]) => <li key={key}><strong>{key}:</strong> {value}</li>)}</ul></div>)}</div>
    </aside>
  </div>;
}

function ApSettings({ view, target }: Props) {
  const api = useWorkspaceApi({ view, target });
  const profile = view.workspace.profiles.find((item) => item.personId === view.me?.id);
  const [days, setDays] = useState<number[]>(profile?.attendanceDays ?? []);
  const [absDate, setAbsDate] = useState(dayString(new Date()));
  const [absReason, setAbsReason] = useState<"sick" | "other">("other");
  const [absNotes, setAbsNotes] = useState("");
  const [editingAbsenceIndex, setEditingAbsenceIndex] = useState<number | null>(null);
  const [milestoneDate, setMilestoneDate] = useState(dayString(new Date()));
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneNotes, setMilestoneNotes] = useState("");
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  async function saveProfile(next: ApProfile): Promise<boolean> {
    setBusy(true); setNotice(null);
    try { await api.send("/profile", { attendanceDays: next.attendanceDays, absences: next.absences, milestones: next.milestones }); setNotice({ tone: "success", message: "Your AP profile was saved." }); api.refresh(); return true; }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Profile could not be saved." }); return false; }
    finally { setBusy(false); }
  }
  const ownAbsences = profile?.absences ?? [];
  const ownMilestones = profile?.milestones ?? [];
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const resetAbsenceForm = () => {
    setEditingAbsenceIndex(null);
    setAbsDate(dayString(new Date()));
    setAbsReason("other");
    setAbsNotes("");
  };
  const resetMilestoneForm = () => {
    setEditingMilestoneId(null);
    setMilestoneDate(dayString(new Date()));
    setMilestoneTitle("");
    setMilestoneNotes("");
  };
  async function submitAbsence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const duplicateIndex = ownAbsences.findIndex((item, index) => item.date === absDate && index !== editingAbsenceIndex);
    if (duplicateIndex !== -1) {
      setNotice({ tone: "error", message: `An absence is already recorded for ${displayDate(absDate)}. Edit that entry instead.` });
      return;
    }
    const absence = { date: absDate, reason: absReason, notes: absNotes.trim() };
    const nextAbsences = editingAbsenceIndex === null
      ? [...ownAbsences, absence]
      : ownAbsences.map((item, index) => index === editingAbsenceIndex ? absence : item);
    if (await saveProfile({ personId: view.me?.id ?? 0, attendanceDays: days, absences: nextAbsences, milestones: ownMilestones })) resetAbsenceForm();
  }
  async function submitMilestone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const milestone = { id: editingMilestoneId ?? `${Date.now()}`, date: milestoneDate, title: milestoneTitle.trim(), notes: milestoneNotes.trim() };
    const nextMilestones = editingMilestoneId === null
      ? [...ownMilestones, milestone]
      : ownMilestones.map((item) => item.id === editingMilestoneId ? milestone : item);
    if (await saveProfile({ personId: view.me?.id ?? 0, attendanceDays: days, absences: ownAbsences, milestones: nextMilestones })) resetMilestoneForm();
  }
  async function removeAbsence(index: number) {
    const item = ownAbsences[index];
    if (!item || !window.confirm(`Remove the absence recorded for ${displayDate(item.date)}?`)) return;
    if (await saveProfile({ personId: view.me?.id ?? 0, attendanceDays: days, absences: ownAbsences.filter((_, i) => i !== index), milestones: ownMilestones })) {
      if (editingAbsenceIndex === index) resetAbsenceForm();
      else if (editingAbsenceIndex !== null && editingAbsenceIndex > index) setEditingAbsenceIndex(editingAbsenceIndex - 1);
    }
  }
  async function removeMilestone(id: string) {
    const item = ownMilestones.find((entry) => entry.id === id);
    if (!item || !window.confirm(`Remove the milestone “${item.title}”?`)) return;
    if (await saveProfile({ personId: view.me?.id ?? 0, attendanceDays: days, absences: ownAbsences, milestones: ownMilestones.filter((entry) => entry.id !== id) })) {
      if (editingMilestoneId === id) resetMilestoneForm();
    }
  }
  return <div className="mx-auto max-w-3xl space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-800">Your record</p><h3 className="text-2xl font-semibold text-slate-900">AP settings</h3><p className="text-sm text-slate-600">Set your usual learning days and keep milestones and absences in context.</p></header>
    {notice && <Banner tone={notice.tone}>{notice.message}</Banner>}
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h4 className="font-semibold text-slate-900">Usual attendance days</h4><p className="mt-1 text-sm text-slate-500">These are recurring guideposts, not a claim that you attended on a specific date.</p><div className="mt-3 flex flex-wrap gap-2">{weekdays.map((day, index) => <label key={day} className={`cursor-pointer rounded-xl border px-3 py-2 text-sm ${days.includes(index) ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-600"}`}><input className="sr-only" type="checkbox" checked={days.includes(index)} onChange={() => setDays((old) => old.includes(index) ? old.filter((value) => value !== index) : [...old, index].sort())} />{day}</label>)}</div><button type="button" className="btn-primary mt-4" disabled={busy} onClick={() => void saveProfile({ personId: view.me?.id ?? 0, attendanceDays: days, absences: ownAbsences, milestones: ownMilestones })}>{busy && <Spinner />} Save attendance days</button></section>
    <section className="grid gap-4 md:grid-cols-2">
      <form className="rounded-2xl border border-slate-200 bg-white p-5" onSubmit={(event) => void submitAbsence(event)}>
        <h4 className="font-semibold text-slate-900">{editingAbsenceIndex === null ? "Record an absence" : "Edit absence"}</h4><label className="mt-3 block text-sm"><span className="label">Date</span><input className="input" type="date" required value={absDate} onChange={(e) => setAbsDate(e.target.value)} /></label>
        <label className="mt-2 block text-sm"><span className="label">Reason</span><select className="input" value={absReason} onChange={(e) => setAbsReason(e.target.value as "sick" | "other")}><option value="sick">Sick</option><option value="other">Other</option></select></label>
        <label className="mt-2 block text-sm"><span className="label">Notes</span><textarea className="input min-h-20" maxLength={500} value={absNotes} onChange={(e) => setAbsNotes(e.target.value)} /></label><div className="mt-3 flex gap-2"><button className="btn-secondary" disabled={busy}>{editingAbsenceIndex === null ? "Save absence" : "Save changes"}</button>{editingAbsenceIndex !== null && <button type="button" className="btn-secondary" disabled={busy} onClick={resetAbsenceForm}>Cancel</button>}</div>
        <ul className="mt-3 space-y-2 text-xs text-slate-600">{ownAbsences.map((item, index) => <li key={`${item.date}-${index}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2"><span>{displayDate(item.date)} · {item.reason}{item.notes ? ` — ${item.notes}` : ""}</span><span className="flex gap-2"><button type="button" className="font-semibold text-emerald-800 underline" onClick={() => { setEditingAbsenceIndex(index); setAbsDate(item.date); setAbsReason(item.reason); setAbsNotes(item.notes ?? ""); setNotice(null); }}>Edit</button><button type="button" className="font-semibold text-rose-700 underline" disabled={busy} onClick={() => void removeAbsence(index)}>Remove</button></span></li>)}</ul>
      </form>
      <form className="rounded-2xl border border-slate-200 bg-white p-5" onSubmit={(event) => void submitMilestone(event)}>
        <h4 className="font-semibold text-slate-900">{editingMilestoneId === null ? "Add a milestone" : "Edit milestone"}</h4><label className="mt-3 block text-sm"><span className="label">Date</span><input className="input" type="date" required value={milestoneDate} onChange={(e) => setMilestoneDate(e.target.value)} /></label>
        <label className="mt-2 block text-sm"><span className="label">Milestone</span><input className="input" required maxLength={140} value={milestoneTitle} onChange={(e) => setMilestoneTitle(e.target.value)} /></label>
        <label className="mt-2 block text-sm"><span className="label">Notes</span><textarea className="input min-h-20" maxLength={500} value={milestoneNotes} onChange={(e) => setMilestoneNotes(e.target.value)} /></label><div className="mt-3 flex gap-2"><button className="btn-secondary" disabled={busy}>{editingMilestoneId === null ? "Save milestone" : "Save changes"}</button>{editingMilestoneId !== null && <button type="button" className="btn-secondary" disabled={busy} onClick={resetMilestoneForm}>Cancel</button>}</div>
        <ul className="mt-3 space-y-2 text-xs text-slate-600">{ownMilestones.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2"><span>{displayDate(item.date)} · {item.title}{item.notes ? ` — ${item.notes}` : ""}</span><span className="flex gap-2"><button type="button" className="font-semibold text-emerald-800 underline" onClick={() => { setEditingMilestoneId(item.id); setMilestoneDate(item.date); setMilestoneTitle(item.title); setMilestoneNotes(item.notes ?? ""); setNotice(null); }}>Edit</button><button type="button" className="font-semibold text-rose-700 underline" disabled={busy} onClick={() => void removeMilestone(item.id)}>Remove</button></span></li>)}</ul>
      </form>
    </section>
    <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5"><h4 className="font-semibold text-slate-900">Certification code</h4><p className="mt-1 text-sm text-slate-600">Manage your private six-digit review code from your own Eagle Bot profile. It is never displayed or recoverable.</p>
      {view.me && <Link href={`/people/${view.me.id}`} className="btn-secondary mt-4"><KeyRound className="h-4 w-4" />Manage code on my profile</Link>}
    </section>
    <AdminCodeReset view={view} target={target} />
  </div>;
}

export function AdminCodeReset({ view, target }: Props) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const api = useWorkspaceApi({ view, target });
  const people = useMemo(() => {
    const unique = new Map<number, string>();
    for (const group of view.historyGroups) for (const person of group.members) unique.set(person.id, person.name);
    for (const person of view.manage?.candidates ?? []) unique.set(person.id, person.name);
    if (view.me) unique.set(view.me.id, view.me.name);
    return [...unique].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [view.historyGroups, view.manage?.candidates, view.me]);
  const [personId, setPersonId] = useState(people[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => {
    if (people.length && !people.some((item) => item.id === personId)) setPersonId(people[0].id);
  }, [people, personId]);
  const person = people.find((item) => item.id === personId);
  if (user?.role !== "admin") return null;
  async function reset() {
    if (!person || !window.confirm(`Reset the AP verification code for ${person.name}? They will need to set a new code from their own profile.`)) return;
    setBusy(true); setNotice(null);
    try {
      await api.send("/reset-code", { personId: person.id });
      setNotice({ tone: "success", message: `${person.name}'s AP code was reset. They can set a new one from their own profile.` });
      void queryClient.invalidateQueries({ queryKey: ["verification-code"] });
      api.refresh();
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The verification code could not be reset." });
    } finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-rose-200 bg-rose-50/50 p-5">
    <h4 className="font-semibold text-slate-900">Forgotten AP code</h4>
    <p className="mt-1 text-sm text-slate-600">Reset a learner's code only when they cannot change it themselves. They can choose a new private code on their own profile.</p>
    {notice && <div className="mt-3"><Banner tone={notice.tone}>{notice.message}</Banner></div>}
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <label className="min-w-[220px] flex-1 text-sm"><span className="label">Learner</span><select className="input" value={personId} onChange={(event) => setPersonId(Number(event.target.value))} disabled={!people.length || busy}>{people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="btn-secondary" type="button" onClick={() => void reset()} disabled={!person || busy}>{busy && <Spinner />} Reset code</button>
    </div>
  </section>;
}

function HistoryFolders({ view, target }: Props) {
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [groupId, setGroupId] = useState<number | "all">("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const groups = view.historyGroups;
  const checkins = useMemo(() => view.checkins.filter((checkin) => (!dateFilter || checkin.date === dateFilter) &&
    (groupId === "all" || checkin.groupId === groupId) &&
    (!query || `${checkin.checkerName} ${checkin.targetName} ${checkin.notes} ${checkin.date}`.toLowerCase().includes(query.toLowerCase()))), [view.checkins, dateFilter, groupId, query]);
  const certificates = useMemo(() => view.workspace.certificates.filter((certificate) =>
    (!dateFilter || certificate.completedDate === dateFilter) &&
    (groupId === "all" || certificate.groupId === groupId) &&
    (!query || `${certificate.learnerName} ${certificate.checkerName} ${certificate.assignmentTitle} ${certificate.completedDate}`.toLowerCase().includes(query.toLowerCase()))),
  [view.workspace.certificates, dateFilter, groupId, query]);
  const sortedGroups = [...groups].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return <div className="space-y-5">
    <header><p className="text-xs font-semibold uppercase tracking-[.16em] text-amber-800">{view.workspace.canReviewAll ? "Guide archive" : "Your archive"}</p><h3 className="text-2xl font-semibold text-slate-900">Pair history</h3><p className="text-sm text-slate-600">{view.workspace.canReviewAll ? "Browse pair folders, including ended groups, and open original check-in records." : "Your past and current pair folders, with original check-ins and completed work."}</p></header>
    <div className="grid gap-2 sm:grid-cols-[1fr_190px_190px]"><label><span className="label">Search check-ins</span><input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Names, notes, date" /></label><label><span className="label">Date</span><input className="input" type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} /></label><label><span className="label">Pair folder</span><select className="input" value={groupId} onChange={(e) => setGroupId(e.target.value === "all" ? "all" : Number(e.target.value))}><option value="all">All pairs</option>{sortedGroups.map((group) => <option key={group.id} value={group.id}>{group.members.map((m) => m.name).join(" · ")}{group.active ? "" : " · ended"}</option>)}</select></label></div>
    {sortedGroups.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">No group history is available to browse.</p>}
    <div className="space-y-3">{sortedGroups.map((group) => {
      const records = checkins.filter((item) => item.groupId === group.id);
      const awards = certificates.filter((item) => item.groupId === group.id);
      const years = [...new Set([...records.map((item) => item.date.slice(0, 4)), ...awards.map((item) => item.completedDate.slice(0, 4))])].sort().reverse();
      return <section key={group.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <button className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-amber-50/50" type="button" aria-expanded={expanded === group.id} onClick={() => setExpanded(expanded === group.id ? null : group.id)}>
          <span><span className="block font-semibold text-slate-900">{group.members.map((m) => m.name).join(" · ")}</span><span className="text-xs text-slate-500">Started {displayDate(group.startedAt.slice(0, 10))}{group.endedAt ? ` · ended ${displayDate(group.endedAt.slice(0, 10))}` : " · active"}</span></span>
          <span className="flex items-center gap-2"><Chip tone={group.active ? "green" : "neutral"}>{group.active ? "Active" : "Ended"}</Chip><span className="text-sm text-slate-500">{records.length + awards.length} records</span></span>
        </button>
        {expanded === group.id && <div className="space-y-3 border-t border-slate-100 p-4">
          {years.length === 0 ? <p className="text-sm text-slate-500">No records in this group.</p> : years.map((year) => {
            const yearRecords = records.filter((record) => record.date.startsWith(year));
            const yearAwards = awards.filter((award) => award.completedDate.startsWith(year));
            const months = [...new Set([...yearRecords.map((record) => record.date.slice(0, 7)), ...yearAwards.map((award) => award.completedDate.slice(0, 7))])].sort().reverse();
            return <div key={year} className="rounded-xl bg-slate-50 p-3"><h4 className="font-semibold text-slate-800">{year}</h4>{months.map((month) => {
              const monthRecords = yearRecords.filter((record) => record.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
              const monthAwards = yearAwards.filter((award) => award.completedDate.startsWith(month)).sort((a, b) => b.completedDate.localeCompare(a.completedDate));
              return <details key={month} className="mt-2 rounded-lg bg-white p-3"><summary className="cursor-pointer font-medium text-slate-700">{new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined, { month: "long" })} <span className="text-xs text-slate-500">({monthRecords.length + monthAwards.length})</span></summary><div className="mt-3 space-y-3">
                {monthRecords.map((record) => <ArchiveCheckin key={`checkin-${record.id}`} checkin={record} view={view} target={target} />)}
                {monthAwards.map((award) => <article key={`certificate-${award.id}`} className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><strong>{displayDate(award.completedDate)} · {award.learnerName}</strong><Chip tone={award.revoked ? "red" : award.excellence ? "amber" : "green"}>{award.revoked ? "Revoked" : award.excellence ? "Certified with excellence" : "Certified completed"}</Chip></div><p className="mt-1">{award.assignmentTitle} · {award.category}</p><p className="text-xs text-slate-600">Reviewed by {award.checkerName}{award.notes ? ` · ${award.notes}` : ""}</p><a className="mt-2 inline-block text-brand-700 underline" href={`${window.location.origin}/ap/verify/${encodeURIComponent(award.token)}`} target="_blank" rel="noreferrer">Open verification record</a></article>)}
              </div></details>;
            })}</div>;
          })}
        </div>}
      </section>;
    })}</div>
  </div>;
}

function ArchiveCheckin({ checkin, view, target }: { checkin: PartnerCheckin; view: ViewPartners; target: RenderTarget }) {
  const [shots, setShots] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const base = `/tacons/view/${target.installId}/partners/${encodeURIComponent(view.partners)}`;
  return <details className="rounded-xl border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-800">{displayDate(checkin.date)} · {checkin.checkerName} reviewed {checkin.targetName} <span className="font-normal text-slate-500">· {checkin.onTrack.replaceAll("-", " ")}</span></summary>
    <div className="mt-3 space-y-3 text-sm"><p><strong>Weekly goals and progress</strong></p>{checkin.core.map((entry) => <div key={entry.subject} className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{entry.subject}</p><p><span className="text-slate-500">Goal:</span> {entry.goal || "Not recorded"}</p><p><span className="text-slate-500">Progress:</span> {entry.progress || "Not recorded"}{entry.percent !== null ? ` (${entry.percent}%)` : ""}</p></div>)}{checkin.evidence.map((entry) => <div key={entry.subject} className="rounded-lg bg-slate-50 p-3"><p className="font-medium">{entry.subject} work evidence</p><p className="whitespace-pre-wrap">{entry.notes}</p><div className="mt-2 flex flex-wrap gap-2">{entry.shots.map((shot) => <HistoryShot key={shot} url={`/api${base}/shots/${shot}?${new URLSearchParams({ ...targetFields(target), index: String(view.index) })}`} value={shots[shot]} onLoad={(value) => setShots((old) => ({ ...old, [shot]: value }))} onOpen={() => setOpen(shots[shot])} />)}</div></div>)}{checkin.notes && <p className="whitespace-pre-wrap"><strong>Partner notes:</strong> {checkin.notes}</p>}</div>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setOpen(null)}><button type="button" className="absolute right-5 top-5 rounded bg-white px-3 py-2" onClick={() => setOpen(null)}>Close image</button><img src={open} alt="Full-size original check-in screenshot" className="max-h-[90vh] max-w-full object-contain" /></div>}
  </details>;
}

function HistoryShot({ url, value, onLoad, onOpen }: { url: string; value?: string; onLoad: (src: string) => void; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false; let objectUrl = "";
    const studio = getApiStudio();
    fetch(url, { credentials: "include", headers: { "X-Studio-Id": studio === null ? "all" : String(studio) } }).then((response) => response.ok ? response.blob() : Promise.reject(new Error()))
      .then((blob) => { if (!cancelled) { objectUrl = URL.createObjectURL(blob); onLoad(objectUrl); } }).catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (failed) return <span className="text-xs text-slate-500">Screenshot unavailable</span>;
  if (!value) return <span className="h-16 w-24 animate-pulse rounded bg-slate-200" aria-label="Loading screenshot" />;
  return <button type="button" onClick={onOpen} aria-label="Open original screenshot"><img src={value} alt="Original check-in screenshot" className="h-20 w-28 rounded-lg border border-slate-200 object-cover" /></button>;
}
