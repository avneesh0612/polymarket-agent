import { sql } from "./db";

export async function saveChatMessage(
  userId: string,
  threadId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  try {
    await sql`
      INSERT INTO chat_history (user_id, thread_id, role, content)
      VALUES (${userId}, ${threadId}, ${role}, ${content})
    `;
  } catch (err) {
    console.warn("[chat] Failed to save message:", err);
  }
}

export async function getChatHistory(
  userId: string,
  threadId: string,
  limit = 100
): Promise<{ role: "user" | "assistant"; content: string; created_at: string }[]> {
  try {
    const rows = await sql`
      SELECT role, content, created_at
      FROM chat_history
      WHERE user_id = ${userId} AND thread_id = ${threadId}
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;
    return rows as { role: "user" | "assistant"; content: string; created_at: string }[];
  } catch (err) {
    console.warn("[chat] Failed to load history:", err);
    return [];
  }
}
