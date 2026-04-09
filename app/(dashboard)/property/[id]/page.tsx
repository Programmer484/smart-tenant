"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { PropertyRecord, PropertyLinks, AiInstructions } from "@/lib/property";
import { DEFAULT_AI_INSTRUCTIONS, DEFAULT_LINKS, resolveAiInstructions } from "@/lib/property";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { Question } from "@/lib/question";
import RulesSection from "@/app/components/RulesSection";
import { PropertyEditorSkeleton } from "@/app/components/Skeleton";
import { ConfirmDialog } from "@/app/components/ConfirmDialog";
import { RuleProposalModal, type Proposal } from "@/app/components/RuleProposalModal";
import { validateLandlordFieldId, validateLandlordFieldLabel, FIELD_VALUE_KINDS, type FieldValueKind, normalizeEnumOptions, validateEnumOptions } from "@/lib/landlord-field";

const TABS = ["Fields", "Questions", "Rules", "Links", "AI Behavior"] as const;
type Tab = (typeof TABS)[number];

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function migrateRules(rawRules: any[]): LandlordRule[] {
  return rawRules.map((r) => {
    if (r.action) return r as LandlordRule;
    return {
      id: r.id || generateId(),
      action: "reject",
      conditions: [{
        id: generateId(),
        fieldId: r.fieldId || "",
        operator: r.operator || "==",
        value: r.value || ""
      }]
    };
  });
}

// ─── Field Editor ───────────────────────────────────────────────────

function labelToFieldId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40);
}

function FieldEditor({
  field,
  onChange,
  onDelete,
}: {
  field: LandlordField & { _isNew?: boolean };
  onChange: (f: LandlordField) => void;
  onDelete: () => void;
}) {
  const isLocked = !field._isNew;

  function handleLabelChange(newLabel: string) {
    const updated = { ...field, label: newLabel };
    if (!isLocked) {
      const prevAutoId = labelToFieldId(field.label || "");
      if (!field.id || field.id === prevAutoId) {
         updated.id = labelToFieldId(newLabel);
      }
    }
    onChange(updated);
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="text"
            value={field.id}
            readOnly={isLocked}
            onChange={(e) => {
              if (!isLocked) onChange({ ...field, id: e.target.value.replace(/[^a-z0-9_]/g, "") })
            }}
            placeholder="field_id"
            title={isLocked ? "Field ID is locked to prevent breaking existing rules." : "Field ID (used in rules)"}
            className={`w-32 rounded-lg border px-3 py-2 text-xs font-mono focus:outline-none ${
              isLocked
                ? "bg-foreground/5 border-transparent text-foreground/50 cursor-not-allowed"
                : "bg-[#f7f9f8] border-foreground/10 text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white"
            }`}
          />
          <input
            type="text"
            value={field.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Label (e.g. Number of adults)"
            className="flex-1 min-w-[150px] rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none"
          />
          <select
            value={field.value_kind}
            onChange={(e) => {
              const k = e.target.value as FieldValueKind;
              const next = { ...field, value_kind: k };
              if (k === "enum") {
                next.options = field.options?.length ? [...field.options] : ["", ""];
              } else {
                delete next.options;
              }
              onChange(next);
            }}
            className="w-28 rounded-lg border border-foreground/10 bg-background px-3 py-2 text-sm text-foreground focus:border-foreground/25 focus:outline-none"
          >
            {FIELD_VALUE_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete field"
          className="mt-1 shrink-0 rounded-lg p-1.5 text-red-400/70 hover:bg-red-50 hover:text-red-500 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {field.value_kind === "enum" && (
        <div className="flex flex-col gap-2 pt-1 border-t border-foreground/5 mt-1">
          <span className="text-xs text-foreground/50">Answer choices (at least two)</span>
          <ul className="flex list-none flex-col gap-2 p-0 m-0">
            {(field.options ?? ["", ""]).map((opt, optIdx) => (
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
                  className="min-w-0 flex-1 rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/35 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700/20"
                />
                <button
                  type="button"
                  disabled={(field.options ?? []).length <= 1}
                  onClick={() => {
                    const opts = (field.options ?? []).filter((_, j) => j !== optIdx);
                    onChange({ ...field, options: opts.length ? opts : [""] });
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
            onClick={() => onChange({ ...field, options: [...(field.options ?? []), ""] })}
            className="self-start text-xs text-foreground/50 underline-offset-2 hover:text-foreground/75 hover:underline"
          >
            + Add choice
          </button>
          {validateEnumOptions(field.options) && (
            <p className="text-xs text-red-500">{validateEnumOptions(field.options)}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Question Editor ────────────────────────────────────────────────

function QuestionEditor({
  question,
  fields,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  question: Question;
  fields: LandlordField[];
  onChange: (q: Question) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-foreground/10 bg-background p-4 shadow-sm">
      {/* Reorder controls */}
      <div className="flex flex-col items-center gap-0.5 pt-1 text-foreground/30">
        <button type="button" onClick={onMoveUp} disabled={isFirst} className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none" className="opacity-40">
          <circle cx="3" cy="3" r="1" fill="currentColor" />
          <circle cx="7" cy="3" r="1" fill="currentColor" />
          <circle cx="3" cy="7" r="1" fill="currentColor" />
          <circle cx="7" cy="7" r="1" fill="currentColor" />
          <circle cx="3" cy="11" r="1" fill="currentColor" />
          <circle cx="7" cy="11" r="1" fill="currentColor" />
        </svg>
        <button type="button" onClick={onMoveDown} disabled={isLast} className="rounded p-0.5 transition-colors hover:text-foreground/70 disabled:opacity-20">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        {/* Question text */}
        <input
          type="text"
          value={question.text}
          onChange={(e) => onChange({ ...question, text: e.target.value })}
          placeholder="Question text (e.g. How many people will live here?)"
          className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none"
        />

        {/* Linked fields */}
        <details className="group" open={question.fieldIds.length === 0}>
          <summary className="cursor-pointer select-none text-[11px] text-foreground/45 hover:text-foreground/60 transition-colors flex items-center gap-1">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="transition-transform group-open:rotate-90">
              <path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Linked fields
            {question.fieldIds.length > 0 && (
              <span className="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">
                {question.fieldIds.length} selected
              </span>
            )}
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5 pl-1.5">
            {fields.map((f) => {
              const isLinked = question.fieldIds.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    const next = isLinked
                      ? question.fieldIds.filter((fid) => fid !== f.id)
                      : [...question.fieldIds, f.id];
                    onChange({ ...question, fieldIds: next });
                  }}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors border ${
                    isLinked
                      ? "border-teal-700/30 bg-teal-50 text-teal-700"
                      : "border-foreground/10 text-foreground/40 hover:border-foreground/20 hover:text-foreground/60"
                  }`}
                >
                  {f.label || f.id}
                </button>
              );
            })}
            {fields.length === 0 && (
              <span className="text-xs text-foreground/35 italic">Add fields first</span>
            )}
          </div>
        </details>

        {/* Extract hint (collapsible) */}
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-foreground/35 hover:text-foreground/50 transition-colors">
            <span className="ml-1">Extraction hint (optional)</span>
          </summary>
          <input
            type="text"
            value={question.extract_hint || ""}
            onChange={(e) => onChange({ ...question, extract_hint: e.target.value || undefined })}
            placeholder="e.g. If they say 'a couple', extract num_adults=2"
            className="mt-1.5 w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-xs text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none"
          />
        </details>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete question"
        className="mt-1 shrink-0 rounded-lg p-1.5 text-red-400/70 hover:bg-red-50 hover:text-red-500 transition-colors"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M5 4V2.5A1.5 1.5 0 0 1 6.5 1h3A1.5 1.5 0 0 1 11 2.5V4m2 0-.75 9A1.5 1.5 0 0 1 10.75 14.5h-5.5A1.5 1.5 0 0 1 3.75 13L3 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.5 7v4M9.5 7v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function PropertySetupPage() {
  const { id } = useParams<{ id: string }>();
  const supabase = createClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<LandlordField[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [rules, setRules] = useState<LandlordRule[]>([]);
  const [links, setLinks] = useState<PropertyLinks>(DEFAULT_LINKS);
  const [aiInstructions, setAiInstructions] = useState<AiInstructions>(DEFAULT_AI_INSTRUCTIONS);

  const [activeTab, setActiveTab] = useState<Tab>("Questions");
  const [loadingPhase, setLoadingPhase] = useState<null | "questions" | "rules">(null);
  const [saving, setSaving] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedRef] = useState(() => ({ current: "" }));
  const [questionsPrompt, setQuestionsPrompt] = useState("");
  const [rulesPrompt, setRulesPrompt] = useState("");
  const [ruleProposal, setRuleProposal] = useState<Proposal | null>(null);

  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

  // ── Load property ──
  useEffect(() => {
    async function load() {
      const propRes = await supabase
        .from("properties")
        .select("*")
        .eq("id", id)
        .single();

      if (propRes.error || !propRes.data) {
        setError("Property not found.");
        setPageLoading(false);
        return;
      }

      const p = propRes.data as PropertyRecord;
      setTitle(p.title);
      setDescription(p.description);
      setFields((p.fields as LandlordField[]) ?? []);
      setQuestions((p.questions as Question[]) ?? []);
      const migratedRules = migrateRules((p.rules as any[]) ?? []);
      setRules(migratedRules);
      setLinks({ ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) });
      setAiInstructions(resolveAiInstructions(p.ai_instructions));

      lastSavedRef.current = JSON.stringify({
        title: p.title, description: p.description,
        fields: (p.fields as LandlordField[]) ?? [],
        questions: (p.questions as Question[]) ?? [],
        rules: migratedRules, links: { ...DEFAULT_LINKS, ...(p.links as Partial<PropertyLinks>) },
        aiInstructions: resolveAiInstructions(p.ai_instructions),
      });
      setPageLoading(false);
    }
    void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dirty tracking ──
  useEffect(() => {
    if (pageLoading) return;
    const current = JSON.stringify({ title, description, fields, questions, rules, links, aiInstructions });
    setDirty(current !== lastSavedRef.current);
  }, [title, description, fields, questions, rules, links, aiInstructions, pageLoading, lastSavedRef]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) { e.preventDefault(); }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ── Save ──
  const save = useCallback(
    async (overrides?: Partial<PropertyRecord>) => {
      setSaving(true);
      const { error } = await supabase
        .from("properties")
        .update({
          title: title.trim() || "New Property",
          description: description.trim(),
          fields,
          questions,
          rules,
          links,
          ai_instructions: aiInstructions,
          updated_at: new Date().toISOString(),
          ...overrides,
        })
        .eq("id", id);
      setSaving(false);
      if (error) { console.error("[save]", error); toast.error("Failed to save"); }
      else {
        lastSavedRef.current = JSON.stringify({ title, description, fields, questions, rules, links, aiInstructions });
        setDirty(false);
        toast.success("Property saved");
      }
    },
    [id, title, description, fields, questions, rules, links, aiInstructions, supabase], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Generate questions with prompt ──
  async function handleGenerateQuestions(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what questions to generate");
      return;
    }
    try {
      setLoadingPhase("questions");
      const res = await fetch("/api/generate-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: prompt,
          existingFields: fields.map((f) => ({ id: f.id, label: f.label })),
          existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
        }),
      });
      const data = (await res.json()) as {
        fields?: LandlordField[];
        questions?: Question[];
      };
      const newFields = data.fields ?? [];
      const newQuestions = data.questions ?? [];

      if (newFields.length > 0) {
        setFields((prev) => [...prev, ...newFields.map(f => ({ ...f, _isNew: true, _clientId: generateId() }))]);
      }
      if (newQuestions.length > 0) {
        const startOrder = questions.length;
        const ordered = newQuestions.map((q, i) => ({
          ...q,
          sort_order: startOrder + i,
        }));
        setQuestions((prev) => [...prev, ...ordered]);
      }

      if (newQuestions.length === 0 && newFields.length === 0) {
        toast.info("No new items to add — AI found everything is covered.");
      } else {
        const parts: string[] = [];
        if (newFields.length > 0) parts.push(`${newFields.length} field${newFields.length !== 1 ? "s" : ""}`);
        if (newQuestions.length > 0) parts.push(`${newQuestions.length} question${newQuestions.length !== 1 ? "s" : ""}`);
        toast.success(`Added ${parts.join(" + ")}`);
      }
    } catch (err) {
      console.error("[generateQuestions]", err);
      toast.error("Generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  // ── Generate rules with prompt ──
  async function handleGenerateRules(prompt: string) {
    if (!prompt.trim()) {
      toast.error("Enter a prompt describing what rules to generate");
      return;
    }
    if (fields.length === 0) {
      toast.error("Add fields first so rules can reference them");
      return;
    }
    try {
      setLoadingPhase("rules");
      const res = await fetch("/api/generate-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: prompt,
          fields,
          existingRules: rules,
        }),
      });
      const data = (await res.json()) as {
        newRules?: LandlordRule[];
        modifiedRules?: LandlordRule[];
        deletedRuleIds?: string[];
        missingFields?: LandlordField[];
      };

      const newRules = migrateRules(data.newRules ?? []);
      const modifiedRules = migrateRules(data.modifiedRules ?? []);
      const deletedRuleIds = data.deletedRuleIds ?? [];

      // If the AI flagged missing fields, orchestration needed
      if (data.missingFields && data.missingFields.length > 0) {
        toast.info("Analyzing missing fields...");
        const missingFieldsDesc = data.missingFields.map(f => `${f.label || f.id} (type: ${f.value_kind})`).join(", ");
        const res2 = await fetch("/api/generate-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
             description: `We are building a new rule that requires these new fields: ${missingFieldsDesc}. We must ask questions to collect them. Either modify an existing question to include these fields, or generate new questions.`,
             existingFields: fields.map((f) => ({ id: f.id, label: f.label })),
             existingQuestions: questions.map((q) => ({ id: q.id, text: q.text, fieldIds: q.fieldIds })),
          })
        });
        const data2 = await res2.json();
        
        setRuleProposal({
           newRules,
           modifiedRules,
           deletedRuleIds,
           missingFields: data.missingFields,
           proposedQuestions: data2.questions || []
        });
        return;
      }

      // No missing fields
      setRuleProposal({
        newRules,
        modifiedRules,
        deletedRuleIds,
        missingFields: [],
        proposedQuestions: []
      });

    } catch (err) {
      console.error("[generateRules]", err);
      toast.error("Rule generation failed — please try again");
    } finally {
      setLoadingPhase(null);
    }
  }

  function applyProposal() {
    if (!ruleProposal) return;
    
    // Add missing fields
    if (ruleProposal.missingFields.length > 0) {
      setFields((prev) => [...prev, ...ruleProposal.missingFields.map(f => ({ ...f, _isNew: true, _clientId: generateId() }) as unknown as LandlordField)]);
    }
    
    // Process proposed questions (update if exists, append if new)
    if (ruleProposal.proposedQuestions.length > 0) {
      setQuestions((prev) => {
        const next = [...prev];
        const newQs: Question[] = [];
        for (const pq of ruleProposal.proposedQuestions) {
          const idx = next.findIndex(q => q.id === pq.id);
          if (idx >= 0) {
            next[idx] = { ...next[idx], text: pq.text, fieldIds: Array.from(new Set([...next[idx].fieldIds, ...pq.fieldIds])) };
          } else {
            newQs.push(pq);
          }
        }
        if (newQs.length > 0) {
           const startOrder = next.length;
           return [...next, ...newQs.map((q, i) => ({ ...q, sort_order: startOrder + i }))];
        }
        return next;
      });
    }
    
    // Add / Update / Delete rules
    setRules((prev) => {
      let next = [...prev];
      if (ruleProposal.deletedRuleIds.length > 0) {
        next = next.filter(r => !ruleProposal.deletedRuleIds.includes(r.id));
      }
      if (ruleProposal.modifiedRules.length > 0) {
        for (const mod of ruleProposal.modifiedRules) {
          const idx = next.findIndex(r => r.id === mod.id);
          if (idx >= 0) {
            next[idx] = mod;
          }
        }
      }
      if (ruleProposal.newRules.length > 0) {
        next = [...next, ...ruleProposal.newRules];
      }
      return next;
    });

    const changesCount = ruleProposal.newRules.length + ruleProposal.modifiedRules.length + ruleProposal.deletedRuleIds.length;
    toast.success(`Applied ${changesCount} rule change(s)`);
    setRuleProposal(null);
  }

  // ── Field helpers ──
  function addField() {
    setFields((prev) => [
      ...prev,
      { id: "", label: "", value_kind: "text", _isNew: true, _clientId: generateId() } as unknown as LandlordField,
    ]);
  }

  function updateField(index: number, updated: LandlordField) {
    setFields((prev) => prev.map((f, i) => (i === index ? updated : f)));
  }

  function deleteField(index: number) {
    const field = fields[index];
    // Remove field references from questions
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        fieldIds: q.fieldIds.filter((fid) => fid !== field.id),
      })),
    );
    // Remove rules referencing this field
    setRules((prev) =>
      prev.filter((r) => !r.conditions.some((c) => c.fieldId === field.id)),
    );
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Question helpers ──
  function addQuestion() {
    setQuestions((prev) => [
      ...prev,
      { id: `q_${generateId()}`, text: "", fieldIds: [], sort_order: prev.length },
    ]);
  }

  function updateQuestion(index: number, updated: Question) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? updated : q)));
  }

  function deleteQuestion(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  function moveQuestion(from: number, to: number) {
    setQuestions((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next.map((q, i) => ({ ...q, sort_order: i }));
    });
  }

  // ── Rendering ──

  if (pageLoading) return <PropertyEditorSkeleton />;
  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const isNew = !description.trim() && fields.length === 0 && questions.length === 0 && rules.length === 0;

  async function copyShareLink() {
    const url = `${window.location.origin}/chat/${id}`;
    await navigator.clipboard.writeText(url);
    toast.success("Chat link copied — share it with applicants");
  }

  return (
    <>
      {/* ── Sticky sub-header ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-black/8 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Link href="/" className="shrink-0 text-[#1a2e2a]/45 transition-colors hover:text-[#1a2e2a]">
              Properties
            </Link>
            <span className="text-[#1a2e2a]/20">/</span>
            <span className="truncate font-medium text-[#1a2e2a]">
              {title || "Untitled"}
            </span>
            <span className="ml-1 text-xs text-[#1a2e2a]/30">
              {fields.length} field{fields.length !== 1 ? "s" : ""} · {questions.length} question{questions.length !== 1 ? "s" : ""} · {rules.length} rule{rules.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => void copyShareLink()} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-[#1a2e2a]/50 transition-colors hover:bg-[#f7f9f8] hover:text-[#1a2e2a]">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M10.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM4.5 5h-1a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v0a2 2 0 0 0-2-2ZM5 7h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Share link
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${dirty
                ? "border-teal-700/30 bg-teal-50 text-teal-800 hover:bg-teal-100"
                : "border-black/10 text-[#1a2e2a]/50 hover:bg-[#f7f9f8]"
                }`}
            >
              {saving ? "Saving…" : dirty ? "Save*" : "Save"}
            </button>
            <button
              type="button"
              onClick={async () => { await save(); window.open(`/chat/${id}`, "_blank"); }}
              className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              Preview →
            </button>
          </div>
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">

        {/* Onboarding guide */}
        {isNew && (
          <section className="rounded-xl border border-teal-200 bg-teal-50/60 p-5">
            <h2 className="text-sm font-semibold text-teal-900">Quick setup</h2>
            <ol className="mt-2 space-y-1.5 text-sm text-teal-800/70">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">1</span>
                Name your property and paste the listing description below
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">2</span>
                Define <strong>fields</strong> (data to collect), then create <strong>questions</strong> linked to those fields
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 text-[10px] font-bold text-white">3</span>
                Add <strong>rules</strong> for auto-rejection or acceptance profiles, then <strong>Save</strong> &amp; <strong>Share link</strong>
              </li>
            </ol>
          </section>
        )}

        {/* Property details card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          <div className="space-y-4 p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a2e2a]/40">
              Property details
            </h2>
            <input
              type="text"
              placeholder="Property title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-2.5 text-base font-semibold text-foreground placeholder:font-normal placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
            <textarea
              ref={descRef}
              placeholder="Describe your property — rent, rules, requirements, pet policy, lease length, etc."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[120px] w-full resize-none overflow-hidden rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
            />
          </div>
        </section>

        {/* Configuration card */}
        <section className="rounded-xl border border-black/8 bg-white shadow-sm">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-black/5 px-6 pt-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => {
                  if (activeTab === "Fields" && tab !== "Fields") {
                    setFields(prev => prev.filter(f => f.id.trim() !== "" || f.label.trim() !== ""));
                  }
                  setActiveTab(tab);
                }}
                className={`px-3 py-3 text-sm font-medium transition-colors ${activeTab === tab
                  ? "border-b-2 border-teal-700 text-teal-700"
                  : "text-foreground/45 hover:text-foreground/70"
                  }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* ── Fields Tab ── */}
            {activeTab === "Fields" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Data schema</h3>
                  <p className="text-xs text-foreground/40">
                    Define the data fields you want to collect. Rules evaluate these fields. Questions collect them.
                  </p>
                </div>

                <div className="space-y-2">
                  {fields.map((f, i) => (
                    <FieldEditor
                      key={(f as any)._clientId || f.id + i}
                      field={f}
                      onChange={(updated) => updateField(i, updated)}
                      onDelete={() => deleteField(i)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addField}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Add field
                </button>
              </div>
            )}

            {/* ── Questions Tab ── */}
            {activeTab === "Questions" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-foreground/80">Interview flow</h3>
                  <p className="text-xs text-foreground/40">
                    Ordered questions asked to applicants. Each question collects one or more fields. Toggle field chips to link them.
                  </p>
                </div>

                {/* Generate prompt */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={questionsPrompt}
                    onChange={(e) => setQuestionsPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !loadingPhase && questionsPrompt.trim()) {
                        e.preventDefault();
                        void handleGenerateQuestions(questionsPrompt).then(() => setQuestionsPrompt(""));
                      }
                    }}
                    placeholder="e.g. Ask about number of occupants, pets, income, and move-in date"
                    className="flex-1 rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                  />
                  <button
                    type="button"
                    onClick={() => void handleGenerateQuestions(questionsPrompt).then(() => setQuestionsPrompt(""))}
                    disabled={!questionsPrompt.trim() || loadingPhase !== null}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-40"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                    {loadingPhase === "questions" ? "Generating…" : "Generate"}
                  </button>
                </div>

                {/* Question list */}
                <div className="space-y-2">
                  {questions.map((q, i) => (
                    <QuestionEditor
                      key={q.id}
                      question={q}
                      fields={fields}
                      onChange={(updated) => updateQuestion(i, updated)}
                      onDelete={() => deleteQuestion(i)}
                      onMoveUp={() => moveQuestion(i, i - 1)}
                      onMoveDown={() => moveQuestion(i, i + 1)}
                      isFirst={i === 0}
                      isLast={i === questions.length - 1}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addQuestion}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-foreground/20 px-4 py-2 text-sm text-foreground/50 transition-colors hover:border-foreground/40 hover:text-foreground/70"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  Add question
                </button>
              </div>
            )}

            {/* ── Rules Tab ── */}
            {activeTab === "Rules" && (
              <div className="space-y-6">
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-foreground/40">
                    Describe what rules to create — e.g. rejection criteria or acceptance profiles.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={rulesPrompt}
                      onChange={(e) => setRulesPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !loadingPhase && rulesPrompt.trim()) {
                          e.preventDefault();
                          void handleGenerateRules(rulesPrompt).then(() => setRulesPrompt(""));
                        }
                      }}
                      placeholder="e.g. Reject smokers. Allow max 2 adults, or 3 if family with child."
                      className="flex-1 rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleGenerateRules(rulesPrompt).then(() => setRulesPrompt(""))}
                      disabled={!rulesPrompt.trim() || loadingPhase !== null || fields.length === 0}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-100 disabled:opacity-40"
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M7 1v3M7 10v3M1 7h3M10 7h3M2.75 2.75l2.12 2.12M9.13 9.13l2.12 2.12M11.25 2.75l-2.12 2.12M4.87 9.13l-2.12 2.12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                      {loadingPhase === "rules" ? "Generating…" : "Generate"}
                    </button>
                  </div>
                </div>
                <RulesSection
                  fields={fields}
                  rules={rules}
                  onChange={setRules}
                />
              </div>
            )}

            {/* ── Links Tab ── */}
            {activeTab === "Links" && (
              <div className="space-y-5">
                <p className="text-sm text-foreground/60">
                  Shared with qualified applicants at the end of the screening.
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Video tour link</label>
                  <input type="url" placeholder="https://…" value={links.videoUrl} onChange={(e) => setLinks((prev) => ({ ...prev, videoUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground/60">Booking link</label>
                  <input type="url" placeholder="https://…" value={links.bookingUrl} onChange={(e) => setLinks((prev) => ({ ...prev, bookingUrl: e.target.value }))} className="w-full rounded-lg border border-foreground/10 bg-[#f7f9f8] px-3 py-2 text-sm focus:border-teal-700/40 focus:bg-white focus:outline-none" />
                </div>
              </div>
            )}

            {/* ── AI Behavior Tab ── */}
            {activeTab === "AI Behavior" && (
              <div className="space-y-6">
                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
                  <h3 className="text-sm font-medium text-foreground/80">Conversation controls</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground/60">Off-topic limit</label>
                      <p className="text-[11px] text-foreground/35">Consecutive off-topic messages before auto-rejection. 0 = unlimited.</p>
                      <input type="number" min={0} value={aiInstructions.offTopicLimit ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, offTopicLimit: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground/60">Post-qualified follow-ups</label>
                      <p className="text-[11px] text-foreground/35">Messages allowed after qualification. 0 = close immediately.</p>
                      <input type="number" min={0} value={aiInstructions.qualifiedFollowUps ?? 3} onChange={(e) => setAiInstructions((prev) => ({ ...prev, qualifiedFollowUps: Math.max(0, parseInt(e.target.value) || 0) }))} className="w-24 rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Unknown info handling</label>
                    <p className="text-[11px] text-foreground/35">When an applicant asks about something not in the description.</p>
                    <div className="flex gap-4 pt-1">
                      <label className="flex items-center gap-2 text-sm text-foreground/70">
                        <input type="radio" name="unknownInfo" checked={(aiInstructions.unknownInfoBehavior ?? "deflect") === "deflect"} onChange={() => setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "deflect" }))} className="accent-teal-700" />
                        Say &quot;I don&apos;t know, contact landlord&quot;
                      </label>
                      <label className="flex items-center gap-2 text-sm text-foreground/70">
                        <input type="radio" name="unknownInfo" checked={aiInstructions.unknownInfoBehavior === "ignore"} onChange={() => setAiInstructions((prev) => ({ ...prev, unknownInfoBehavior: "ignore" }))} className="accent-teal-700" />
                        Redirect to screening
                      </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-5">
                  <h3 className="text-sm font-medium text-foreground/80">Eligibility responses</h3>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">First concern (clarification)</label>
                    <p className="text-[11px] text-foreground/35">How the AI should respond when an applicant first fails a rule.</p>
                    <textarea rows={2} value={aiInstructions.clarificationPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, clarificationPrompt: e.target.value }))} placeholder="e.g. Let the applicant know their answer doesn't meet the requirement and give them a chance to correct it." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground/60">Confirmed rejection</label>
                    <p className="text-[11px] text-foreground/35">How the AI should respond when an applicant still fails after clarification.</p>
                    <textarea rows={2} value={aiInstructions.rejectionPrompt} onChange={(e) => setAiInstructions((prev) => ({ ...prev, rejectionPrompt: e.target.value }))} placeholder="e.g. Let the applicant know they don't meet the requirement, state the reason, and close the conversation." className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:outline-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground/80">Style instructions</label>
                  <p className="text-xs text-foreground/40">Tell the AI how to behave — tone, formatting, how to handle specific situations.</p>
                  <textarea rows={5} value={aiInstructions.style} onChange={(e) => setAiInstructions((prev) => ({ ...prev, style: e.target.value }))} placeholder="e.g. Be concise. Use a friendly but professional tone." className="w-full resize-none rounded-lg border border-foreground/10 bg-[#f7f9f8] px-4 py-3 text-sm text-foreground placeholder:text-foreground/30 focus:border-teal-700/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-700/20" />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium text-foreground/80">Example conversations</label>
                      <p className="text-xs text-foreground/40">Show the AI how you want it to respond in specific scenarios.</p>
                    </div>
                    <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: [...(prev.examples ?? []), { user: "", assistant: "" }] }))} className="text-sm text-teal-700 hover:underline">
                      + Add example
                    </button>
                  </div>
                  {(aiInstructions.examples ?? []).length === 0 && (
                    <p className="text-sm text-foreground/30">No examples yet.</p>
                  )}
                  {(aiInstructions.examples ?? []).map((ex, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-foreground/8 bg-[#f7f9f8] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/35">Example {i + 1}</span>
                        <button type="button" onClick={() => setAiInstructions((prev) => ({ ...prev, examples: (prev.examples ?? []).filter((_, j) => j !== i) }))} className="text-xs text-foreground/30 hover:text-red-500">Remove</button>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">Tenant says:</label>
                        <input type="text" value={ex.user} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], user: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. Is the apartment pet-friendly?" className="w-full rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-foreground/50">AI should respond:</label>
                        <textarea rows={2} value={ex.assistant} onChange={(e) => { const next = [...(aiInstructions.examples ?? [])]; next[i] = { ...next[i], assistant: e.target.value }; setAiInstructions((prev) => ({ ...prev, examples: next })); }} placeholder="e.g. We do allow small pets with a $500 deposit. Do you have any pets?" className="w-full resize-none rounded-lg border border-foreground/10 bg-white px-3 py-2 text-sm focus:border-teal-700/40 focus:outline-none" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <RuleProposalModal
        open={!!ruleProposal}
        proposal={ruleProposal}
        existingRules={rules}
        existingQuestions={questions}
        onConfirm={applyProposal}
        onCancel={() => setRuleProposal(null)}
      />
    </>
  );
}
