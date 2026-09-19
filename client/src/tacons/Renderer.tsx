/**
 * Drawing a Tac-On.
 *
 * The server sends a finished view - strings, rows, fields - and this walks it.
 * There is no interpreter here and no Tac-On code in the browser: the widget
 * kinds below are the entire surface a Tac-On can paint with, which is what
 * makes installing one safe and what makes every Tac-On look like it belongs
 * in the app rather than like a page someone pasted in.
 */

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { apiDelete, apiPost } from "@/lib/api";
import { useDateFormat } from "@/lib/session";
import { Banner, Spinner } from "@/components/ui";
import type {
  TaconView,
  ViewForm,
  ViewList,
  ViewPerson,
  ViewWidget,
} from "@shared/tacons/view";

export type RenderTarget = {
  installId: number;
  /** One of these is set - a Tac-On page, or a panel on a base page. */
  page?: string;
  panel?: string;
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

    case "list":
      return <ListView list={widget} target={target} />;

    case "form":
      return <FormView form={widget} target={target} />;

    case "button":
      return <ButtonView label={widget.label} confirm={widget.confirm} index={widget.index} allowed={widget.allowed} target={target} />;
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
      {!list.problem && list.rows.length === 0 ? (
        <p className="card px-4 py-6 text-center text-sm text-gray-500">{list.empty}</p>
      ) : (
        !list.problem && (
          <div className="card scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left">
                  {list.columns.map((column) => (
                    <th key={column.key} className="px-3 py-2 font-semibold text-gray-700">
                      {column.label}
                    </th>
                  ))}
                  {list.rows.some((row) => row.canRemove) && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 last:border-0">
                    {list.columns.map((column) => (
                      <td key={column.key} className="px-3 py-2 align-top text-gray-700">
                        {cell(row.cells[column.key] ?? "", column.type)}
                      </td>
                    ))}
                    {list.rows.some((entry) => entry.canRemove) && (
                      <td className="px-2 py-2 text-right">
                        {row.canRemove && (
                          <button
                            onClick={() => remove.mutate(row.id)}
                            className="btn-ghost p-1.5"
                            aria-label="Remove row"
                            disabled={remove.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

/* --------------------------------- forms ---------------------------------- */

function FormView({ form, target }: { form: ViewForm; target: RenderTarget }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = useMutation({
    mutationFn: () =>
      apiPost(`/tacons/view/${target.installId}/submit`, {
        page: target.page,
        panel: target.panel,
        index: form.index,
        values,
      }),
    onSuccess: () => {
      setValues({});
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
          <div className="mt-4">
            <button
              onClick={() => submit.mutate()}
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
