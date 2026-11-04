import express from "express";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId } from "mongodb";

const execFileAsync = promisify(execFile);
const app = express();
const port = process.env.PORT || 3000;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const allowedOrigins = new Set([
  "https://forlab.me",
  "https://www.forlab.me",
  "https://socialdownload.forlab.me",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
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
      typeof message !== "string" ||
      !name.trim() ||
      !message.trim()
  ) {
    return res.status(400).json({
      error: "Name and message are required"
    });
  }

  if (
      (email !== undefined && typeof email !== "string") ||
      (typeof email === "string" && email.length > 254) ||
      name.length > 100 ||
      message.length > 5000
  ) {
    return res.status(400).json({ error: "One or more fields are too long" });
  }

  if (typeof email === "string" && email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  try {
    clientPromise ??= client.connect();
    const connectedClient = await clientPromise;
    const messageDocument = {
      name: name.trim(),
      message: message.trim(),
      createdAt: new Date()
    };

    if (typeof email === "string" && email.trim()) {
      messageDocument.email = email.trim().toLowerCase();
    }

    await connectedClient.db("forlab").collection("messages").insertOne(messageDocument);

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error("Failed to save contact message", error);
    return res.status(500).json({ error: "Unable to save message" });
  }
});

app.post("/api/extract", (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "Media URL is required" });
  }

  let mediaUrl;
  try {
    mediaUrl = new URL(url.trim());
  } catch {
    return res.status(400).json({ error: "Enter a valid media URL." });
  }

  if (!["http:", "https:"].includes(mediaUrl.protocol)) {
    return res.status(400).json({ error: "Only HTTP and HTTPS URLs are supported." });
  }

  const isYouTube = mediaUrl.hostname === "youtu.be" ||
    mediaUrl.hostname === "www.youtube.com" ||
    mediaUrl.hostname === "youtube.com" ||
    mediaUrl.hostname === "m.youtube.com";

  if (isYouTube) {
    return extractYouTubeMedia(mediaUrl.href, res);
  }

  const extension = mediaUrl.pathname.match(/\.(jpe?g|png|gif|webp|mp4|webm|mov)$/i)?.[1];
  if (!extension) {
    return res.status(422).json({
      error: "This tool supports direct public media URLs only. YouTube and social post URLs must be downloaded through the platform's own tools."
    });
  }

  return res.json({
    title: "downloaded_media",
    downloadUrl: mediaUrl.href,
    ext: extension.toLowerCase()
  });
});
const path = require("path");
const { execFile } = require("child_process");
const util = require("util");
const execFileAsync = util.promisify(execFile);

async function extractYouTubeMedia(url, res) {
  try {
    // Explicitly target the yt-dlp binary in the same directory as server.js
    const ytDlpPath = path.resolve(__dirname, "yt-dlp");

    const { stdout } = await execFileAsync(
        ytDlpPath,
        [
          "--dump-single-json",
          "--no-playlist",
          "--no-warnings",
          "--skip-download",
          url
        ],
        {
          timeout: 30000,
          maxBuffer: 15 * 1024 * 1024 // 15MB buffer limit
        }
    );

    // Extract clean JSON payload even if warnings slip into stdout
    const jsonStart = stdout.indexOf("{");
    const jsonEnd = stdout.lastIndexOf("}");

    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(422).json({ error: "Invalid response format from extractor." });
    }

    const info = JSON.parse(stdout.substring(jsonStart, jsonEnd + 1));
    const format = info.requested_formats?.[0] ?? info;

    if (!format.url) {
      return res.status(422).json({ error: "No downloadable public stream found." });
    }

    return res.json({
      title: info.title || "downloaded_media",
      downloadUrl: format.url,
      thumbnail: info.thumbnail,
      ext: format.ext || "mp4"
    });

  } catch (error) {
    // Log the actual stdout/stderr to your server console so you can inspect it
    console.error("yt-dlp exec error:", error.stderr || error.stdout || error.message);

    return res.status(422).json({
      error: error.stderr || error.message || "Failed to process video link."
    });
  }
}

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

app.delete("/api/admin/messages", requireAdmin, async (req, res) => {
  if (!client) {
    return res.status(500).json({ error: "Database is not configured" });
  }

  const { ids } = req.body ?? {};
  if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !ObjectId.isValid(id))
  ) {
    return res.status(400).json({ error: "Provide between 1 and 100 valid message IDs" });
  }

  try {
    clientPromise ??= client.connect();
    const connectedClient = await clientPromise;
    const result = await connectedClient
        .db("forlab")
        .collection("messages")
        .deleteMany({
          _id: { $in: ids.map((id) => new ObjectId(id)) }
        });

    return res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    console.error("Failed to delete contact messages", error);
    return res.status(500).json({ error: "Unable to delete messages" });
  }
});

app.use(express.static(path.join(currentDirectory, "socialdownload")));

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(port, () => {
  console.log(`Contact API listening on port ${port}`);
});