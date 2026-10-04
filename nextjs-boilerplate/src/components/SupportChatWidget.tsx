'use client';

import { FormEvent, useState } from 'react';
import { usePathname } from 'next/navigation';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sources?: { id: string; question: string; category: string | null }[];
}

export function SupportChatWidget({ promoterId }: { promoterId?: string }) {
  const [open, setOpen] = useState(false);
  // Kolo 8 / krok 9: na mobilu bublina zakrývala přilepenou lištu nákupu (výběr míst, kategorie, pokladna)
  const pathname = usePathname() ?? '';
  const overPurchaseBar = /\/events\/[^/]+\/seats|\/checkout/.test(pathname);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Ahoj! Jsem AI asistent. Můžu ti pomoci s lístky, refundy, slevami, nebo jak používat platformu. Co potřebuješ?',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (input.length < 2) return;
    const userMsg: ChatMessage = { role: 'user', text: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/support/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.text, promoterId }),
      });
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', text: 'Bohužel jsem nedokázal odpovědět. Zkus to znovu nebo napiš na support@tixly.cz.' },
        ]);
        return;
      }
      const j = (await res.json()) as {
        answer: string;
        sources?: { id: string; question: string; category: string | null }[];
      };
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: j.answer, sources: j.sources },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Síťová chyba. Zkus to znovu.' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed ${overPurchaseBar ? 'bottom-52 sm:bottom-6' : 'bottom-6'} right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-3xl text-primary-foreground shadow-lg transition hover:scale-105`}
        aria-label="Otevřít chat support"
      >
        💬
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[500px] w-[360px] flex-col rounded-lg border bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b bg-primary p-3 text-primary-foreground">
        <div>
          <div className="text-sm font-bold">Tixly AI assistant</div>
          <div className="text-xs opacity-80">Odpovědi na nejčastější dotazy</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xl opacity-80 hover:opacity-100"
          aria-label="Zavřít"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'ml-auto max-w-[85%] rounded-lg bg-primary p-2 text-sm text-primary-foreground'
                : 'mr-auto max-w-[85%] rounded-lg bg-muted p-2 text-sm'
            }
          >
            <p className="whitespace-pre-line">{m.text}</p>
            {m.sources && m.sources.length > 0 ? (
              <div className="mt-2 space-y-1 border-t border-foreground/10 pt-2">
                <div className="text-[10px] uppercase opacity-60">Zdroje</div>
                {m.sources.map((s) => (
                  <div key={s.id} className="text-[11px] opacity-80">
                    · {s.question}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {busy ? (
          <div className="mr-auto max-w-[85%] rounded-lg bg-muted p-2 text-sm">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary"></span>
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:0.2s]"></span>
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:0.4s]"></span>
            </span>
          </div>
        ) : null}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Napiš dotaz…"
          className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || input.length < 2}
          className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
