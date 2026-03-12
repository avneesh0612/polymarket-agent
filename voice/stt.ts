import { ElevenLabsClient } from "elevenlabs";
import { exec, spawn } from "child_process";
import { unlinkSync, existsSync, readFileSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ChildProcess } from "child_process";

export class SpeechToText {
  private client: ElevenLabsClient;
  private recordingProcess: ChildProcess | null = null;
  private currentTmpFile: string | null = null;

  constructor(apiKey: string) {
    this.client = new ElevenLabsClient({ apiKey });
  }

  /**
   * Records from the microphone until silence is detected (or stopRecording() is called),
   * then transcribes via ElevenLabs Scribe.
   *
   * Requires: brew install sox
   * sox's `silence` effect stops recording after 2.5s of audio below 3% threshold.
   */
  async recordAndTranscribe(): Promise<string> {
    const tmpFile = join(tmpdir(), `stt_${Date.now()}.wav`);
    this.currentTmpFile = tmpFile;

    await this._record(tmpFile);

    try {
      if (!existsSync(tmpFile)) {
        throw new Error("Recording failed: no audio file created. Check microphone permissions.");
      }
      
      const fileSize = statSync(tmpFile).size;
      const minValidSize = 1000; // WAV header is ~44 bytes, need actual audio data
      
      if (fileSize < minValidSize) {
        throw new Error(
          `Recording too short or empty (${fileSize} bytes). ` +
          "Possible causes:\n" +
          "  1. Microphone permissions not granted to Terminal\n" +
          "  2. No audio detected above threshold\n" +
          "  3. Check System Settings > Privacy & Security > Microphone"
        );
      }
      
      const audioBuffer = readFileSync(tmpFile);
      const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
      const audioFile = new File([audioBlob], "recording.wav", { type: "audio/wav" });
      
      const response = await this.client.speechToText.convert({
        file: audioFile,
        model_id: "scribe_v1",
        language_code: "en", // Force English — prevents mixed-language transcription
      });
      return response.text.trim();
    } finally {
      this.currentTmpFile = null;
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    }
  }

  /** Start recording and return a promise that resolves when recording ends. */
  private _record(outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use sox silence detection: stop after 2.5s of audio < 3% volume
      this.recordingProcess = spawn("rec", [
        "-r", "16000",
        "-c", "1",
        "-b", "16",
        outputPath,
        "silence", "1", "0.1", "3%", "1", "2.5", "3%",
      ]);

      this.recordingProcess.on("close", (code) => {
        this.recordingProcess = null;
        resolve();
      });

      this.recordingProcess.on("error", (err) => {
        this.recordingProcess = null;
        if ((err as any).code === "ENOENT") {
          reject(
            new Error(
              "sox not found. Install it with: brew install sox\n" +
              "Also install the MP3 handler: brew install sox --with-lame"
            )
          );
        } else {
          reject(err);
        }
      });
    });
  }

  /** Manually stop an in-progress recording. */
  stopRecording(): void {
    if (this.recordingProcess) {
      this.recordingProcess.kill("SIGINT");
      this.recordingProcess = null;
    }
  }
}
