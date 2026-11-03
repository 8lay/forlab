import express from "express";
import crypto from "node:crypto";
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function createAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    username: process.env.ADMIN_USERNAME,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function isAdminTokenValid(token) {
  if (!token || !process.env.SESSION_SECRET) {
    return false;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(payload)
    .digest("base64url");

  if (!safeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!isAdminTokenValid(token)) {
    return res.status(401).json({ error: "Authentication required" });
  }

  next();
}

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

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body ?? {};

  if (
    !process.env.ADMIN_USERNAME ||
    !process.env.ADMIN_PASSWORD ||
    !process.env.SESSION_SECRET
  ) {
    return res.status(500).json({ error: "Admin login is not configured" });
  }

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !safeEqual(username, process.env.ADMIN_USERNAME) ||
    !safeEqual(password, process.env.ADMIN_PASSWORD)
  ) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  return res.json({
    token: createAdminToken(),
    expiresIn: 8 * 60 * 60
  });
});

app.get("/api/admin/messages", requireAdmin, async (_req, res) => {
  if (!client) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  try {
    clientPromise ??= client.connect();
    const connectedClient = await clientPromise;
    const messages = await connectedClient
      .db("forlab")
      .collection("messages")
      .find({})
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    return res.json(messages);
  } catch (error) {
    console.error("Failed to load contact messages", error);
    return res.status(500).json({ error: "Unable to load messages" });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Contact API listening on port ${port}`);
});
