import express from "express";
import { MongoClient } from "mongodb";

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigins = new Set([
  "https://forlab.me",
  "https://www.forlab.me"
]);

const client = process.env.MONGODB_URI
  ? new MongoClient(process.env.MONGODB_URI)
  : null;
let clientPromise;

app.use(express.json({ limit: "20kb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/api/messages", (_req, res) => {
  res.status(405).json({ error: "Method not allowed" });
});

app.post("/api/messages", async (req, res) => {
  if (!client) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  const { name, email, message } = req.body ?? {};

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof message !== "string" ||
    !name.trim() ||
    !email.trim() ||
    !message.trim()
  ) {
    return res.status(400).json({
      error: "Name, email, and message are required"
    });
  }

  if (name.length > 100 || email.length > 254 || message.length > 5000) {
    return res.status(400).json({ error: "One or more fields are too long" });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  try {
    clientPromise ??= client.connect();
    const connectedClient = await clientPromise;

    await connectedClient.db("forlab").collection("messages").insertOne({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: message.trim(),
      createdAt: new Date()
    });

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error("Failed to save contact message", error);
    return res.status(500).json({ error: "Unable to save message" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Contact API listening on port ${port}`);
});
