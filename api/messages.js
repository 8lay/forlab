import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
const clientPromise = client.connect();

function setCorsHeaders(res, origin) {
  const allowedOrigins = new Set([
    "https://forlab.me",
    "https://www.forlab.me"
  ]);

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCorsHeaders(res, req.headers.origin);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.MONGODB_URI) {
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
    return res.status(400).json({ error: "Name, email, and message are required" });
  }

  if (name.length > 100 || email.length > 254 || message.length > 5000) {
    return res.status(400).json({ error: "One or more fields are too long" });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  try {
    const connectedClient = await clientPromise;
    const database = connectedClient.db("forlab");

    await database.collection("messages").insertOne({
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
}
