const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export async function getChatHistory(
  authToken: string
): Promise<{ role: "user" | "assistant"; content: string; created_at: string }[]> {
  const res = await fetch(`${API_URL}/api/history`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages ?? [];
}

export async function sendMessage(
  message: string,
  authToken: string,
  signal?: AbortSignal,
  threadId?: string
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/agent`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ message, threadId }),
    });
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Request cancelled.");
    throw new Error("Network error. Check your connection and try again.");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`);
  return data.response;
}

export async function getDelegationStatus(authToken: string): Promise<{
  delegated: boolean;
  address?: string;
  chain?: string;
}> {
  try {
    const res = await fetch(`${API_URL}/api/delegation/status`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return { delegated: false };
    return res.json();
  } catch {
    return { delegated: false };
  }
}

export async function transcribeAudio(
  audioUri: string,
  authToken: string
): Promise<string> {
  const formData = new FormData();
  formData.append("audio", {
    uri: audioUri,
    name: "recording.m4a",
    type: "audio/m4a",
  } as any);

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/voice/stt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });
  } catch {
    throw new Error("Network error. Check your connection and try again.");
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Transcription failed");
  return data.text;
}

export async function textToSpeech(
  text: string,
  authToken: string
): Promise<string> {
  const res = await fetch(`${API_URL}/api/voice/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) throw new Error("TTS failed");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
