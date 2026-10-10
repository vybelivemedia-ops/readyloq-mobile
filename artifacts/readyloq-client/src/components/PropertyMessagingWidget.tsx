/**
 * PropertyMessagingWidget
 *
 * Real-time message thread between a property manager and their pest control
 * provider. Uses SSE for instant inbound delivery; POSTs to send replies.
 *
 * Auth: inherits the Clerk session cookie — no extra setup needed.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, MessageSquare, Loader2 } from 'lucide-react';
import { apiUrl } from '@/config';
import { format } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalMessage {
  id: number;
  senderType: 'client' | 'provider';
  senderName: string | null;
  message: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchMessages(address: string): Promise<PortalMessage[]> {
  const res = await fetch(
    apiUrl(`/client/buildings/${encodeURIComponent(address)}/messages`),
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error('Failed to load messages');
  return res.json();
}

async function postMessage(address: string, text: string): Promise<PortalMessage> {
  const res = await fetch(
    apiUrl(`/client/buildings/${encodeURIComponent(address)}/messages`),
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to send');
  }
  return res.json();
}

// ── Bubble component ──────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: PortalMessage }) {
  const isClient = msg.senderType === 'client';
  return (
    <div
      className={`flex flex-col gap-1 ${isClient ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2 fade-in-50 duration-300`}
      data-testid={`message-bubble-${msg.id}`}
    >
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          {isClient ? 'You' : (msg.senderName ?? 'Provider')}
        </span>
        <span className="text-[10px] text-muted-foreground/60 font-medium">
          {format(new Date(msg.createdAt), 'h:mm a')}
        </span>
      </div>
      <div
        className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-[14px] leading-relaxed shadow-sm ${
          isClient
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted/60 text-foreground border border-border/50 rounded-bl-sm'
        }`}
      >
        {msg.message}
      </div>
    </div>
  );
}

// ── Widget ────────────────────────────────────────────────────────────────────

export function PropertyMessagingWidget({ address }: { address: string }) {
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<number>());

  // De-dup helper — SSE and optimistic updates can both add the same message.
  const addMessages = useCallback((incoming: PortalMessage[]) => {
    setMessages((prev) => {
      const next = [...prev];
      for (const msg of incoming) {
        if (!seenIds.current.has(msg.id)) {
          seenIds.current.add(msg.id);
          next.push(msg);
        }
      }
      return next.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    });
  }, []);

  // Initial history load.
  useEffect(() => {
    setLoading(true);
    fetchMessages(address)
      .then((msgs) => addMessages(msgs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [address, addMessages]);

  // SSE stream for real-time inbound messages.
  useEffect(() => {
    const es = new EventSource(
      apiUrl(`/client/buildings/${encodeURIComponent(address)}/messages/stream`),
      // EventSource automatically sends cookies — no extra config needed.
    );
    es.onmessage = (event) => {
      try {
        const msg: PortalMessage = JSON.parse(event.data);
        addMessages([msg]);
      } catch {
        // malformed frame — ignore
      }
    };
    es.onerror = () => {
      // Browser auto-reconnects on error; nothing to do.
    };
    return () => es.close();
  }, [address, addMessages]);

  // Auto-scroll on new message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try {
      const sent = await postMessage(address, text);
      addMessages([sent]);
    } catch (e: any) {
      setError(e.message);
      setInput(text); // restore on failure
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-[520px] bg-white">
      <div className="pb-4 border-b border-border/50 bg-muted/20 px-6 py-5 flex-shrink-0">
        <h3 className="text-lg font-semibold flex items-center gap-2 tracking-tight">
          <MessageSquare className="w-5 h-5 text-primary" />
          Comms & Support
        </h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Direct line to your verified pest control team.
        </p>
      </div>

      <div className="flex flex-col flex-1 min-h-0 bg-white/50">
        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mb-3">
                <MessageSquare className="w-6 h-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-medium text-foreground">
                No messages yet.
              </p>
              <p className="text-xs text-muted-foreground mt-1">Send one to get started.</p>
            </div>
          )}
          {messages.map((msg) => (
            <Bubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-6 mb-3 text-sm font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-destructive" />
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="flex-shrink-0 border-t border-border/50 px-6 py-4 bg-white flex items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-2xl border border-input/80 bg-muted/20 px-4 py-3 text-[14px] leading-relaxed placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary/60 transition-all shadow-sm"
            data-testid="input-message"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="flex-shrink-0 w-11 h-11 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 disabled:hover:bg-primary transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 disabled:transform-none"
            data-testid="button-send-message"
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5 ml-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
