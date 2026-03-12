import { ElevenLabsClient } from "elevenlabs";
import { exec } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export class TextToSpeech {
  private client: ElevenLabsClient;
  private voiceId: string;

  constructor(
    apiKey: string,
    // Set ELEVENLABS_VOICE_ID in .env — find IDs at elevenlabs.io/voice-library
    voiceId: string = process.env.ELEVENLABS_VOICE_ID ?? ""
  ) {
    this.client = new ElevenLabsClient({ apiKey });
    this.voiceId = voiceId;
  }

  async speak(text: string): Promise<void> {
    const audioStream = await this.client.textToSpeech.convert(this.voiceId, {
      text,
      model_id: "eleven_turbo_v2_5",
      output_format: "mp3_44100_128",
    });

    // Buffer the stream
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const audioBuffer = Buffer.concat(chunks);

    // Write to temp file and play via macOS afplay
    const tmpFile = join(tmpdir(), `tts_${Date.now()}.mp3`);
    writeFileSync(tmpFile, audioBuffer);

    await new Promise<void>((resolve, reject) => {
      exec(`afplay "${tmpFile}"`, (err) => {
        try {
          unlinkSync(tmpFile);
        } catch {}
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
