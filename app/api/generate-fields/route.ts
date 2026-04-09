import { NextResponse } from "next/server";
import {
  LandlordField,
  FIELD_VALUE_KINDS,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  normalizeEnumOptions,
  validateEnumOptions,
} from "@/lib/landlord-field";
import type { Question } from "@/lib/question";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";

const SYSTEM_PROMPT = `You are a rental application assistant. Given a landlord's prompt, generate the data FIELDS needed and the interview QUESTIONS to collect them.

IMPORTANT:
- The landlord will describe what they want to ask applicants.
- Your job is to create:
  1. Fields (data schema) — the atomic data points to store. First, define the most natural human-facing label. Then, derive a concise, descriptive snake_case ID from that label.
  2. Questions (interview flow) — the questions to ask tenants, each linked to one or more fields

RULES:
- A question CAN collect multiple fields (compound questions). For example, "Describe your household" could collect num_adults and num_children.
- Every field must be referenced by at least one question.
- Do NOT duplicate fields that already exist.
- If the new fields logically belong to an EXISTING question, you should UPDATE that question instead of creating a new one. Return the existing question with its original "id", but with the new fields added to its "fieldIds" array. If no existing question fits, create a new one.

Return ONLY a valid JSON object with this structure — no explanation, no code fences:
{
  "fields": [
    { "id": "snake_case_id", "label": "Human-readable label", "value_kind": "text|number|boolean|date|enum", "options": ["only", "for", "enum"] }
  ],
  "questions": [
    { "id": "q_snake_case", "text": "Question to ask the applicant", "fieldIds": ["field_id_1", "field_id_2"], "extract_hint": "optional extraction hint" }
  ]
}

Value kinds: ${JSON.stringify(FIELD_VALUE_KINDS)}
If value_kind is "enum", include "options" with at least 2 distinct choices.
If no new fields/questions are needed, return {"fields":[],"questions":[]}.`;

function parseGeneratedField(v: unknown): LandlordField | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  if (
    typeof f.id !== "string" ||
    validateLandlordFieldId(f.id) !== null ||
    typeof f.label !== "string" ||
    validateLandlordFieldLabel(f.label) !== null
  ) {
    return null;
  }
  const value_kind = f.value_kind as LandlordField["value_kind"];
  if (!FIELD_VALUE_KINDS.includes(value_kind)) return null;

  const out: LandlordField = {
    id: f.id,
    label: f.label,
    value_kind,
  };

  if (value_kind === "enum") {
    if (!Array.isArray(f.options)) return null;
    const rawOpts = f.options
      .filter((x) => typeof x === "string")
      .map((x) => x as string);
    const options = normalizeEnumOptions(rawOpts);
    if (validateEnumOptions(options) !== null) return null;
    out.options = options;
  }

  return out;
}

function parseGeneratedQuestion(v: unknown): Question | null {
  if (typeof v !== "object" || v === null) return null;
  const q = v as Record<string, unknown>;
  if (typeof q.id !== "string" || typeof q.text !== "string" || !q.text.trim()) return null;
  if (!Array.isArray(q.fieldIds) || q.fieldIds.length === 0) return null;

  const fieldIds = (q.fieldIds as unknown[]).filter((x): x is string => typeof x === "string");
  if (fieldIds.length === 0) return null;

  return {
    id: q.id,
    text: q.text,
    fieldIds,
    sort_order: 0, // caller will set
    extract_hint: typeof q.extract_hint === "string" ? q.extract_hint : undefined,
  };
}

export async function POST(req: Request) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "CLAUDE_API_KEY is not set" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "Missing description" }, { status: 400 });
  }

  // Existing context to avoid duplication
  const existingFields: { id: string; label: string }[] = Array.isArray(rec.existingFields)
    ? (rec.existingFields as unknown[]).filter(
        (x): x is { id: string; label: string } =>
          typeof x === "object" && x !== null && typeof (x as any).id === "string" && typeof (x as any).label === "string"
      )
    : [];

  const existingQuestions: { id: string; text: string; fieldIds: string[] }[] = Array.isArray(rec.existingQuestions)
    ? (rec.existingQuestions as unknown[]).filter(
        (x): x is { id: string; text: string; fieldIds: string[] } =>
          typeof x === "object" && x !== null && typeof (x as any).id === "string" && typeof (x as any).text === "string"
      )
    : [];

  let contextNote = "";
  if (existingFields.length > 0) {
    contextNote += `\n\nEXISTING FIELDS (do NOT duplicate):\n${existingFields.map((f) => `  - id: "${f.id}", label: "${f.label}"`).join("\n")}`;
    contextNote += `\nYou may reference these existing field IDs in new questions.`;
  }
  if (existingQuestions.length > 0) {
    contextNote += `\n\nEXISTING QUESTIONS (do NOT duplicate):\n${existingQuestions.map((q) => `  - "${q.text}" → fields: [${q.fieldIds.join(", ")}]`).join("\n")}`;
  }

  try {
    const response = await callClaude(key, {
      system: SYSTEM_PROMPT + contextNote,
      messages: [{ role: "user", content: description }],
      max_tokens: 2048,
    });

    const raw = extractText(response);
    const cleaned = stripCodeFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON", raw: cleaned }, { status: 502 });
    }

    if (typeof parsed !== "object" || parsed === null) {
      return NextResponse.json({ error: "AI response was not an object", raw: cleaned }, { status: 502 });
    }

    const result = parsed as Record<string, unknown>;

    // Parse fields — also accept top-level array for backward compat
    const rawFields = Array.isArray(result.fields) ? result.fields : (Array.isArray(parsed) ? parsed : []);
    const fields = rawFields
      .map(parseGeneratedField)
      .filter((x): x is LandlordField => x !== null);

    // Parse questions
    const rawQuestions = Array.isArray(result.questions) ? result.questions : [];
    const validQuestions = rawQuestions
      .map(parseGeneratedQuestion)
      .filter((x): x is Question => x !== null);

    return NextResponse.json({ fields, questions: validQuestions });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
