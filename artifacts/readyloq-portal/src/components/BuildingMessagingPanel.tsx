/**
 * BuildingMessagingPanel
 *
 * Dispatcher / provider side of the in-portal messaging thread.
 * Slides in from the right when a property row is clicked in the portfolio table.
 * Uses the same SSE + REST pattern as the client widget.
 *
 * Auth: Clerk session cookie — passed automatically by the browser.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Loader2, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { apiUrl } from '../config';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalMessage {
  id: number;
  senderType: 'client' | 'provider';
  senderName: string | null;
  message: string;
  createdAt: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchMessages(address: string): Promise<PortalMessage[]> {
  const res = await fetch(
    apiUrl(`/portal-messages/buildings/${encodeURIComponent(address)}/messages`),
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error('Failed to load messages');
  return res.json();
}

async function sendMessage(address: string, text: string): Promise<PortalMessage> {
  const res = await fetch(
    apiUrl(`/portal-messages/buildings/${encodeURIComponent(address)}/messages`),
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

// ── Bubble ────────────────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: PortalMessage }) {
  const isProvider = msg.senderType === 'provider';
  return (
    <div className={`flex flex-col gap-0.5 ${isProvider ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] text-slate-400">
          {isProvider ? 'You' : (msg.senderName ?? 'Client')}
        </span>
        <span className="text-[10px] text-slate-400/60">
          {format(new Date(msg.createdAt), 'h:mm a')}
        </span>
      </div>
      <div
        className={`max-w-[78%] px-3 py-2 rounded-2xl text-sm leading-snug ${
          isProvider
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-slate-100 text-slate-900 rounded-bl-sm'
        }`}
      >
        {msg.message}
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface BuildingMessagingPanelProps {
  address: string;
  clientName?: string | null;
  onClose: () => void;
}

export function BuildingMessagingPanel({
  address,
  clientName,
  onClose,
}: BuildingMessagingPanelProps) {
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set<number>());

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

  // Initial history.
  useEffect(() => {
    setLoading(true);
    seenIds.current.clear();
    setMessages([]);
    fetchMessages(address)
      .then((msgs) => addMessages(msgs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [address, addMessages]);

  // SSE stream.
  useEffect(() => {
    const url = apiUrl(`/portal-messages/buildings/${encodeURIComponent(address)}/messages/stream`);
    const es = new EventSource(url);
    es.onmessage = (event) => {
      try {
        addMessages([JSON.parse(event.data)]);
      } catch {
        // ignore malformed frames
      }
    };
    return () => es.close();
  }, [address, addMessages]);

  // Auto-scroll.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    try {
      const sent = await sendMessage(address, text);
      addMessages([sent]);
    } catch (e: any) {
      setError(e.message);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-md bg-white border-l border-slate-200 shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 leading-tight">
              {clientName ?? 'Property Manager'}
            </p>
            <p className="text-xs text-slate-500 truncate max-w-[220px]">{address}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-0.5 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {loading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <MessageSquare className="w-8 h-8 text-slate-200 mb-2" />
            <p className="text-sm text-slate-400">No messages yet for this property.</p>
          </div>
        )}
        {messages.map((msg) => (
          <Bubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mb-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-slate-200 px-5 py-3 flex items-end gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Reply to property manager… (Enter to send)"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}
