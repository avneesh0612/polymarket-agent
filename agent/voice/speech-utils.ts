/**
 * Converts agent markdown output into clean, natural speech text.
 * Removes formatting that sounds terrible when read aloud and
 * rewrites technical values (wallet addresses, long numbers) conversationally.
 */
export function toSpeechText(text: string): string {
  let s = text;

  // Shorten wallet/contract addresses: 0x1234...abcd → "address ending in abcd"
  s = s.replace(
    /`?0x[a-fA-F0-9]{4,8}[a-fA-F0-9]{28,}([a-fA-F0-9]{4})`?/g,
    "address ending in $1"
  );

  // Remove fenced code blocks entirely
  s = s.replace(/```[\s\S]*?```/gm, "");

  // Remove inline code backticks but keep content
  s = s.replace(/`([^`]+)`/g, "$1");

  // Remove markdown headers
  s = s.replace(/^#{1,6}\s+/gm, "");

  // Remove bold/italic markers but keep text
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/_([^_]+)_/g, "$1");

  // Strip markdown table rows (| col | col |) and separator lines (|---|---|)
  s = s.replace(/^\|[-:\s|]+\|$/gm, ""); // separator rows
  s = s.replace(/^\|(.+)\|$/gm, (_, inner) =>
    inner
      .split("|")
      .map((c: string) => c.trim())
      .filter(Boolean)
      .join(", ")
  );

  // Remove horizontal rules
  s = s.replace(/^[-=*_]{3,}$/gm, "");

  // Remove bullet/numbered list markers (keep the text)
  s = s.replace(/^[\s]*[-*+]\s+/gm, "");
  s = s.replace(/^[\s]*\d+\.\s+/gm, "");

  // Collapse multiple blank lines
  s = s.replace(/\n{3,}/g, "\n\n");

  // Trim
  s = s.trim();

  return s;
}
