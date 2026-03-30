import { NextResponse } from "next/server";
import { callClaude, ClaudeApiError, extractText } from "@/lib/anthropic";

const SYSTEM = `You write applicant-facing property summaries for rental listings.

Given the landlord's raw notes, produce a clean, friendly 2–4 paragraph summary that:
- Highlights key features, location, and amenities
- Mentions notable requirements or restrictions (pets, smoking, income) in a neutral tone
- Feels welcoming without being salesy
- Omits internal screening logic or exact rule thresholds

Return only the summary text — no JSON, no markdown headings.`;

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

  const description =
    body && typeof body === "object" && "description" in body &&
    typeof (body as { description: unknown }).description === "string"
      ? (body as { description: string }).description.trim()
      : "";

  if (!description) {
    return NextResponse.json({ error: "Missing description" }, { status: 400 });
  }

  try {
    const response = await callClaude(key, {
      system: SYSTEM,
      messages: [{ role: "user", content: description }],
    });

    const propertyInfo = extractText(response);
    return NextResponse.json({ propertyInfo });
  } catch (err) {
    if (err instanceof ClaudeApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
