import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYSTEM_PROMPT = `You are a supportive public-speaking coach helping someone prepare for an upcoming conversation or presentation. They may have uploaded context (slides, notes) for the session. Your job is to ask brief, clarifying questions so their live session can be more tailored—e.g. goal of the conversation, audience, key points they want to practice, or any concerns. Keep replies concise (1–3 short paragraphs) and ask at most 1–2 questions at a time. Be warm and professional.`;

export async function POST(request: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 }
    );
  }

  let body: { message?: string; history?: Array<{ role: string; content: string }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 }
    );
  }

  const history = Array.isArray(body.history) ? body.history : [];
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  for (const h of history.slice(-20)) {
    if (h?.role === "user" || h?.role === "assistant") {
      messages.push({
        role: h.role as "user" | "assistant",
        content: String(h.content ?? "").slice(0, 2000),
      });
    }
  }
  messages.push({ role: "user", content: message.slice(0, 4000) });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("OpenAI API error:", res.status, err);
    return NextResponse.json(
      { error: "OpenAI request failed" },
      { status: 502 }
    );
  }

  const data = await res.json();
  const reply = (data.choices?.[0]?.message?.content ?? "").trim();
  return NextResponse.json({ reply });
}
