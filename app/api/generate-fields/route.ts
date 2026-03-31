import { NextResponse } from "next/server";
import {
  LandlordField,
  FIELD_VALUE_KINDS,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  normalizeEnumOptions,
  validateEnumOptions,
} from "@/lib/landlord-field";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";

const SYSTEM_PROMPT = `You are a rental application assistant. Given a property description, generate screening fields ONLY for topics explicitly mentioned or clearly implied in the description.

STRICT RULE: Do NOT invent fields for common rental topics (income, pets, smoking, employment, etc.) unless the description actually mentions them. If the description says nothing about pets, do not add a pets field. If it says nothing about income, do not add an income field.

Return ONLY a valid JSON array — no explanation, no markdown, no code fences. Each element must have:
  - "id": snake_case identifier (letters, digits, underscores; must start with a letter)
  - "label": a clear question to ask the applicant (string)
  - "value_kind": one of ${JSON.stringify(FIELD_VALUE_KINDS)}
  - If value_kind is "enum", include "options": an array of at least 2 distinct choice strings

Example: if the description says "no pets allowed, minimum income $3000/month", generate fields for pets and income — nothing else.

Return an empty array [] if the description contains no screening-relevant details.`;

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

  const excludeLabels: string[] = Array.isArray(rec.excludeLabels)
    ? (rec.excludeLabels as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const exclusionNote =
    excludeLabels.length > 0
      ? `\n\nDo NOT generate fields for topics already covered by these shared questions (they apply to all properties):\n${excludeLabels.map((l) => `  - ${l}`).join("\n")}\nOnly generate fields specific to this property.`
      : "";

  try {
    const response = await callClaude(key, {
      system: SYSTEM_PROMPT + exclusionNote,
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

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "AI response was not an array", raw: cleaned }, { status: 502 });
    }

    const fields = parsed
      .map(parseGeneratedField)
      .filter((x): x is LandlordField => x !== null);
    return NextResponse.json({ fields });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
