import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader, MessageSquare } from 'lucide-react';

export default function AIChatBar() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const r = await fetch('/api/ai-quant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, contextSource: 'scanner' }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, ts: Date.now() }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}`, ts: Date.now(), error: true }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className={`aiq-chat ${expanded ? 'aiq-chat--expanded' : ''}`}>
      <div className="aiq-chat__header" onClick={() => setExpanded(!expanded)}>
        <MessageSquare size={15} />
        <span>AI Chat</span>
        <span className="aiq-chat__toggle">{expanded ? '▼' : '▲'}</span>
      </div>

      {expanded && (
        <div className="aiq-chat__body">
          <div className="aiq-chat__messages">
            {messages.length === 0 && (
              <div className="aiq-chat__empty">
                Ask about tickers, setups, or market conditions. The AI has access to live scanner context.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`aiq-chat__msg aiq-chat__msg--${m.role} ${m.error ? 'aiq-chat__msg--error' : ''}`}>
                <div className="aiq-chat__msg-icon">
                  {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                </div>
                <div className="aiq-chat__msg-text">{m.content}</div>
              </div>
            ))}
            {loading && (
              <div className="aiq-chat__msg aiq-chat__msg--assistant">
                <div className="aiq-chat__msg-icon"><Bot size={14} /></div>
                <div className="aiq-chat__msg-text aiq-chat__typing"><Loader size={14} className="aiq-spin" /> Thinking…</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="aiq-chat__input-row">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a ticker, setup, or market conditions…"
              className="aiq-chat__input"
              disabled={loading}
            />
            <button className="aiq-chat__send" onClick={sendMessage} disabled={loading || !input.trim()}>
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
