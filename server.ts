import express from "express";
import "dotenv/config";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { GoogleGenAI } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.join(process.cwd(), '.db_storage');

async function initDb() {
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify({
      user: null,
      sessions: [],
      flashcards: []
    }, null, 2));
  }
}

async function startServer() {
  await initDb();
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // AI Route (Proxy to Gemini)
  app.post("/api/ai", async (req, res) => {
    try {
      const { contents, modelId, isJson, systemInstruction, responseSchema } = req.body;
      
      const apiKey = process.env.USER_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(401).json({ error: "Missing API Key", details: "Please add 'USER_GEMINI_API_KEY' in Settings -> Secrets." });
      }

      // Recommended models from gemini-api skill
      const fallbackModels = [
        "gemini-3-flash-preview",           // High speed, good reasoning
        "gemini-flash-latest",               // Stable flash
        "gemini-3.1-pro-preview",            // High quality fallback
        "gemini-2.0-flash",                  // Newer, but might have quota issues
        "gemini-3.1-flash-lite-preview"      // Ultra lightweight
      ];
      
      const requestedModels = [modelId, ...fallbackModels]
        .filter((m): m is string => !!m)
        .filter((m, i, self) => self.indexOf(m) === i);
      
      let lastError: any = null;
      let hadQuotaError = false;

      const ai = new GoogleGenAI({ apiKey });

      // Format contents for @google/genai SDK
      const formattedContents = typeof contents === 'string' 
        ? [{ role: 'user', parts: [{ text: contents }] }] 
        : contents;

      for (const rawModelName of requestedModels) {
        // Normalize model name (remove 'models/' prefix if present, as SDK adds it)
        const modelName = rawModelName.startsWith('models/') ? rawModelName.substring(7) : rawModelName;
        
        try {
          console.log(`Attempting Gemini request with model: ${modelName}`);
          
          const response = await ai.models.generateContent({
            model: modelName,
            contents: formattedContents,
            config: {
              systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
              responseMimeType: isJson ? "application/json" : undefined,
              responseSchema: responseSchema,
            }
          });

          const responseText = response.text;
          if (!responseText) throw new Error("Empty response from AI");
          return res.json({ text: responseText });
          
        } catch (error: any) {
          const errorMsg = (error.message || "").toLowerCase();
          console.warn(`Gemini Attempt with ${modelName} failed:`, errorMsg);
          
          // 401: Unauthorized / Invalid Key - Stop immediately
          if (errorMsg.includes("api key not valid") || errorMsg.includes("api_key_invalid") || errorMsg.includes("401") || errorMsg.includes("unauthorized")) {
            return res.status(401).json({ 
              error: "Invalid API Key", 
              details: "Your API key is invalid or restricted. Please get a new one from https://aistudio.google.com/app/apikey" 
            });
          }

          // 429: Quota - Record and try next model
          if (errorMsg.includes("quota") || errorMsg.includes("429") || errorMsg.includes("too many requests")) {
            hadQuotaError = true;
            lastError = error;
            continue; 
          }

          // 404 or unsupported: continue to next fallback
          if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("not supported") || errorMsg.includes("deprecated")) {
            lastError = error;
            continue;
          }

          lastError = error;
          continue;
        }
      }

      if (hadQuotaError) {
        return res.status(429).json({
          error: "AI Quota Exceeded",
          details: "The shared Gemini API quota has been reached. Please wait about 60 seconds, or add your own key (USER_GEMINI_API_KEY) in Settings -> Secrets for your own private quota."
        });
      }

      throw lastError || new Error("All AI models fallback failed.");
    } catch (error: any) {
      console.error("AI Error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to generate AI response",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      });
    }
  });

  // API Persistence Routes
  app.get("/api/db", async (req, res) => {
    try {
      const data = await fs.readFile(DB_FILE, 'utf-8');
      res.json(JSON.parse(data));
    } catch (error) {
      res.status(500).json({ error: "Failed to read database" });
    }
  });

  app.post("/api/db", async (req, res) => {
    try {
      await fs.writeFile(DB_FILE, JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save to database" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server is healthy" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

