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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className={`flex flex-col gap-0.5 ${isClient ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] text-muted-foreground">
          {isClient ? 'You' : (msg.senderName ?? 'Provider')}
        </span>
        <span className="text-[10px] text-muted-foreground/60">
          {format(new Date(msg.createdAt), 'h:mm a')}
        </span>
      </div>
      <div
        className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-snug ${
          isClient
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm'
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
    <Card className="border-border flex flex-col" style={{ height: 480 }}>
      <CardHeader className="pb-3 border-b border-border flex-shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          Messages
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Direct line to your pest control team
        </p>
      </CardHeader>

      <CardContent className="flex flex-col flex-1 min-h-0 p-0">
        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <MessageSquare className="w-8 h-8 text-muted-foreground/25 mb-2" />
              <p className="text-sm text-muted-foreground">
                No messages yet. Send one to get started.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <Bubble key={msg.id} msg={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mb-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="flex-shrink-0 border-t border-border px-4 py-3 flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message your provider… (Enter to send)"
            rows={2}
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="flex-shrink-0 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition-all"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
