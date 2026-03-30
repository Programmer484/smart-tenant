import type { LandlordField } from "./landlord-field";
import type { LandlordRule } from "./landlord-rule";

export type RuleViolation = {
  rule: LandlordRule;
  field: LandlordField;
  actualValue: string;
};

/** Evaluates a single rule. Returns true if the applicant PASSES. */
function satisfies(
  actual: string,
  operator: string,
  target: string,
  valueKind: LandlordField["valueKind"],
): boolean {
  if (valueKind === "number" || valueKind === "date") {
    const a = Number(actual);
    const t = Number(target);
    if (isNaN(a) || isNaN(t)) return true; // can't evaluate confidently — don't penalise
    switch (operator) {
      case "==": return a === t;
      case "!=": return a !== t;
      case ">":  return a > t;
      case ">=": return a >= t;
      case "<":  return a < t;
      case "<=": return a <= t;
    }
  }

  if (valueKind === "boolean") {
    return actual.toLowerCase() === target.toLowerCase();
  }

  // text / enum — case-insensitive
  switch (operator) {
    case "==": return actual.toLowerCase() === target.toLowerCase();
    case "!=": return actual.toLowerCase() !== target.toLowerCase();
  }

  return true;
}

/**
 * Returns every violated rule where the applicant has already provided an answer.
 * Rules for unanswered fields are skipped.
 */
export function evaluateRules(
  rules: LandlordRule[],
  fields: LandlordField[],
  answers: Record<string, string>,
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  for (const rule of rules) {
    const actual = answers[rule.fieldId];
    if (actual === undefined) continue;

    const field = fields.find((f) => f.id === rule.fieldId);
    if (!field) continue;

    if (!satisfies(actual, rule.operator, rule.value, field.valueKind)) {
      violations.push({ rule, field, actualValue: actual });
    }
  }

  return violations;
}

const OP_PHRASES: Record<string, string> = {
  "==":  "must be",
  "!=":  "must not be",
  ">":   "must be greater than",
  ">=":  "must be at least",
  "<":   "must be less than",
  "<=":  "must be at most",
};

/** Human-readable description of a rule, e.g. "Monthly income must be at least 3000" */
export function describeViolation(v: RuleViolation): string {
  const phrase = OP_PHRASES[v.rule.operator] ?? v.rule.operator;
  return `${v.field.label} ${phrase} ${v.rule.value}`;
}
