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

// The shared assistant API also serves other pages. Keep this homepage-only
// boundary until its broader product prompt has had its own credibility review.
function homepageAnswer(response: string): string {
  const unsupportedClaim = /immutable|chain[- ]of[- ]custody|linear\s+(?:feet|footage)|door\s+frames?|brick\s+courses?|\d+(?:\.\d+)?\s*%|SOC\s*2|certifi(?:ed|cation)|guarantee|end[- ]to[- ]end\s+encrypt|no\s+cross[- ]tenant|every\s+(?:record|management|chemical|ounce)|eliminat(?:e|es|ed)\b.{0,40}\brisk|reconcil(?:e|es|ed)\b.{0,40}\bautomatically/i;
  if (!unsupportedClaim.test(response.replace(/\s+/g, " "))) return response;
  return "That answer included claims that need verification. ReadyLoq supports recorded inspection history, AI-assisted drafts for review, inventory transaction records, and role-based API checks. Voice Capture and Meta glasses capture remain in physical-device validation. We do not publish a calibrated FAIE accuracy score or promise automatic measurements, complete chemical custody, universal immutable audit coverage, or security certification. Confirm pricing and availability with the ReadyLoq team.";
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeForDeduplication(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function FaieAssistant({ className = "", homepageContext = false }: { className?: string; homepageContext?: boolean }) {
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
      if (homepageContext) responseText = homepageAnswer(responseText);

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
          <p className="text-xs text-slate-500 truncate">{homepageContext ? "ReadyLoq product information" : "ReadyLoq's AI Assistant"}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-600 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {homepageContext ? "Product Q&A" : "Online"}
        </span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-[220px] max-h-[360px]">
        <div className="flex">
          <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-slate-100 text-slate-700 text-sm px-4 py-2.5 leading-relaxed">
            {homepageContext
              ? "Hi, I'm FAIE. Ask about ReadyLoq's inspection, inventory, security, pricing, and route-readiness features. This is general product information, not access to your company's records."
              : GREETING}
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
              {homepageContext && m.role === "assistant" && m.content.length > 0 && (
                <p className="mb-2 text-xs font-semibold">AI-generated draft — verify with the ReadyLoq team</p>
              )}
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

      {homepageContext && (
        <p className="px-5 pb-3 text-xs leading-relaxed text-slate-500">
          Answers may contain unverified claims. Confirm pricing and feature
          availability with the team; some capabilities remain in validation.
          Answers do not establish immutable audit coverage, complete chemical
          custody, comprehensive data isolation, compliance certification, or
          freedom from security risks.
        </p>
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
