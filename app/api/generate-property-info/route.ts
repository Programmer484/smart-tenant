import { NextResponse } from "next/server";

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-haiku-4-5-20251001";

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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: description }],
    }),
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

  const propertyInfo = data.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  return NextResponse.json({ propertyInfo });
}
