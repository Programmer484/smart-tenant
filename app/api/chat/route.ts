import { NextResponse } from "next/server";
import type { LandlordField } from "@/lib/landlord-field";
import type { LandlordRule } from "@/lib/landlord-rule";
import type { AiInstructions } from "@/lib/property";
import { createServiceClient } from "@/lib/supabase/service";
import { evaluateRules, describeViolation } from "@/lib/rule-engine";

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";

type IncomingMessage = { role: "user" | "assistant"; content: string };

function buildSystemPrompt(
  title: string,
  description: string,
  fields: LandlordField[],
  rules: LandlordRule[],
  answers: Record<string, string>,
  aiInstructions?: AiInstructions,
): string {
  const answered = fields.filter((f) => answers[f.id] !== undefined);
  const unanswered = fields.filter((f) => answers[f.id] === undefined);
  const nextField = unanswered[0] ?? null;

  const answeredBlock =
    answered.length > 0
      ? answered.map((f) => `  - ${f.label} (${f.id}): ${answers[f.id]}`).join("\n")
      : "  None yet.";

  const unansweredBlock =
    unanswered.length > 0
      ? unanswered.map((f) => `  - ${f.label} (${f.id})`).join("\n")
      : "  All collected.";

  const nextInstruction = nextField
    ? `After addressing the applicant's message, ask this question next: "${nextField.label}"`
    : `All screening questions have been collected. Thank the applicant and let them know their application is complete and will be reviewed.`;

  const rulesBlock =
    rules.length > 0
      ? rules
          .map((r) => {
            const field = fields.find((f) => f.id === r.fieldId);
            return field ? `  - ${field.label} ${r.operator} ${r.value}` : null;
          })
          .filter(Boolean)
          .join("\n")
      : "  None defined.";

  return `You are a warm and professional rental screening assistant for the following property.

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
1. If the applicant asks a question about the property, answer it using only information from the property description above. Keep it brief.
2. Extract any screening answers from their message. Only extract values for fields in the STILL NEED list.
3. ${nextInstruction}

Keep your reply concise and conversational. One question at a time.${
    aiInstructions?.style
      ? `\n\nLANDLORD STYLE INSTRUCTIONS:\n${aiInstructions.style}`
      : ""
  }${
    aiInstructions?.examples?.length
      ? `\n\nEXAMPLE CONVERSATIONS (match this style):\n${aiInstructions.examples
          .filter((e) => e.user.trim() && e.assistant.trim())
          .map((e) => `Tenant: "${e.user}"\nYou: "${e.assistant}"`)
          .join("\n\n")}`
      : ""
  }

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "reply": "your message to the applicant",
  "extracted": [{ "fieldId": "...", "value": "..." }]
}

"extracted" may be an empty array. Values should be plain strings: numbers like "3500", booleans as "true" or "false".`;
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

  const title = typeof rec.title === "string" ? rec.title.trim() : "Rental Property";
  const description = typeof rec.description === "string" ? rec.description.trim() : "";
  const fields = Array.isArray(rec.fields) ? (rec.fields as LandlordField[]) : [];
  const rules = Array.isArray(rec.rules) ? (rec.rules as LandlordRule[]) : [];
  const answers =
    rec.answers && typeof rec.answers === "object"
      ? (rec.answers as Record<string, string>)
      : {};
  const messages = Array.isArray(rec.messages) ? (rec.messages as IncomingMessage[]) : [];
  const sessionId = typeof rec.sessionId === "string" ? rec.sessionId : null;
  const propertyId = typeof rec.propertyId === "string" ? rec.propertyId : null;
  const clarificationPending = rec.clarificationPending === true;
  const aiInstructions = rec.aiInstructions as AiInstructions | undefined;

  if (messages.length === 0) {
    return NextResponse.json({ error: "No messages provided" }, { status: 400 });
  }

  const system = buildSystemPrompt(title, description, fields, rules, answers, aiInstructions);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json(
      { error: errText || res.statusText },
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

  let parsed: { reply?: string; extracted?: { fieldId: string; value: string }[] };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return NextResponse.json({ reply: raw, extracted: [], sessionStatus: "in_progress" });
  }

  let reply = typeof parsed.reply === "string" ? parsed.reply : raw;
  const extracted = Array.isArray(parsed.extracted) ? parsed.extracted : [];

  // Merge newly extracted answers with known answers to evaluate rules
  const mergedAnswers = { ...answers };
  for (const { fieldId, value } of extracted) {
    if (fields.some((f) => f.id === fieldId)) {
      mergedAnswers[fieldId] = value;
    }
  }

  // Deterministic rule evaluation — no AI involvement
  const violations = evaluateRules(rules, fields, mergedAnswers);
  const firstViolation = violations[0] ?? null;

  // Check if all fields have been answered
  const allCollected = fields.length > 0 && fields.every((f) => mergedAnswers[f.id] !== undefined);

  let sessionStatus: "in_progress" | "clarifying" | "rejected" | "qualified" = "in_progress";

  if (firstViolation) {
    const requirement = describeViolation(firstViolation);

    if (clarificationPending) {
      // Second strike — reject
      sessionStatus = "rejected";
      reply = `Thank you for taking the time to apply. Unfortunately, we're unable to move forward with your application for this property. The reason is that ${requirement}. We wish you the best in your search.`;
    } else {
      // First strike — inform directly, leave door open for immediate correction
      sessionStatus = "clarifying";
      reply = `Based on your response, you may not meet our requirement for this property: ${requirement}. If this is incorrect, please let us know now.`;
    }
  }

  if (!firstViolation && allCollected) {
    sessionStatus = "qualified";
  }

  // Persist to Supabase (best-effort)
  if (sessionId) {
    try {
      const db = createServiceClient();
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");

      await db.from("sessions").upsert(
        {
          id: sessionId,
          listing_title: title,
          status: sessionStatus === "rejected" ? "rejected"
            : sessionStatus === "qualified" ? "qualified"
            : "in_progress",
          answers: mergedAnswers,
          message_count: messages.length + 1,
          property_id: propertyId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      const toInsert = [];
      if (lastUserMsg) {
        toInsert.push({ session_id: sessionId, role: "user", content: lastUserMsg.content });
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

  return NextResponse.json({ reply, extracted, sessionStatus });
}
