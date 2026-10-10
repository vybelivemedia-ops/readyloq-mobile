import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { streamFaieReply, type FaieMessage } from "@/lib/faie";

interface DisplayMessage extends FaieMessage {
  id: string;
}

const SUGGESTED_QUESTIONS = [
  "How does AI inspection vision work?",
  "How does the 90-day pilot work?",
  "How is my company's data isolated from others?",
  "What is dual-level route readiness?",
];

const GREETING =
  "Hi, I'm FAIE — ReadyLoq's AI assistant. Ask me about inspections, route readiness, inventory, security, or pricing.";

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeForDeduplication(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function FaieAssistant({ className = "" }: { className?: string }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const normalizedPrompt = normalizeForDeduplication(trimmed);
    const hasAskedAlready = messages.some(
      (message) =>
        message.role === "user" &&
        normalizeForDeduplication(message.content) === normalizedPrompt,
    );
    if (hasAskedAlready) {
      setInput("");
      setError("FAIE already answered that question above.");
      return;
    }

    setError(null);
    setInput("");

    const userMsg: DisplayMessage = { id: makeId(), role: "user", content: trimmed };
    const assistantId = makeId();
    const history = [...messages, userMsg];
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);
    setIsStreaming(true);

    try {
      let responseText = "";
      await streamFaieReply({
        messages: history.map(({ role, content }) => ({ role, content })),
        // Buffer the answer until it is complete. This lets the public demo
        // guarantee that a repeated answer is never briefly rendered before
        // the duplicate check can run.
        onToken: (token) => { responseText += token; },
      });

      const normalizedResponse = normalizeForDeduplication(responseText);
      const hasAnsweredAlready = messages.some(
        (message) =>
          message.role === "assistant" &&
          normalizeForDeduplication(message.content) === normalizedResponse,
      );
      if (!normalizedResponse || hasAnsweredAlready) {
        setMessages((prev) =>
          prev.filter((message) => message.id !== assistantId && message.id !== userMsg.id),
        );
        if (hasAnsweredAlready) {
          setError("FAIE already shared that answer above.");
        }
      } else {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: responseText }
              : message,
          ),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content.length > 0));
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div
      className={`flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles size={18} className="text-primary" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-slate-900 text-sm leading-tight">FAIE</p>
          <p className="text-xs text-slate-500 truncate">ReadyLoq's AI Assistant</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Online
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-[220px] max-h-[360px]">
        <div className="flex">
          <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-slate-100 text-slate-700 text-sm px-4 py-2.5 leading-relaxed">
            {GREETING}
          </div>
        </div>
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[90%] rounded-2xl text-sm px-4 py-2.5 leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-slate-100 text-slate-700 rounded-tl-sm"
              }`}
            >
              {m.content.length > 0 ? m.content : <Loader2 size={14} className="animate-spin" />}
            </div>
          </div>
        ))}
        {error && <p className="text-xs text-red-500 px-1">{error}</p>}
      </div>

      {messages.length === 0 && (
        <div className="px-5 pb-3 flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="text-xs px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:border-primary hover:text-primary transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/50"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask FAIE about ReadyLoq..."
          disabled={isStreaming}
          className="flex-1 bg-white border border-slate-200 rounded-full px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        />
        <Button type="submit" size="icon" disabled={isStreaming || !input.trim()} className="rounded-full shrink-0">
          {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </form>
    </div>
  );
}
