# genai-gpt

A ChatGPT-style chat app powered by Google Gemini (`gemini-3.1-flash-lite`). It has two parts: an Express API that holds each conversation's history and lets the model search the web, and a React frontend for chatting with it.

## Features

- **Multi-turn conversations.** The server stores each conversation's history, so the model remembers earlier messages.
- **Web search.** The model can call a `web_search` tool, backed by [Tavily](https://tavily.com), when a question needs current or factual information. Replies list the pages it read as sources.
- **Image results.** When the user asks to see pictures, images from the search appear above the reply.
- **Current date awareness.** Each request tells the model today's date and time.
- **Chat sidebar.** The frontend lists your chats, and you can start new ones or delete old ones. Chats are saved in the browser and kept after a reload.
- **Markdown replies.** The frontend renders model replies as Markdown, and links open in a new tab.

## How it works

1. The frontend sends `POST /chat` with the message and a `sessionId` (the chat's id).
2. The server adds the message to that session's history and sends the whole history to Gemini.
3. If Gemini asks to call `web_search`, the server runs the search on Tavily and sends the results back to Gemini. This can repeat for up to 5 rounds.
4. Once Gemini answers in text, the server saves the reply to the history. It returns the reply along with the sources and up to 6 images found during the turn.
5. If anything fails, the server undoes the turn and the history is left as it was, so the message can be sent again.

## Tech stack

| Part | Stack |
| --- | --- |
| Backend | Node.js, Express 5, `@google/genai`, `cors` |
| Frontend | React 19, Vite, `react-markdown` |
| External APIs | Gemini (model), Tavily (web search) |

## Project structure

```
.
├── index.js          # Express API: /chat routes, session history, web_search tool
├── package.json      # Backend dependencies and the `start` script
├── .env              # API keys (not committed)
└── client/           # React frontend (Vite)
    ├── index.html
    ├── vite.config.js
    └── src/
        ├── main.jsx  # React entry point
        ├── App.jsx   # Chat UI: sidebar, messages, sources, images, composer
        └── App.css
```

## Requirements

- Node.js 20.6 or later (`npm start` uses Node's built-in `--env-file` flag)
- A [Gemini API key](https://aistudio.google.com/apikey)
- A [Tavily API key](https://tavily.com) for web search

## Getting started

### 1. Configure API keys

Create a `.env` file in the project root:

```sh
GEMINI_API_KEY=...
TAVILY_API_KEY=tvly-...
```

### 2. Start the API server

```sh
npm install
npm start
```

The server listens on `http://localhost:3000`.

### 3. Start the frontend

In a second terminal:

```sh
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

To make a production build of the frontend, run `npm run build` in `client/`. The output goes to `client/dist/`.

## Configuration

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | `.env` | — | Gemini API key (required) |
| `TAVILY_API_KEY` | `.env` | — | Tavily key for web search (required for search) |
| `PORT` | `.env` or shell | `3000` | Port the API server listens on |
| `CLIENT_ORIGIN` | `.env` or shell | `*` | The only origin allowed by CORS, e.g. `http://localhost:5173`. By default any origin is allowed |
| `VITE_API_URL` | `client/.env` | `http://localhost:3000` | API URL the frontend calls |

## API reference

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/chat` | Send a message and get the model's reply |
| `DELETE` | `/chat/:sessionId` | Clear a conversation's history |

### `POST /chat`

**Request body**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `message` | string | yes | Must not be empty |
| `sessionId` | string | no | Leave it out to start a new conversation. To continue one, send the `sessionId` from an earlier response |

**Response `200`**

```json
{
  "sessionId": "2c064719-8032-4f02-850f-686b5b0ae9e0",
  "reply": "Hello Tarun, it's nice to meet you.",
  "sources": [{ "title": "Eiffel Tower - Wikipedia", "url": "https://en.wikipedia.org/wiki/Eiffel_Tower" }],
  "images": ["https://example.com/eiffel.jpg"]
}
```

`sources` and `images` come from the web searches the model ran for this reply. Both are empty if it didn't search.

**Errors**

| Status | Body | Cause |
| --- | --- | --- |
| `400` | `{ "error": "message is required" }` | `message` missing, empty, or not a string |
| `500` | `{ "error": "failed to get a reply from the model" }` | The Gemini call failed. The message is not saved to history, so you can retry it |

**Example**

Start a conversation:

```sh
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "My name is Tarun."}'
```

Continue it, using the `sessionId` from the first response:

```sh
curl -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": "2c064719-8032-4f02-850f-686b5b0ae9e0", "message": "What is my name?"}'
```

### `DELETE /chat/:sessionId`

Clears the conversation's history. Returns `204 No Content` whether or not the session existed.

```sh
curl -X DELETE http://localhost:3000/chat/2c064719-8032-4f02-850f-686b5b0ae9e0
```

## Limitations

- The server keeps conversation history in memory, so it is lost when the server restarts. The frontend still shows the old messages (they're in localStorage), but the model no longer remembers them.
- Replies are not streamed. Each one arrives in full once the model has finished answering.
- The model can't generate images. It can only show images it finds through web search.
