import { Hono } from "hono";
import { withAuth } from "../lib/dynamic-auth";
import { ElevenLabsClient } from "elevenlabs";

const STT_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms)
    ),
  ]);
}

export const voiceRoute = new Hono();

// POST /api/voice/stt — audio blob → transcription
voiceRoute.post("/stt", async (c) => {
  const user = await withAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return c.json({ error: "ElevenLabs not configured" }, 500);

  try {
    const formData = await c.req.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) return c.json({ error: "audio field required" }, 400);

    const client = new ElevenLabsClient({ apiKey });
    const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type || "audio/webm" });

    const result = await withTimeout(
      client.speechToText.convert({
        file: audioBlob as any,
        model_id: "scribe_v1",
        language_code: "en",
      }),
      STT_TIMEOUT_MS,
      "STT"
    );

    return c.json({ text: result.text });
  } catch (err: any) {
    console.error("[voice/stt] Error:", err);
    if (err?.message === "STT_TIMEOUT") {
      return c.json({ error: "Transcription timed out. Please try again." }, 504);
    }
    return c.json({ error: "Transcription failed. Please try again." }, 500);
  }
});

// POST /api/voice/tts — text → audio stream
voiceRoute.post("/tts", async (c) => {
  const user = await withAuth(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return c.json({ error: "ElevenLabs not configured" }, 500);

  let body: { text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.text) return c.json({ error: "text required" }, 400);

  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";

    // Strip markdown-style formatting so TTS sounds natural
    const cleanText = body.text
      .replace(/\*\*(.+?)\*\*/g, "$1")   // bold
      .replace(/\*(.+?)\*/g, "$1")        // italic
      .replace(/#{1,6}\s+/g, "")          // headings
      .replace(/`{1,3}[^`]*`{1,3}/g, "") // code
      .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
      .trim();

    // Use direct fetch instead of SDK (SDK has issues with library voices)
    const response = await withTimeout(
      fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: "eleven_multilingual_v2",
        }),
      }),
      TTS_TIMEOUT_MS,
      "TTS"
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[voice/tts] API error:", response.status, errorText);
      if (response.status === 402) {
        return c.json({ error: "ElevenLabs quota exceeded or payment required." }, 402);
      }
      return c.json({ error: "Voice synthesis failed." }, 500);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err: any) {
    console.error("[voice/tts] Error:", err);
    if (err?.message === "TTS_TIMEOUT") {
      return c.json({ error: "Voice synthesis timed out. Please try again." }, 504);
    }
    return c.json({ error: "Voice synthesis failed. Please try again." }, 500);
  }
});
