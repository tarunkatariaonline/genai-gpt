import { GoogleGenAI } from "@google/genai";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const app = express();
// allow the React frontend (a different origin) to call this API;
// set CLIENT_ORIGIN to restrict it to one site, e.g. http://localhost:5173
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "*" }));
app.use(express.json());

// conversation history per session: every user message and model reply is stored here
const sessions = new Map();

// tools the model can call; we run them ourselves and send the result back
const tools = [
  {
    type: "function",
    name: "web_search",
    description:
      "Search the web for current information, news, or facts you don't know. Returns the top results with title, url and content.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
];

// run a web search with Tavily (https://tavily.com)
async function webSearch({ query }) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ query, max_results: 5, include_answer: true, include_images: true }),
  });
  if (!res.ok) throw new Error(`Tavily search failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  return {
    answer: data.answer,
    results: data.results.map(({ title, url, content }) => ({ title, url, content })),
    // image urls go to the frontend only; the model doesn't need them
    images: data.images ?? [],
  };
}

const toolHandlers = { web_search: webSearch };

// the model may ask for several rounds of tool calls before it answers
const MAX_TOOL_ROUNDS = 5;

// how many search images to send to the frontend per reply
const MAX_IMAGES = 6;

app.post("/chat", async (req, res) => {
  const { message } = req.body ?? {};
  if (typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }

  const sessionId = req.body.sessionId ?? randomUUID();
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  const history = sessions.get(sessionId);

  // remember where this turn starts so a failure can roll it back
  const turnStart = history.length;

  // add user message to history
  history.push({
    type: "user_input",
    content: [{ type: "text", text: message }],
  });

  // links and images found by web searches this turn, sent to the frontend
  const sources = new Map();
  const images = new Set();

  try {
    let interaction;
    for (let round = 0; ; round++) {
      interaction = await ai.interactions.create({
        system_instruction: `
today date is :  ${new Date().toString()}
use the web_search tool when the question needs current or factual information you are not sure about, and cite the source urls
use web_search when the user asks to see pictures; images it finds are shown to the user automatically, so just answer in text
you cannot generate images; never reply with tool calls or json as text
        `,

        model: "gemini-3.1-flash-lite",
        input: history,
        tools,
      });

      const calls = (interaction.steps ?? []).filter((s) => s.type === "function_call");
      if (calls.length === 0) break;
      if (round >= MAX_TOOL_ROUNDS) throw new Error("too many tool call rounds");

      // keep the model's steps (thoughts + calls) so it sees what it asked for
      history.push(...interaction.steps.filter((s) => s.type !== "user_input"));

      for (const call of calls) {
        const handler = toolHandlers[call.name];
        try {
          if (!handler) throw new Error(`unknown tool: ${call.name}`);
          console.log(`tool call: ${call.name}`, call.arguments);
          const { images: foundImages = [], ...result } = await handler(call.arguments);
          for (const { title, url } of result.results ?? []) sources.set(url, { title, url });
          for (const url of foundImages) images.add(url);
          if (foundImages.length > 0) {
            result.note = `${foundImages.length} images from this search are already displayed to the user above your answer; refer to them instead of saying you can't show images`;
          }
          history.push({
            type: "function_result",
            call_id: call.id,
            name: call.name,
            result: JSON.stringify(result),
          });
        } catch (toolErr) {
          // let the model know the tool failed so it can answer without it
          console.error(toolErr);
          history.push({
            type: "function_result",
            call_id: call.id,
            name: call.name,
            is_error: true,
            result: String(toolErr.message ?? toolErr),
          });
        }
      }
    }

    const reply = interaction.output_text;

    // add model reply to history so the next turn has full context
    history.push({
      type: "model_output",
      content: [{ type: "text", text: reply }],
    });

    res.json({
      sessionId,
      reply,
      sources: [...sources.values()],
      images: [...images].slice(0, MAX_IMAGES),
    });
  } catch (err) {
    // drop the unanswered user message (and any tool steps) so the history stays consistent
    history.length = turnStart;
    console.error(err);
    res.status(500).json({ error: "failed to get a reply from the model" });
  }
});

// clear a session's history
app.delete("/chat/:sessionId", (req, res) => {
  sessions.delete(req.params.sessionId);
  res.status(204).end();
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
