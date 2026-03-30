"use client";

import { useState, useId } from "react";
import {
  FIELD_VALUE_KINDS,
  FieldValueKind,
  LandlordField,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  validateEnumOptions,
} from "@/lib/landlord-field";

const KIND_LABELS: Record<FieldValueKind, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  boolean: "Yes/No",
  enum: "Options",
};

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function emptyField(): LandlordField & { _key: string } {
  return {
    _key: generateId(),
    id: "",
    label: "",
    valueKind: "text",
    required: true,
  };
}

type FieldWithKey = LandlordField & { _key: string };

function FieldRow({
  field,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  field: FieldWithKey;
  index: number;
  total: number;
  onChange: (updated: FieldWithKey) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const uid = useId();
  const idError = field.id ? validateLandlordFieldId(field.id) : null;
  const labelError = field.label ? validateLandlordFieldLabel(field.label) : null;
  const enumOptionsError =
    field.valueKind === "enum"
      ? validateEnumOptions(field.options)
      : null;

  return (
    <div className="flex gap-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      {/* Reorder controls */}
      <div className="flex flex-col items-center gap-0.5 pt-1 text-foreground/30">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label="Move up"
          className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none" className="opacity-40">
          <circle cx="3" cy="3" r="1" fill="currentColor" />
          <circle cx="7" cy="3" r="1" fill="currentColor" />
          <circle cx="3" cy="7" r="1" fill="currentColor" />
          <circle cx="7" cy="7" r="1" fill="currentColor" />
          <circle cx="3" cy="11" r="1" fill="currentColor" />
          <circle cx="7" cy="11" r="1" fill="currentColor" />
        </svg>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          aria-label="Move down"
          className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Field content */}
      <div className="flex flex-1 flex-col gap-3">
        {/* Label */}
        <div>
          <input
            id={`${uid}-label`}
            type="text"
            value={field.label}
            onChange={(e) => onChange({ ...field, label: e.target.value })}
            placeholder="Question or label for this field…"
            className="w-full rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
          />
          {labelError && (
            <p className="mt-1 text-xs text-red-500">{labelError}</p>
          )}
        </div>

        {/* Id + Type + Required row */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={`${uid}-id`} className="text-xs text-foreground/50">
              Field Name
            </label>
            <input
              id={`${uid}-id`}
              type="text"
              value={field.id}
              onChange={(e) => onChange({ ...field, id: e.target.value })}
              placeholder="snake_case_name"
              className="w-full rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
            />
            {idError && (
              <p className="text-xs text-red-500">{idError}</p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${uid}-kind`} className="text-xs text-foreground/50">
              Type
            </label>
            <select
              id={`${uid}-kind`}
              value={field.valueKind}
              onChange={(e) => {
                const k = e.target.value as FieldValueKind;
                const next: FieldWithKey = { ...field, valueKind: k };
                if (k === "enum") {
                  next.options =
                    field.options?.length ? [...field.options] : ["", ""];
                } else {
                  delete next.options;
                }
                onChange(next);
              }}
              className="rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
            >
              {FIELD_VALUE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {/* Required toggle */}
          <div className="flex items-center gap-2 pb-2">
            <button
              type="button"
              role="switch"
              aria-checked={field.required ?? false}
              onClick={() => onChange({ ...field, required: !field.required })}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 ${
                field.required ? "bg-teal-700" : "bg-foreground/20"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  field.required ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-sm text-foreground/60">Required</span>
          </div>
        </div>

        {field.valueKind === "enum" ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-foreground/50">
              Answer choices (at least two)
            </span>
            <ul className="flex list-none flex-col gap-2 p-0">
              {(field.options ?? [""]).map((opt, optIdx) => (
                <li key={optIdx} className="flex gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => {
                      const opts = [...(field.options ?? [""])];
                      opts[optIdx] = e.target.value;
                      onChange({ ...field, options: opts });
                    }}
                    placeholder={`Choice ${optIdx + 1}`}
                    className="min-w-0 flex-1 rounded-lg border border-foreground/10 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/15"
                  />
                  <button
                    type="button"
                    disabled={(field.options ?? []).length <= 1}
                    onClick={() => {
                      const opts = (field.options ?? []).filter(
                        (_, j) => j !== optIdx,
                      );
                      onChange({
                        ...field,
                        options: opts.length ? opts : [""],
                      });
                    }}
                    className="shrink-0 rounded-lg px-2 text-xs text-foreground/45 transition-colors hover:text-red-500 disabled:opacity-25"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...field,
                  options: [...(field.options ?? []), ""],
                })
              }
              className="self-start text-xs text-foreground/50 underline-offset-2 hover:text-foreground/75 hover:underline"
            >
              + Add choice
            </button>
            {enumOptionsError ? (
              <p className="text-xs text-red-500">{enumOptionsError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete field"
        className="mt-1 shrink-0 rounded-lg p-1.5 text-red-400/70 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M2 4h12M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4m2 0-.75 9A1.5 1.5 0 0 1 10.75 14.5h-5.5A1.5 1.5 0 0 1 3.75 13L3 4"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default function LandlordFieldsSection({
  fields,
  onChange,
}: {
  fields: LandlordField[];
  onChange: (fields: LandlordField[]) => void;
}) {
  const [rows, setRows] = useState<FieldWithKey[]>(() =>
    fields.map((f) => ({ ...f, _key: generateId() }))
  );

  function update(next: FieldWithKey[]) {
    setRows(next);
    onChange(next.map(({ _key: _, ...f }) => f));
  }

  function handleChange(index: number, updated: FieldWithKey) {
    const next = [...rows];
    next[index] = updated;
    update(next);
  }

  function handleDelete(index: number) {
    update(rows.filter((_, i) => i !== index));
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const next = [...rows];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    update(next);
  }

  function handleMoveDown(index: number) {
    if (index === rows.length - 1) return;
    const next = [...rows];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    update(next);
  }

  function handleAdd() {
    update([...rows, emptyField()]);
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-medium tracking-tight text-foreground">
        Applicant fields
      </h2>

      {rows.length > 0 && (
        <div className="flex flex-col gap-3">
          {rows.map((field, i) => (
            <FieldRow
              key={field._key}
              field={field}
              index={i}
              total={rows.length}
              onChange={(updated) => handleChange(i, updated)}
              onDelete={() => handleDelete(i)}
              onMoveUp={() => handleMoveUp(i)}
              onMoveDown={() => handleMoveDown(i)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleAdd}
        className="self-start rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
      >
        + Add field
      </button>
    </section>
  );
}
