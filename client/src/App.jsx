import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

const STORAGE_KEY = "genai-chats";
// backend URL; override with VITE_API_URL in client/.env
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// chats live in localStorage so the sidebar survives a page reload
function loadChats() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

const PlusIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
);

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

// open links from model replies in a new tab
const markdownComponents = {
  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
};

const hostname = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// images returned by a web search; broken ones are hidden
function SearchImages({ images }) {
  return (
    <div className="search-images">
      {images.map((src) => (
        <a key={src} href={src} target="_blank" rel="noreferrer">
          <img
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.parentElement.style.display = "none")}
          />
        </a>
      ))}
    </div>
  );
}

// links the model read while answering
function Sources({ sources }) {
  return (
    <div className="sources">
      <div className="sources-label">Sources</div>
      <div className="source-list">
        {sources.map((s, i) => (
          <a key={s.url} className="source" href={s.url} target="_blank" rel="noreferrer" title={s.url}>
            <span className="source-index">{i + 1}</span>
            <span className="source-text">
              <span className="source-title">{s.title || hostname(s.url)}</span>
              <span className="source-host">{hostname(s.url)}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [chats, setChats] = useState(loadChats);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [pendingId, setPendingId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  const activeChat = chats.find((c) => c.id === activeId);
  const messages = activeChat?.messages ?? [];

  useEffect(() => {
    try {
      console.log("chats :",chats)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch {
      // storage unavailable (private mode etc.); chats just won't persist
    }
  }, [chats]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, pendingId]);

  // grow the textarea with its content, up to a limit
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const appendMessage = (chatId, message) =>
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, messages: [...c.messages, message] } : c))
    );

  const newChat = () => {
    setActiveId(null);
    setSidebarOpen(false);
    textareaRef.current?.focus();
  };

  const openChat = (id) => {
    setActiveId(id);
    setSidebarOpen(false);
  };

  const deleteChat = (id) => {
    fetch(`${API_URL}/chat/${id}`, { method: "DELETE" }).catch(() => {});
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) setActiveId(null);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || pendingId) return;

    // the chat id doubles as the server's sessionId
    let chatId = activeId;
    if (!chatId) {
      chatId = crypto.randomUUID();
      setChats((prev) => [{ id: chatId, title: text.slice(0, 40), messages: [] }, ...prev]);
      setActiveId(chatId);
    }

    appendMessage(chatId, { role: "user", text });
    setInput("");
    setPendingId(chatId);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: chatId, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't reach the server");
      appendMessage(chatId, {
        role: "model",
        text: data.reply,
        sources: data.sources ?? [],
        images: data.images ?? [],
      });
    } catch (err) {
      appendMessage(chatId, { role: "error", text: err.message });
    } finally {
      setPendingId(null);
    }
  };

  const onKeyDown = (e) => {
    // Enter sends, Shift+Enter adds a new line
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="new-chat" onClick={newChat}>
          <PlusIcon /> New chat
        </button>
        <div className="chat-list-label">Chats</div>
        <nav className="chat-list">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`chat-item ${chat.id === activeId ? "active" : ""}`}
              onClick={() => openChat(chat.id)}
            >
              <span className="chat-title">{chat.title}</span>
              <button
                className="icon-btn delete"
                aria-label="Delete chat"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteChat(chat.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </nav>
      </aside>
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}

      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}>
            <MenuIcon />
          </button>
          <span className="model-name">Gemini 3.1 Flash Lite</span>
        </header>

        <div className="thread">
          {messages.length === 0 ? (
            <div className="empty">
              <h1>What can I help with?</h1>
            </div>
          ) : (
            <div className="messages">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="message user">
                    <div className="bubble">{m.text}</div>
                  </div>
                ) : m.role === "error" ? (
                  <div key={i} className="message error">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="message model">
                    {m.images?.length > 0 && <SearchImages images={m.images} />}
                    <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
                    {m.sources?.length > 0 && <Sources sources={m.sources} />}
                  </div>
                )
              )}
              {pendingId === activeId && pendingId && (
                <div className="message model">
                  <div className="typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="composer-box">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder="Ask anything"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
            />
            <button className="send" type="submit" aria-label="Send" disabled={!input.trim() || !!pendingId}>
              <SendIcon />
            </button>
          </div>
          <p className="hint">Gemini can make mistakes. Check important info.</p>
        </form>
      </main>
    </div>
  );
}
