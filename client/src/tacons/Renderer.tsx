/**
 * Drawing a Tac-On.
 *
 * The server sends a finished view - strings, rows, fields - and this walks it.
 * Native widgets render here. Optional package programs run only in the
 * separate opaque-origin iframe/worker, never in this authenticated window.
 */

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, PartyPopper, Trash2 } from "lucide-react";
import { apiDelete, apiPost } from "@/lib/api";
import { useDateFormat } from "@/lib/session";
import { Banner, Spinner } from "@/components/ui";
import { ExtensionView } from "./Extensions";
import { ProgramView } from "./Program";
import type {
  TaconView,
  ViewCelebrate,
  ViewForm,
  ViewList,
  ViewPerson,
  ViewProgress,
  ViewRow,
  ViewWidget,
} from "@shared/tacons/view";

export type RenderTarget = {
  installId: number;
  /** One of these is set - a Tac-On page, a panel on a base page, or a position's desk. */
  page?: string;
  panel?: string;
  position?: string;
  people: ViewPerson[];
  /** Refetches the view after something is written. */
  onChanged: () => void;
};

export function Widgets({
  widgets,
  target,
  compact = false,
}: {
  widgets: ViewWidget[];
  target: RenderTarget;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      {widgets.map((widget, index) => (
        <WidgetView key={index} widget={widget} target={target} compact={compact} />
      ))}
    </div>
  );
}

function WidgetView({
  widget,
  target,
  compact,
}: {
  widget: ViewWidget;
  target: RenderTarget;
  compact: boolean;
}) {
  switch (widget.kind) {
    case "divider":
      return <hr className="border-gray-200" />;

    case "heading":
      return <h2 className="text-lg font-bold text-gray-900">{widget.text}</h2>;

    case "note":
      if (widget.tone === "plain") {
        return <p className="text-sm text-gray-600">{widget.text}</p>;
      }
      return <Banner tone={widget.tone === "warning" ? "warning" : "info"}>{widget.text}</Banner>;

    case "stat":
      return (
        <div className={compact ? "" : "sm:max-w-xs"}>
          <div className="card-pad">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {widget.label}
            </div>
            <div className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">
              {widget.value}
            </div>
            {widget.hint && <div className="mt-1 text-xs text-gray-500">{widget.hint}</div>}
          </div>
        </div>
      );

    case "progress":
      return <ProgressView progress={widget} compact={compact} />;

    case "celebrate":
      return <CelebrateView celebrate={widget} />;

    case "list":
      return <ListView list={widget} target={target} />;

    case "form":
      return <FormView form={widget} target={target} />;

    case "button":
      return <ButtonView label={widget.label} confirm={widget.confirm} index={widget.index} allowed={widget.allowed} target={target} />;

    case "extension":
      return <ExtensionView {...widget} target={target} />;
    case "program":
      return <ProgramView program={widget} target={target} />;
  }
}

/* --------------------------------- lists ---------------------------------- */

function ListView({ list, target }: { list: ViewList; target: RenderTarget }) {
  const formatDate = useDateFormat();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (id: number | string) =>
      apiDelete(`/tacons/view/${target.installId}/records/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tacon-view"] });
      target.onChanged();
    },
  });

  // Dates arrive as ISO strings so they can be shown in whichever format the
  // academy asked for. Everything else is already a finished string.
  const cell = (value: string, type: string) =>
    type === "date" && value ? formatDate(value, false) : value;

  return (
    <div>
      {list.title && (
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          {list.title}
        </h3>
      )}
      {list.problem && (
        <Banner tone="warning" title="This list couldn't be shown">
          {list.problem}
        </Banner>
      )}
      {remove.error && (
        <div className="mb-2">
          <Banner tone="error">{(remove.error as Error).message}</Banner>
        </div>
      )}
      {!list.problem && list.rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-gray-500">{list.empty}</p>
      ) : (
        !list.problem &&
        (list.groupDepth ? (
          <div className="card divide-y divide-gray-100">
            {folders(list.rows, 0, list.groupDepth).map((folder) => (
              <Folder key={folder.name} folder={folder} depth={0} list={list}>
                {(rows) => <RowTable list={list} rows={rows} cell={cell} onRemove={(id) => remove.mutate(id)} removing={remove.isPending} />}
              </Folder>
            ))}
          </div>
        ) : (
          <div className="card scroll-x">
            <RowTable list={list} rows={list.rows} cell={cell} onRemove={(id) => remove.mutate(id)} removing={remove.isPending} />
          </div>
        ))
      )}
    </div>
  );
}

function RowTable({
  list,
  rows,
  cell,
  onRemove,
  removing,
}: {
  list: ViewList;
  rows: ViewRow[];
  cell: (value: string, type: string) => string;
  onRemove: (id: number | string) => void;
  removing: boolean;
}) {
  const removable = rows.some((row) => row.canRemove);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 bg-gray-50 text-left">
          {list.columns.map((column) => (
            <th key={column.key} className="px-3 py-2 font-semibold text-gray-700">
              {column.label}
            </th>
          ))}
          {removable && <th className="w-10" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-gray-100 last:border-0">
            {list.columns.map((column) => (
              <td key={column.key} className="px-3 py-2 align-top text-gray-700">
                {column.type === "progress" ? (
                  <RowBar progress={row.progress} text={row.cells[column.key] ?? ""} />
                ) : column.type === "link" ? (
                  row.link ? (
                    <Link href={row.link} className="text-brand-600 underline">
                      {row.cells[column.key] || "Open"}
                    </Link>
                  ) : null
                ) : (
                  cell(row.cells[column.key] ?? "", column.type)
                )}
              </td>
            ))}
            {removable && (
              <td className="px-2 py-2 text-right">
                {row.canRemove && (
                  <button
                    onClick={() => onRemove(row.id)}
                    className="btn-ghost p-1.5"
                    aria-label="Remove row"
                    disabled={removing}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
      {list.totals && list.totals.length > 0 && rows.length > 1 && (
        <tfoot>
          <tr className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-800">
            {list.columns.map((column, index) => (
              <td key={column.key} className="px-3 py-2 tabular-nums">
                {list.totals!.includes(column.key) ? formatTotal(sumOf(rows, column.key)) : index === 0 ? "Total" : ""}
              </td>
            ))}
            {removable && <td />}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

/** Adds up one `total` column over some rows. */
function sumOf(rows: ViewRow[], key: string): number {
  return rows.reduce((total, row) => total + (row.numbers?.[key] ?? 0), 0);
}

function formatTotal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** One row's bar in a list's `progress` column. */
function RowBar({ progress, text }: { progress?: { value: number; goal: number }; text: string }) {
  if (!progress) return null;
  const share = progress.goal > 0 ? Math.max(0, Math.min(1, progress.value / progress.goal)) : 0;
  const done = progress.goal > 0 && progress.value >= progress.goal;
  return (
    <div className="flex min-w-[8rem] items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-brand-600"}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs tabular-nums text-gray-600">{text}</span>
    </div>
  );
}

type FolderNode = { name: string; rows: ViewRow[]; children: FolderNode[] };

/** Rows into nested folders by `row.groups`, keeping the order rows arrived in. */
function folders(rows: ViewRow[], level: number, depth: number): FolderNode[] {
  const byName = new Map<string, ViewRow[]>();
  for (const row of rows) {
    const name = row.groups?.[level] ?? "None";
    byName.set(name, [...(byName.get(name) ?? []), row]);
  }
  return [...byName.entries()].map(([name, inside]) => ({
    name,
    rows: inside,
    children: level + 1 < depth ? folders(inside, level + 1, depth) : [],
  }));
}

function Folder({
  folder,
  depth,
  list,
  children,
}: {
  folder: FolderNode;
  depth: number;
  list: ViewList;
  children: (rows: ViewRow[]) => ReactNode;
}) {
  // `total steps`: the folder's own rows added up, on its header.
  const totals = (list.totals ?? []).map((key) => ({
    key,
    label: list.columns.find((column) => column.key === key)?.label ?? key,
    value: sumOf(folder.rows, key),
  }));
  return (
    <details open={depth === 0} className="group">
      <summary
        className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
        style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
      >
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        {totals.map((total) => (
          <span key={total.key} className="whitespace-nowrap text-xs font-semibold tabular-nums text-gray-700">
            {total.label}: {formatTotal(total.value)}
          </span>
        ))}
        <span className="text-xs tabular-nums text-gray-500">{folder.rows.length}</span>
      </summary>
      {folder.children.length > 0 ? (
        <div className="divide-y divide-gray-100">
          {folder.children.map((child) => (
            <Folder key={child.name} folder={child} depth={depth + 1} list={list}>
              {children}
            </Folder>
          ))}
        </div>
      ) : (
        <div className="scroll-x border-t border-gray-100" style={{ marginLeft: `${depth * 1.25}rem` }}>
          {children(folder.rows)}
        </div>
      )}
    </details>
  );
}

/* ------------------------------- progress --------------------------------- */

function ProgressView({ progress, compact }: { progress: ViewProgress; compact: boolean }) {
  const share = progress.goal > 0 ? Math.max(0, Math.min(1, progress.value / progress.goal)) : 0;
  const done = progress.goal > 0 && progress.value >= progress.goal;
  return (
    <div className={compact ? "" : "sm:max-w-md"}>
      <div className="card-pad">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{progress.label}</div>
          <div className="text-sm font-semibold tabular-nums text-gray-900">{progress.text}</div>
        </div>
        <div
          className="mt-2 h-2.5 overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          aria-label={progress.label}
          aria-valuemin={0}
          aria-valuemax={progress.goal}
          aria-valuenow={progress.value}
        >
          <div
            className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : "bg-brand-600"}`}
            style={{ width: `${share * 100}%` }}
          />
        </div>
        {progress.hint && <div className="mt-1.5 text-xs text-gray-500">{progress.hint}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ celebrations ------------------------------ */

/** Remembered per browser, so the confetti plays once per person, not every visit. */
function alreadyCelebrated(key: string): boolean {
  try {
    return window.localStorage.getItem(`tacon-celebrated:${key}`) === "1";
  } catch {
    return false;
  }
}

function markCelebrated(key: string) {
  try {
    window.localStorage.setItem(`tacon-celebrated:${key}`, "1");
  } catch {
    // Private windows can refuse storage; the confetti may just play again.
  }
}

const CONFETTI_COLORS = ["#f59e0b", "#10b981", "#3b82f6", "#ec4899", "#8b5cf6", "#ef4444"];

function CelebrateView({ celebrate }: { celebrate: ViewCelebrate }) {
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (alreadyCelebrated(celebrate.key)) return;
    markCelebrated(celebrate.key);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setBurst(true);
    const timer = window.setTimeout(() => setBurst(false), 3200);
    return () => window.clearTimeout(timer);
  }, [celebrate.key]);

  return (
    <div className="card-pad flex items-center gap-3 border-amber-200 bg-amber-50">
      <PartyPopper className="h-6 w-6 shrink-0 text-amber-600" aria-hidden="true" />
      <p className="font-semibold text-amber-900">{celebrate.text}</p>
      {burst && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
          <style>{`@keyframes tacon-confetti{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(720deg)}}`}</style>
          {Array.from({ length: 90 }, (_, index) => (
            <span
              key={index}
              style={{
                position: "absolute",
                top: 0,
                left: `${(index * 37) % 100}%`,
                width: 8,
                height: 12,
                background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                borderRadius: 2,
                animation: `tacon-confetti ${1.8 + ((index * 13) % 12) / 10}s ${((index * 7) % 10) / 10}s linear forwards`,
                transform: "translateY(-10vh)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- forms ---------------------------------- */

function FormView({ form, target }: { form: ViewForm; target: RenderTarget }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      apiPost(`/tacons/view/${target.installId}/submit`, {
        page: target.page,
        panel: target.panel,
        position: target.position,
        index: form.index,
        values,
        ...(form.confirmCode ? { code } : {}),
      }),
    onSuccess: () => {
      setValues({});
      setCode("");
      setError(null);
      setSaved(true);
      target.onChanged();
      window.setTimeout(() => setSaved(false), 2500);
    },
    onError: (submitError: Error) => setError(submitError.message),
  });

  const set = (name: string, value: unknown) =>
    setValues((current) => ({ ...current, [name]: value }));

  return (
    <div className="card-pad">
      <h3 className="font-semibold text-gray-900">{form.title}</h3>
      {!form.allowed && form.deniedReason && (
        <p className="mt-1 text-sm text-gray-500">{form.deniedReason}</p>
      )}
      {form.allowed && (
        <>
          {error && (
            <div className="mt-3">
              <Banner tone="error">{error}</Banner>
            </div>
          )}
          {saved && (
            <div className="mt-3">
              <Banner tone="success">Saved.</Banner>
            </div>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {form.fields.map((field) => (
              <Field
                key={field.name}
                label={
                  <>
                    {field.label}
                    {field.required && <span className="ml-1 text-red-500">*</span>}
                  </>
                }
                wide={field.type === "longtext"}
              >
                {field.type === "longtext" ? (
                  <textarea
                    className="input min-h-[80px]"
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => set(field.name, event.target.value)}
                  />
                ) : field.choices ? (
                  <select
                    className="input"
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => set(field.name, event.target.value)}
                  >
                    <option value="">{field.choices.length === 0 ? "Nothing to pick yet" : "Pick one"}</option>
                    {field.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "choice" ? (
                  <select
                    className="input"
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => set(field.name, event.target.value)}
                  >
                    <option value="">Pick one</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === "person" ? (
                  <select
                    className="input"
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => set(field.name, event.target.value)}
                  >
                    <option value="">Pick a person</option>
                    {target.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                ) : field.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={values[field.name] === true}
                      onChange={(event) => set(field.name, event.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600"
                    />
                    Yes
                  </label>
                ) : (
                  <input
                    className="input"
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    value={String(values[field.name] ?? "")}
                    onChange={(event) => set(field.name, event.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
          {form.confirmCode && (
            <div className="mt-3 max-w-xs">
              <label className="label" htmlFor={`tacon-code-${form.index}`}>
                Your six-digit confirmation code
              </label>
              <input
                id={`tacon-code-${form.index}`}
                className="input tracking-widest"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <p className="hint">The private code from your profile. It confirms this is really you.</p>
            </div>
          )}
          <div className="mt-4">
            <button
              onClick={() => {
                if (form.confirmCode && code.length !== 6) {
                  setError("Type your six-digit confirmation code first.");
                  return;
                }
                if (form.confirm && !window.confirm(form.confirm)) return;
                submit.mutate();
              }}
              disabled={submit.isPending}
              className="btn-primary"
            >
              {submit.isPending && <Spinner />} {form.submitLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

/* -------------------------------- buttons --------------------------------- */

function ButtonView({
  label,
  confirm,
  index,
  allowed,
  target,
}: {
  label: string;
  confirm: string | null;
  index: number;
  allowed: boolean;
  target: RenderTarget;
}) {
  const [notices, setNotices] = useState<string[]>([]);

  const run = useMutation({
    mutationFn: () =>
      apiPost<{ notices: string[] }>(`/tacons/view/${target.installId}/run`, {
        page: target.page,
        panel: target.panel,
        position: target.position,
        index,
      }),
    onSuccess: (result) => {
      setNotices(result.notices ?? []);
      target.onChanged();
    },
  });

  return (
    <div>
      <button
        className="btn-secondary"
        disabled={!allowed || run.isPending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          run.mutate();
        }}
      >
        {run.isPending && <Spinner />} {label}
      </button>
      {notices.map((notice, index_) => (
        <p key={index_} className="mt-2 text-sm text-gray-600">
          {notice}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------ the whole view ---------------------------- */

export function TaconViewBody({ view, onChanged }: { view: TaconView; onChanged: () => void }) {
  return (
    <Widgets
      widgets={view.widgets}
      target={{
        installId: view.install.id,
        page: view.page.name,
        people: view.people,
        onChanged,
      }}
    />
  );
}
