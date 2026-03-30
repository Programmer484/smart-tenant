import { NextResponse } from "next/server";
import {
  LandlordField,
  FIELD_VALUE_KINDS,
  validateLandlordFieldId,
  validateLandlordFieldLabel,
  normalizeEnumOptions,
  validateEnumOptions,
} from "@/lib/landlord-field";

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a rental application assistant. Given a property description, generate a list of applicant screening fields the landlord should collect.

Return ONLY a valid JSON array — no explanation, no markdown, no code fences. Each element must have:
  - "id": snake_case identifier (letters, digits, underscores; must start with a letter)
  - "label": a clear question to ask the applicant (string)
  - "valueKind": one of ${JSON.stringify(FIELD_VALUE_KINDS)}
  - "required": true or false
  - If valueKind is "enum", include "options": an array of at least 2 distinct choice strings (labels shown to applicants)

Example output:
[
  { "id": "credit_score", "label": "What is your current credit score?", "valueKind": "number", "required": true },
  { "id": "has_pets", "label": "Do you have pets?", "valueKind": "boolean", "required": true },
  { "id": "employment_type", "label": "What best describes your employment?", "valueKind": "enum", "required": true, "options": ["Full-time", "Part-time", "Self-employed", "Student / other"] }
]

Only include fields that are directly relevant to evaluating the applicant for this specific property.`;

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
  const valueKind = f.valueKind as LandlordField["valueKind"];
  if (!FIELD_VALUE_KINDS.includes(valueKind)) return null;

  const out: LandlordField = {
    id: f.id,
    label: f.label,
    valueKind,
    required: typeof f.required === "boolean" ? f.required : true,
  };

  if (valueKind === "enum") {
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

  // Labels of shared fields already included — AI should not duplicate these topics
  const excludeLabels: string[] = Array.isArray(rec.excludeLabels)
    ? (rec.excludeLabels as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const exclusionNote =
    excludeLabels.length > 0
      ? `\n\nDo NOT generate fields for topics already covered by these shared questions (they apply to all properties):\n${excludeLabels.map((l) => `  - ${l}`).join("\n")}\nOnly generate fields specific to this property.`
      : "";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT + exclusionNote,
      messages: [{ role: "user", content: description }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return NextResponse.json(
      { error: errBody || res.statusText },
      { status: res.status >= 500 ? 502 : res.status },
    );
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const raw = data.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  // Strip markdown code fences if the model adds them despite instructions
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json(
      { error: "AI returned invalid JSON", raw: cleaned },
      { status: 502 },
    );
  }

  if (!Array.isArray(parsed)) {
    return NextResponse.json(
      { error: "AI response was not an array", raw: cleaned },
      { status: 502 },
    );
  }

  const fields = parsed
    .map(parseGeneratedField)
    .filter((x): x is LandlordField => x !== null);
  return NextResponse.json({ fields });
}
