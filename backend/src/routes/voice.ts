import { Hono } from "hono";
import { withAuth } from "../lib/dynamic-auth";
import { ElevenLabsClient } from "elevenlabs";

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

    const result = await client.speechToText.convert({
      file: audioBlob as any,
      model_id: "scribe_v1",
      language_code: "en",
    });

    return c.json({ text: result.text });
  } catch (err) {
    console.error("[voice/stt] Error:", err);
    return c.json({ error: "Transcription failed" }, 500);
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
    const client = new ElevenLabsClient({ apiKey });
    const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";

    const audioStream = await client.textToSpeech.convert(voiceId, {
      text: body.text,
      model_id: "eleven_turbo_v2_5",
      output_format: "mp3_44100_128",
    });

    // Collect stream into buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (err) {
    console.error("[voice/tts] Error:", err);
    return c.json({ error: "TTS failed" }, 500);
  }
});
