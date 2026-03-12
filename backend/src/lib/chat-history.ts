import { supabase } from "./supabase";

export async function saveChatMessage(
  userId: string,
  threadId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  const { error } = await supabase.from("chat_history").insert({
    user_id: userId,
    thread_id: threadId,
    role,
    content,
  });
  if (error) console.warn("[chat] Failed to save message:", error.message);
}

export async function getChatHistory(
  userId: string,
  threadId: string,
  limit = 100
): Promise<{ role: "user" | "assistant"; content: string; created_at: string }[]> {
  const { data, error } = await supabase
    .from("chat_history")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.warn("[chat] Failed to load history:", error.message);
    return [];
  }
  return (data ?? []) as { role: "user" | "assistant"; content: string; created_at: string }[];
}
