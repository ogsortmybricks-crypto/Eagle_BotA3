import { type ReactNode } from "react";

/**
 * Form primitives for the settings page.
 *
 * Every setting gets a one-line explanation of what changes when you flip it.
 * A governance tool full of unexplained switches is how a studio ends up with
 * rules nobody chose, which is the failure mode this whole app exists to fix.
 */

export function SettingCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="card">
      <header className="border-b border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </header>
      <div className="divide-y divide-gray-100">{children}</div>
      {footer && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 p-4">
          {footer}
        </div>
      )}
    </section>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 p-4 ${
        disabled ? "opacity-60" : "cursor-pointer hover:bg-gray-50/70"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="min-w-0 text-sm">
        <span className="font-medium text-gray-900">{label}</span>
        <span className="mt-0.5 block text-gray-500">{hint}</span>
        {disabled && disabledReason && (
          <span className="mt-1 block text-xs text-amber-700">{disabledReason}</span>
        )}
      </span>
    </label>
  );
}

export function FieldRow({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`p-4 ${wide ? "" : "sm:flex sm:items-start sm:gap-4"}`}>
      <div className={wide ? "mb-2" : "min-w-0 flex-1"}>
        <div className="text-sm font-medium text-gray-900">{label}</div>
        {hint && <div className="mt-0.5 text-sm text-gray-500">{hint}</div>}
      </div>
      <div className={wide ? "" : "mt-2 shrink-0 sm:mt-0 sm:w-56"}>{children}</div>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        className="input"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
      {suffix && <span className="shrink-0 text-sm text-gray-500">{suffix}</span>}
    </div>
  );
}

export function SelectInput<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      className="input"
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
