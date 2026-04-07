/**
 * Questions are the tenant-facing collection layer.
 * Each question maps to one or more fields (the truth/data layer).
 *
 * - A question can collect multiple fields (compound questions)
 * - A field can be referenced by multiple questions (fallback/follow-up)
 * - The chat engine walks through questions in strict order, extracting fields
 */

export type Question = {
  /** Unique id */
  id: string;
  /** The question text shown to the tenant */
  text: string;
  /** Field IDs this question collects data for */
  fieldIds: string[];
  /** Sort order for the interview flow */
  sort_order: number;
  /** Optional hint for the AI on how to extract fields from the answer */
  extract_hint?: string;
};

/**
 * Validate a question against the available field IDs.
 */
export function validateQuestion(
  question: Question,
  fieldIds: string[],
): string | null {
  if (!question.text.trim()) return "Question text is required";
  if (question.fieldIds.length === 0) return "Link at least one field to this question";
  for (const fid of question.fieldIds) {
    if (!fieldIds.includes(fid)) {
      return `Field "${fid}" not found`;
    }
  }
  return null;
}
