import { NextResponse } from "next/server";
import type { LandlordField } from "@/lib/landlord-field";
import {
  type LandlordRule,
  normalizeRulesList,
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
    existingBlock = `\n\nEXISTING RULES (You may modify or delete these if the prompt explicitly asks for it):\n${JSON.stringify(existingRules, null, 2)}`;
  }

  return `You are a rental application assistant. Given a property description and a list of applicant fields, generate screening rules.

There are two types of rules:
1. "reject" — instant rejection. If the condition evaluates to true, the applicant is rejected.
   Example: reject if smoking == true, reject if monthly_income < 3000.
2. "require" — acceptance profile. The applicant must match AT LEAST ONE "require" rule to pass.
   Use these for complex eligibility criteria where multiple valid profiles exist.

Return ONLY a valid JSON object — no explanation, no markdown, no code fences:
{
  "newRules": [...],
  "modifiedRules": [...],
  "deletedRuleIds": ["id1", "id2"],
  "newFields": [...]
}

"newRules": array of new rule objects. Each must have:
  - "kind": either "reject" or "require"
  - "conditions": an array of condition objects, each with "fieldId", "operator", "value"

"modifiedRules": array of updated rule objects. If the user asks to change an EXISTING RULE, return it here.
  - MUST include the original "id" from the EXISTING RULES list.
  - MUST include the updated "kind" and "conditions" arrays.

"deletedRuleIds": array of string IDs of EXISTING RULES to completely remove, if requested.

"newFields": array of fields you NEED for the rules but which are NOT in the available fields list below.
  First, define the most natural human-facing label. Then, derive a concise, descriptive snake_case ID from that label.
  Each: { "id": "snake_case_id", "label": "Human-readable label", "value_kind": "text|number|boolean|date|enum" }
  ONLY include missing fields. If all needed fields exist, return an empty array.

Available fields:
${fieldDescriptions}
${existingBlock}

STRICT RULES:
- ONLY generate rules for constraints explicitly stated in the property description.
- Do NOT invent or assume constraints that are not mentioned.
- If a rule requires a field that doesn't exist yet, add it to "missingFields" and STILL include the rule (it will be validated separately).
- Do NOT duplicate any existing rules listed above.
- If no rules need to be added, modified, or deleted, return empty arrays.`;
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

  const kindRaw = r.kind ?? r.action;
  if (kindRaw !== "reject" && kindRaw !== "require") return null;
  const kind = kindRaw as LandlordRule["kind"];

  if (Array.isArray(r.conditions)) {
    const conditions = r.conditions
      .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
      .map((c) => {
        if (typeof c.fieldId !== "string" || typeof c.operator !== "string" || c.value == null) return null;
        return { id: generateId(), fieldId: c.fieldId, operator: c.operator, value: String(c.value) };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (conditions.length === 0) return null;

    const rule: LandlordRule = { id: typeof r.id === "string" ? r.id : generateId(), kind, conditions };
    // Only validate against existing fields
    if (!allowMissingFields && validateRule(rule, fields) !== null) return null;
    return rule;
  }

  if (typeof r.fieldId === "string" && typeof r.operator === "string" && r.value != null) {
    const rule: LandlordRule = {
      id: typeof r.id === "string" ? r.id : generateId(),
      kind,
      conditions: [{
        id: generateId(),
        fieldId: r.fieldId,
        operator: r.operator,
        value: String(r.value),
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

  const existingRules: LandlordRule[] = Array.isArray(rec.existingRules)
    ? normalizeRulesList(rec.existingRules)
    : [];

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
    let newRulesArray: unknown[] = [];
    let modifiedRulesArray: unknown[] = [];
    let deletedRuleIds: string[] = [];
    let missingFields: { id: string; label: string; value_kind: string }[] = [];

    if (Array.isArray(parsed)) {
      newRulesArray = parsed;
    } else if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      newRulesArray = Array.isArray(obj.newRules) ? obj.newRules : (Array.isArray(obj.rules) ? obj.rules : []);
      modifiedRulesArray = Array.isArray(obj.modifiedRules) ? obj.modifiedRules : [];
      deletedRuleIds = Array.isArray(obj.deletedRuleIds) ? obj.deletedRuleIds.filter((x): x is string => typeof x === "string") : [];
      
      const rawNewFields = Array.isArray(obj.newFields) ? obj.newFields : (Array.isArray(obj.missingFields) ? obj.missingFields : []);
      if (rawNewFields.length > 0) {
        missingFields = (rawNewFields as unknown[]).filter(
          (x): x is { id: string; label: string; value_kind: string } =>
            typeof x === "object" && x !== null &&
            typeof (x as any).id === "string" &&
            typeof (x as any).label === "string"
        );
      }
    } else {
      return NextResponse.json({ error: "AI response was not valid", raw: cleaned }, { status: 502 });
    }

    // If missing fields were identified, make a second call with augmented field list
    // so the LLM can reliably generate rules with all fields available
    if (missingFields.length > 0) {
      const augmentedFields: LandlordField[] = [
        ...fields,
        ...missingFields.map((mf) => ({
          id: mf.id,
          label: mf.label,
          value_kind: mf.value_kind,
        } as LandlordField)),
      ];

      const response2 = await callClaude(key, {
        system: buildSystemPrompt(augmentedFields, existingRules),
        messages: [{ role: "user", content: description }],
      });

      const raw2 = extractText(response2);
      const cleaned2 = stripCodeFences(raw2);

      let parsed2: unknown;
      try {
        parsed2 = JSON.parse(cleaned2);
      } catch {
        // Fall back to first-call rules if second call fails to parse
        const newRules = newRulesArray.map((v) => parseGeneratedRule(v, fields, true)).filter((r): r is LandlordRule => r !== null);
        const modifiedRules = modifiedRulesArray.map((v) => parseGeneratedRule(v, fields, true)).filter((r): r is LandlordRule => r !== null);
        return NextResponse.json({ newRules, modifiedRules, deletedRuleIds, newFields: missingFields });
      }

      let newRulesArray2: unknown[] = [];
      let modifiedRulesArray2: unknown[] = [];
      let deletedRuleIds2: string[] = deletedRuleIds;

      if (Array.isArray(parsed2)) {
        newRulesArray2 = parsed2;
      } else if (typeof parsed2 === "object" && parsed2 !== null) {
        const obj2 = parsed2 as Record<string, unknown>;
        newRulesArray2 = Array.isArray(obj2.newRules) ? obj2.newRules : (Array.isArray(obj2.rules) ? obj2.rules : []);
        modifiedRulesArray2 = Array.isArray(obj2.modifiedRules) ? obj2.modifiedRules : [];
        if (Array.isArray(obj2.deletedRuleIds)) {
          deletedRuleIds2 = obj2.deletedRuleIds.filter((x): x is string => typeof x === "string");
        }
      }

      const newRules = newRulesArray2.map((v) => parseGeneratedRule(v, augmentedFields, false)).filter((r): r is LandlordRule => r !== null);
      const modifiedRules = modifiedRulesArray2.map((v) => parseGeneratedRule(v, augmentedFields, false)).filter((r): r is LandlordRule => r !== null);

      return NextResponse.json({ newRules, modifiedRules, deletedRuleIds: deletedRuleIds2, newFields: missingFields });
    }

    // No missing fields — use first-call results directly
    const newRules = newRulesArray
      .map((v) => parseGeneratedRule(v, fields, false))
      .filter((r): r is LandlordRule => r !== null);
      
    const modifiedRules = modifiedRulesArray
      .map((v) => parseGeneratedRule(v, fields, false))
      .filter((r): r is LandlordRule => r !== null);

    return NextResponse.json({ newRules, modifiedRules, deletedRuleIds, newFields: missingFields });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
