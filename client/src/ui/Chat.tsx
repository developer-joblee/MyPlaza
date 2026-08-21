import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH } from '@together/shared';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { colorToCss, formatTime } from './util';

export function Chat() {
  const chat = useStore((s) => s.chat);
  const roster = useStore((s) => s.roster);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat, open]);

  const colorOf = (senderId: string): string => {
    const entry = roster.find((r) => r.id === senderId);
    return entry ? colorToCss(entry.color) : 'var(--text-dim)';
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    // só limpa o campo se a mensagem foi de verdade. Antes o `?.emit` sumia com
    // ela em silêncio quando o socket estava caído, e o texto ia junto.
    if (runtime.api?.chatSend(trimmed)) setText('');
  };

  return (
    <div className={`panel chat${open ? '' : ' closed'}`}>
      <button type="button" className="chat-header" onClick={() => setOpen((v) => !v)}>
        <span>Chat da equipe</span>
        <span className="chev">▾</span>
      </button>
      {open && (
        <>
          <div className="chat-list" ref={listRef}>
            {chat.length === 0 && <span className="chat-empty">Nenhuma mensagem ainda 👋</span>}
            {chat.map((msg) => (
              <p className="chat-msg" key={msg.id}>
                <time>{formatTime(msg.timestamp)}</time>
                <span className="sender" style={{ color: colorOf(msg.senderId) }}>
                  {msg.senderName}
                </span>
                {msg.text}
              </p>
            ))}
          </div>
          <form className="chat-form" onSubmit={send}>
            <input
              className="chat-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Mensagem para todos…"
            />
            <button className="chat-send" type="submit" disabled={!text.trim()}>
              Enviar
            </button>
          </form>
        </>
      )}
    </div>
  );
}
