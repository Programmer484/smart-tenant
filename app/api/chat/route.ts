import { NextResponse } from "next/server";
import type { LandlordField, FieldValueKind } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { AiInstructions } from "@/lib/property";
import { resolveAiInstructions } from "@/lib/property";
import { createServiceClient } from "@/lib/supabase/service";
import { evaluateRules, describeViolation } from "@/lib/rule-engine";
import { callClaude, ClaudeApiError } from "@/lib/anthropic";

type IncomingMessage = { role: "user" | "assistant"; content: string };
type Extraction = { fieldId: string; value: string };

// ─── Tool definition ────────────────────────────────────────────────

const SCREEN_RESPONSE_TOOL = {
  name: "screen_response",
  description:
    "Respond to the applicant and extract any screening field values from their message.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: {
        type: "string",
        description: "Your conversational message to the applicant.",
      },
      extracted: {
        type: "array",
        description:
          "Field values found in the applicant's message. Empty array if none.",
        items: {
          type: "object",
          properties: {
            fieldId: { type: "string" },
            value: { type: "string" },
          },
          required: ["fieldId", "value"],
        },
      },
      message_relevant: {
        type: "boolean",
        description:
          "true if the message is a screening answer OR a property question. false if completely off-topic.",
      },
    },
    required: ["reply", "extracted", "message_relevant"],
  },
};

// ─── Value validation ───────────────────────────────────────────────

function isValidExtraction(
  value: string,
  kind: FieldValueKind,
  options?: string[],
): boolean {
  switch (kind) {
    case "number":
      return !isNaN(Number(value));
    case "boolean":
      return ["true", "false"].includes(value.toLowerCase());
    case "date":
      return !isNaN(Date.parse(value));
    case "enum":
      return (options ?? []).some(
        (o) => o.toLowerCase() === value.toLowerCase(),
      );
    case "text":
      return true;
    default:
      return true;
  }
}

// ─── System prompt ──────────────────────────────────────────────────

function buildSystemPrompt(
  title: string,
  description: string,
  fields: LandlordField[],
  rules: LandlordRule[],
  answers: Record<string, string>,
  ai: AiInstructions,
): string {
  const answered = fields.filter((f) => answers[f.id] !== undefined);
  const unanswered = fields.filter((f) => answers[f.id] === undefined);
  const nextField = unanswered[0] ?? null;

  const answeredBlock =
    answered.length > 0
      ? answered
          .map((f) => `  - ${f.label} (${f.id}): ${answers[f.id]}`)
          .join("\n")
      : "  None yet.";

  const unansweredBlock =
    unanswered.length > 0
      ? unanswered
          .map((f) => {
            let line = `  - ${f.label} (${f.id}), type: ${f.valueKind}`;
            if (f.options?.length) line += `, options: ${f.options.join(", ")}`;
            if (f.collectHint) line += ` [hint: ${f.collectHint}]`;
            return line;
          })
          .join("\n")
      : "  All collected.";

  const nextInstruction = nextField
    ? `After addressing the applicant's message, ask this question next: "${nextField.label}"`
    : "All screening questions have been collected. Thank the applicant and let them know their application is complete and will be reviewed.";

  const rulesBlock =
    rules.length > 0
      ? rules
          .map((r) => {
            const field = fields.find((f) => f.id === r.fieldId);
            return field
              ? `  - ${field.label} ${r.operator} ${r.value}`
              : null;
          })
          .filter(Boolean)
          .join("\n")
      : "  None defined.";

  const groundingInstruction =
    ai.unknownInfoBehavior === "ignore"
      ? "Do not answer questions about details not covered in the description above. Redirect the applicant back to the screening questions."
      : "Only answer property questions using the description above. If the information is not there, say you don't have that detail and suggest contacting the landlord. Never invent details.";

  let prompt = `You are a warm and professional rental screening assistant for the following property.

Property: ${title}
---
${description}
---

ELIGIBILITY REQUIREMENTS:
${rulesBlock}

COLLECTED SO FAR:
${answeredBlock}

STILL NEED:
${unansweredBlock}

YOUR JOB:
1. ${groundingInstruction}
2. You MUST extract ALL values from the applicant's message that match fields in the STILL NEED list. Never skip an extraction, even if you also plan to ask a follow-up. Values should be plain strings: numbers like "3500", booleans as "true" or "false".
3. ${nextInstruction}

Keep your reply concise and conversational. One question at a time.`;

  if (ai.style) {
    prompt += `\n\nLANDLORD STYLE INSTRUCTIONS:\n${ai.style}`;
  }

  if (ai.examples?.length) {
    const pairs = ai.examples
      .filter((e) => e.user.trim() && e.assistant.trim())
      .map((e) => `Tenant: "${e.user}"\nYou: "${e.assistant}"`)
      .join("\n\n");
    if (pairs) {
      prompt += `\n\nEXAMPLE CONVERSATIONS (match this style):\n${pairs}`;
    }
  }

  return prompt;
}

// ─── POST handler ───────────────────────────────────────────────────

export async function POST(req: Request) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "CLAUDE_API_KEY is not set" },
      { status: 500 },
    );
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

  const title =
    typeof rec.title === "string" ? rec.title.trim() : "Rental Property";
  const description =
    typeof rec.description === "string" ? rec.description.trim() : "";
  const fields = Array.isArray(rec.fields)
    ? (rec.fields as LandlordField[])
    : [];
  const rules = Array.isArray(rec.rules)
    ? (rec.rules as LandlordRule[])
    : [];
  const answers =
    rec.answers && typeof rec.answers === "object"
      ? (rec.answers as Record<string, string>)
      : {};
  const messages = Array.isArray(rec.messages)
    ? (rec.messages as IncomingMessage[])
    : [];
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : null;
  const propertyId =
    typeof rec.propertyId === "string" ? rec.propertyId : null;
  const clarificationPending = rec.clarificationPending === true;
  const offTopicCount =
    typeof rec.offTopicCount === "number" ? rec.offTopicCount : 0;
  const qualifiedFollowUpCount =
    typeof rec.qualifiedFollowUpCount === "number"
      ? rec.qualifiedFollowUpCount
      : 0;
  const isQualified = rec.isQualified === true;
  const ai = resolveAiInstructions(
    rec.aiInstructions as Partial<AiInstructions> | undefined,
  );

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "No messages provided" },
      { status: 400 },
    );
  }

  // ── Call Claude with tool use ──

  const system = buildSystemPrompt(title, description, fields, rules, answers, ai);

  let data;
  try {
    data = await callClaude(key, {
      system,
      messages,
      tools: [SCREEN_RESPONSE_TOOL],
      tool_choice: { type: "tool", name: "screen_response" },
    });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const toolBlock = data.content?.find((b) => b.type === "tool_use");
  const input = toolBlock?.input as {
    reply?: string;
    extracted?: Extraction[];
    message_relevant?: boolean;
  } | undefined;

  let reply = input?.reply ?? "I'm sorry, something went wrong. Could you try again?";
  const rawExtracted = Array.isArray(input?.extracted) ? input.extracted : [];
  const messageRelevant = input?.message_relevant !== false;

  // ── Validate extractions ──

  const extracted: Extraction[] = [];
  for (const ex of rawExtracted) {
    const field = fields.find((f) => f.id === ex.fieldId);
    if (!field) continue;
    if (answers[ex.fieldId] !== undefined) continue;
    if (!isValidExtraction(ex.value, field.valueKind, field.options)) {
      console.warn(
        `[chat] Dropped invalid extraction: ${ex.fieldId}="${ex.value}" (expected ${field.valueKind})`,
      );
      continue;
    }
    extracted.push(ex);
  }

  // ── Merge answers + evaluate rules ──

  const mergedAnswers = { ...answers };
  for (const { fieldId, value } of extracted) {
    mergedAnswers[fieldId] = value;
  }

  const violations = evaluateRules(rules, fields, mergedAnswers);
  const firstViolation = violations[0] ?? null;
  const allCollected =
    fields.length > 0 &&
    fields.every((f) => mergedAnswers[f.id] !== undefined);

  // ── Determine session status ──

  let sessionStatus:
    | "in_progress"
    | "clarifying"
    | "rejected"
    | "qualified"
    | "completed" = "in_progress";
  let offTopicWarning = false;

  // 1. Rule violation system (two-strike, independent of off-topic)
  if (firstViolation) {
    const requirement = describeViolation(firstViolation);

    if (clarificationPending) {
      sessionStatus = "rejected";
      reply = `Thank you for taking the time to apply. Unfortunately, we're unable to move forward with your application for this property. The reason is that ${requirement}. We wish you the best in your search.`;
    } else {
      sessionStatus = "clarifying";
      reply = `Based on your response, you may not meet our requirement for this property: ${requirement}. If this is incorrect, please let us know now.`;
    }
  }
  // 2. Qualified phase
  else if (isQualified || (!firstViolation && allCollected)) {
    const followUps = qualifiedFollowUpCount + (isQualified ? 1 : 0);
    const limit = ai.qualifiedFollowUps;

    if (
      (limit === 0 && isQualified) ||
      (limit > 0 && followUps >= limit) ||
      (!messageRelevant && isQualified)
    ) {
      sessionStatus = "completed";
      reply =
        "Thank you for your interest! Your application is complete and will be reviewed shortly. We'll be in touch. Good luck!";
    } else {
      sessionStatus = "qualified";
    }
  }
  // 3. Off-topic system (independent of rules)
  else if (!messageRelevant) {
    const newCount = offTopicCount + 1;
    const limit = ai.offTopicLimit;

    if (limit > 0 && newCount >= limit) {
      sessionStatus = "rejected";
      reply =
        "It seems like you may not be interested in proceeding with this application. We're going to close this session. If you'd like to apply in the future, feel free to start a new conversation.";
    } else {
      offTopicWarning = true;
    }
  }

  // ── Persist to Supabase (best-effort) ──

  const dbStatus =
    sessionStatus === "rejected"
      ? "rejected"
      : sessionStatus === "qualified" || sessionStatus === "completed"
        ? "qualified"
        : "in_progress";

  if (sessionId) {
    try {
      const db = createServiceClient();
      const lastUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === "user");

      await db.from("sessions").upsert(
        {
          id: sessionId,
          listing_title: title,
          status: dbStatus,
          answers: mergedAnswers,
          message_count: messages.length + 1,
          property_id: propertyId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      const toInsert = [];
      if (lastUserMsg) {
        toInsert.push({
          session_id: sessionId,
          role: "user",
          content: lastUserMsg.content,
        });
      }
      toInsert.push({
        session_id: sessionId,
        role: "assistant",
        content: reply,
        extracted: extracted.length ? extracted : null,
      });
      await db.from("messages").insert(toInsert);
    } catch (err) {
      console.error("[chat] Supabase write failed:", err);
    }
  }

  return NextResponse.json({
    reply,
    extracted,
    sessionStatus,
    offTopicWarning,
  });
}
