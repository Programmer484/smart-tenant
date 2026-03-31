import { NextResponse } from "next/server";
import { callClaude, ClaudeApiError, extractText } from "@/lib/anthropic";

const SYSTEM = `Rewrite the landlord's raw notes into a clean, applicant-facing summary.

Rules:
- Use ONLY information explicitly stated in the notes. Do not add, infer, or embellish any details.
- If the notes are sparse, keep the summary short. Never pad with generic filler.
- Omit internal screening logic or exact rule thresholds.
- Tone: neutral, welcoming, concise.

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
