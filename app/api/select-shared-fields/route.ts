import { NextResponse } from "next/server";
import type { LandlordField } from "@/lib/landlord-field";
import { callClaude, ClaudeApiError, extractText, stripCodeFences } from "@/lib/anthropic";

const SYSTEM_PROMPT = `You are a rental application assistant. Given a property description and a pool of shared screening questions, select which questions are relevant for this specific property.

Return ONLY a valid JSON array of the selected question IDs — no explanation, no markdown, no code fences.

Example: ["full_name", "email", "monthly_income"]

Rules:
- Only include IDs that appear in the pool below.
- Select questions that are relevant for screening tenants for this property.
- Generic questions (name, email, phone, employment) are almost always relevant.
- Skip questions that don't apply (e.g. pet questions for a no-pets property where the answer is obvious).`;

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

  const pool = Array.isArray(rec.pool) ? (rec.pool as LandlordField[]) : [];
  if (pool.length === 0) {
    return NextResponse.json({ selectedIds: [] });
  }

  const poolBlock = pool
    .map((f) => `  - id: "${f.id}", label: "${f.label}", type: ${f.value_kind}`)
    .join("\n");

  try {
    const response = await callClaude(key, {
      system: `${SYSTEM_PROMPT}\n\nAvailable questions:\n${poolBlock}`,
      messages: [{ role: "user", content: description }],
    });

    const raw = extractText(response);
    const cleaned = stripCodeFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ selectedIds: pool.map((f) => f.id) });
    }

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ selectedIds: pool.map((f) => f.id) });
    }

    const validIds = new Set(pool.map((f) => f.id));
    const selectedIds = parsed
      .filter((x): x is string => typeof x === "string" && validIds.has(x));

    return NextResponse.json({ selectedIds });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
