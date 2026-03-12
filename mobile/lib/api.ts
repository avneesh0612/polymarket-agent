const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

export async function sendMessage(
  message: string,
  authToken: string,
  threadId?: string
): Promise<string> {
  const res = await fetch(`${API_URL}/api/agent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ message, threadId }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data.response;
}

export async function getDelegationStatus(authToken: string): Promise<{
  delegated: boolean;
  address?: string;
  chain?: string;
}> {
  const res = await fetch(`${API_URL}/api/delegation/status`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  return res.json();
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

  const res = await fetch(`${API_URL}/api/voice/stt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authToken}` },
    body: formData,
  });

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
