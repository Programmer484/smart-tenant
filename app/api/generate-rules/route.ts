import { NextResponse } from "next/server";
import type { LandlordField } from "@/lib/landlord-field";
import {
  type LandlordRule,
  OPERATORS_BY_KIND,
  validateRule,
} from "@/lib/landlord-rule";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";

function buildSystemPrompt(fields: LandlordField[], existingRules: LandlordRule[]): string {
  const fieldDescriptions = fields
    .filter((f) => {
      if (!OPERATORS_BY_KIND[f.value_kind]) {
        console.warn(`[generate-rules] skipping field "${f.id}" with unknown value_kind "${f.value_kind}"`);
        return false;
      }
      return true;
    })
    .map((f) => {
      const base = `  - id: "${f.id}", value_kind: "${f.value_kind}", label: "${f.label}"`;
      const ops = OPERATORS_BY_KIND[f.value_kind].join(", ");
      const opLine = `    valid operators: [${ops}]`;
      const valLine =
        f.value_kind === "boolean"
          ? `    valid values: "true" or "false"`
          : f.value_kind === "enum" && f.options?.length
            ? `    valid values: ${JSON.stringify(f.options)}`
            : f.value_kind === "number"
              ? `    valid values: numeric strings e.g. "3000"`
              : f.value_kind === "date"
                ? `    valid values: ISO date strings e.g. "2025-01-01"`
                : `    valid values: any string`;
      return [base, opLine, valLine].join("\n");
    })
    .join("\n");

  let existingBlock = "";
  if (existingRules.length > 0) {
    existingBlock = `\n\nEXISTING RULES (do NOT duplicate these):\n${JSON.stringify(existingRules, null, 2)}`;
  }

  return `You are a rental application assistant. Given a property description and a list of applicant fields, generate screening rules.

There are two types of rules:
1. "reject" — instant rejection. If the condition evaluates to true, the applicant is rejected.
   Example: reject if smoking == true, reject if monthly_income < 3000.
2. "require" — acceptance profile. The applicant must match AT LEAST ONE "require" rule to pass.
   Use these for complex eligibility criteria where multiple valid profiles exist.
   Example: require occupants <= 2, OR require (occupants <= 3 AND has_children == true).

Return ONLY a valid JSON object — no explanation, no markdown, no code fences:
{
  "rules": [...],
  "missingFields": [...]
}

"rules": array of rule objects. Each must have:
  - "action": either "reject" or "require"
  - "conditions": an array of condition objects, each with:
    - "fieldId": must be one of the field ids listed below
    - "operator": must be one of the valid operators for that field
    - "value": must satisfy the value constraints for that field
  Conditions within a single rule are combined with AND logic.

"missingFields": array of fields you NEED for the rules but which are NOT in the available fields list below.
  Each: { "id": "snake_case_id", "label": "Human-readable label", "value_kind": "text|number|boolean|date|enum" }
  ONLY include missing fields. If all needed fields exist, return an empty array.

Available fields:
${fieldDescriptions}
${existingBlock}

STRICT RULES:
- ONLY generate rules for constraints explicitly stated in the property description.
- Do NOT invent or assume constraints that are not mentioned.
- If a rule requires a field that doesn't exist yet, add it to "missingFields" and STILL include the rule (it will be validated separately).
- Use "reject" for simple red-flag disqualifiers.
- Use "require" for positive eligibility profiles.
- Do NOT duplicate any existing rules listed above.
- Return {"rules":[],"missingFields":[]} if the description contains no explicit eligibility constraints.`;
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

function parseGeneratedRule(
  v: unknown,
  fields: LandlordField[],
  allowMissingFields = false,
): LandlordRule | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;

  const action = r.action;
  if (action !== "reject" && action !== "require") return null;

  if (Array.isArray(r.conditions)) {
    const conditions = r.conditions
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => {
        if (typeof c.fieldId !== "string" || typeof c.operator !== "string" || typeof c.value !== "string") return null;
        return { id: generateId(), fieldId: c.fieldId, operator: c.operator, value: c.value };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (conditions.length === 0) return null;

    const rule: LandlordRule = { id: generateId(), action, conditions };
    // Only validate against existing fields
    if (!allowMissingFields && validateRule(rule, fields) !== null) return null;
    return rule;
  }

  if (typeof r.fieldId === "string" && typeof r.operator === "string" && typeof r.value === "string") {
    const rule: LandlordRule = {
      id: generateId(),
      action,
      conditions: [{
        id: generateId(),
        fieldId: r.fieldId,
        operator: r.operator,
        value: r.value,
      }]
    };
    if (!allowMissingFields && validateRule(rule, fields) !== null) return null;
    return rule;
  }

  return null;
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

  const existingRules: LandlordRule[] = Array.isArray(rec.existingRules) ? rec.existingRules as LandlordRule[] : [];

  try {
    const response = await callClaude(key, {
      system: buildSystemPrompt(fields, existingRules),
      messages: [{ role: "user", content: description }],
    });

    const raw = extractText(response);
    const cleaned = stripCodeFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned invalid JSON", raw: cleaned }, { status: 502 });
    }

    // Support both new object format and legacy array format
    let rulesArray: unknown[];
    let missingFields: { id: string; label: string; value_kind: string }[] = [];

    if (Array.isArray(parsed)) {
      rulesArray = parsed;
    } else if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      rulesArray = Array.isArray(obj.rules) ? obj.rules : [];
      if (Array.isArray(obj.missingFields)) {
        missingFields = (obj.missingFields as unknown[]).filter(
          (x): x is { id: string; label: string; value_kind: string } =>
            typeof x === "object" && x !== null &&
            typeof (x as any).id === "string" &&
            typeof (x as any).label === "string"
        );
      }
    } else {
      return NextResponse.json({ error: "AI response was not valid", raw: cleaned }, { status: 502 });
    }

    // Parse rules — only validate against existing fields
    const rules = rulesArray
      .map((v) => parseGeneratedRule(v, fields))
      .filter((r): r is LandlordRule => r !== null);

    return NextResponse.json({ rules, missingFields });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
