import { apiUrl } from "@/config";

export interface FaieMessage {
  role: "user" | "assistant";
  content: string;
}

interface StreamFaieOptions {
  messages: FaieMessage[];
  onToken: (token: string) => void;
  signal?: AbortSignal;
}

// Streams a FAIE assistant reply via SSE and calls onToken as chunks arrive.
// Throws a user-friendly Error on failure (rate limit, network, etc).
export async function streamFaieReply({ messages, onToken, signal }: StreamFaieOptions): Promise<void> {
  const res = await fetch(apiUrl("/faie-assistant/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = "FAIE is unavailable right now. Please try again in a moment.";
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // No JSON body — keep the default message.
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;

      try {
        const parsed = JSON.parse(payload) as { content?: string; done?: boolean; error?: string };
        if (parsed.error) throw new Error("FAIE ran into an issue answering that. Please try again.");
        if (parsed.content) onToken(parsed.content);
        if (parsed.done) return;
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("FAIE")) throw e;
        // Ignore malformed chunk boundaries; the buffer will catch up.
      }
    }
  }
}
