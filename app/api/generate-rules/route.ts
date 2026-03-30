import { NextResponse } from "next/server";
import type { LandlordField } from "@/lib/landlord-field";
import {
  type LandlordRule,
  OPERATORS_BY_KIND,
  validateRule,
} from "@/lib/landlord-rule";

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";

function buildSystemPrompt(fields: LandlordField[]): string {
  const fieldDescriptions = fields
    .filter((f) => {
      if (!OPERATORS_BY_KIND[f.valueKind]) {
        console.warn(`[generate-rules] skipping field "${f.id}" with unknown valueKind "${f.valueKind}"`);
        return false;
      }
      return true;
    })
    .map((f) => {
      const base = `  - id: "${f.id}", valueKind: "${f.valueKind}", label: "${f.label}"`;
      const ops = OPERATORS_BY_KIND[f.valueKind].join(", ");
      const opLine = `    valid operators: [${ops}]`;
      const valLine =
        f.valueKind === "boolean"
          ? `    valid values: "true" or "false"`
          : f.valueKind === "enum" && f.options?.length
            ? `    valid values: ${JSON.stringify(f.options)}`
            : f.valueKind === "number"
              ? `    valid values: numeric strings e.g. "3000"`
              : f.valueKind === "date"
                ? `    valid values: ISO date strings e.g. "2025-01-01"`
                : `    valid values: any string`;
      return [base, opLine, valLine].join("\n");
    })
    .join("\n");

  return `You are a rental application assistant. Given a property description and a list of applicant fields, generate eligibility rules the landlord wants to enforce.

Each rule is a check that an applicant must pass. If any rule fails, the applicant is rejected.

Return ONLY a valid JSON array — no explanation, no markdown, no code fences. Each element must have:
  - "fieldId": must be one of the field ids listed below (copy exactly)
  - "operator": must be one of the valid operators for that field
  - "value": must satisfy the value constraints for that field

Available fields:
${fieldDescriptions}

Rules:
- Only generate rules that can be directly inferred from the property description.
- Do not invent constraints not mentioned or implied in the description.
- You may generate multiple rules for the same field (e.g. income >= X and income <= Y).
- Return an empty array if no clear eligibility constraints are implied.

Example output:
[
  { "fieldId": "monthly_income", "operator": ">=", "value": "4500" },
  { "fieldId": "has_pets", "operator": "==", "value": "false" }
]`;
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function parseGeneratedRule(
  v: unknown,
  fields: LandlordField[],
): LandlordRule | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.fieldId !== "string" ||
    typeof r.operator !== "string" ||
    typeof r.value !== "string"
  ) {
    return null;
  }
  const rule: LandlordRule = {
    id: generateId(),
    fieldId: r.fieldId,
    operator: r.operator,
    value: r.value,
  };
  if (validateRule(rule, fields) !== null) return null;
  return rule;
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

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const rec = body as Record<string, unknown>;

  const description =
    typeof rec.description === "string" ? rec.description.trim() : "";
  if (!description) {
    return NextResponse.json({ error: "Missing description" }, { status: 400 });
  }

  if (!Array.isArray(rec.fields) || rec.fields.length === 0) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const fields = rec.fields as LandlordField[];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(fields),
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

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "AI returned invalid JSON", raw: cleaned }, { status: 502 });
  }

  if (!Array.isArray(parsed)) {
    return NextResponse.json({ error: "AI response was not an array", raw: cleaned }, { status: 502 });
  }

  const rules = parsed
    .map((v) => parseGeneratedRule(v, fields))
    .filter((r): r is LandlordRule => r !== null);

  return NextResponse.json({ rules });
}
