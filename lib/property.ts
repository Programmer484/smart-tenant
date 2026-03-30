import type { LandlordField } from "./landlord-field";
import type { LandlordRule } from "./landlord-rule";

export type ListingLink = { label: string; url: string };

export type AiExample = { user: string; assistant: string };
export type AiInstructions = {
  /** Freeform style/behavior instructions for the AI */
  style: string;
  /** Sample Q&A pairs the AI should learn from */
  examples: AiExample[];
};

/** Raw shape as stored in the `properties` table */
export type PropertyRecord = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  property_info: string;
  intro_message: string;
  /** Ordered list of shared_fields IDs included in this listing */
  shared_field_ids: string[];
  /** Fields defined specifically for this property */
  own_fields: LandlordField[];
  rules: LandlordRule[];
  links: ListingLink[];
  ai_instructions: AiInstructions;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
};

/** A shared field as stored in the `shared_fields` table */
export type SharedFieldRecord = LandlordField & {
  user_id: string;
  sort_order: number;
};

/**
 * Merge shared fields + own fields into a single ordered list.
 * Shared fields appear first, in the order defined by shared_field_ids.
 */
export function resolveFields(
  property: Pick<PropertyRecord, "shared_field_ids" | "own_fields">,
  sharedFields: LandlordField[],
): LandlordField[] {
  const ids = property.shared_field_ids ?? [];
  const own = property.own_fields ?? [];
  const shared = ids
    .map((id) => sharedFields.find((f) => f.id === id))
    .filter((f): f is LandlordField => f !== undefined);
  return [...shared, ...own];
}

export function defaultIntroMessage(title: string): string {
  return `Thank you for your interest in ${title || "this property"}. Please answer the following questions to help us determine your eligibility.`;
}
