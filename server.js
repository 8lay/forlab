import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { MongoClient, ObjectId } from "mongodb";

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

const execFileAsync = promisify(execFile);
const isWindows = os.platform() === "win32";

async function getExecutablePath() {
  if (isWindows) {
    return path.join(currentDirectory, "yt-dlp.exe");
  }

  const tmpBinaryPath = "/tmp/yt-dlp";
  const fileExists = fs.existsSync(tmpBinaryPath);

  let isOld = false;
  if (fileExists) {
    const stats = fs.statSync(tmpBinaryPath);
    const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
    if (ageInHours > 12) isOld = true;
  }

  if (!fileExists || isOld) {
    try {
      console.log("Fetching fresh Linux yt-dlp binary to /tmp...");
      const response = await fetch("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp", {
        headers: { "User-Agent": "Mozilla/5.0" }
      });

      if (response.ok) {
        const fileStream = fs.createWriteStream(tmpBinaryPath);
        await pipeline(Readable.fromWeb(response.body), fileStream);
        fs.chmodSync(tmpBinaryPath, 0o755);
      }
    } catch (err) {
      console.error("Failed to auto-update yt-dlp binary:", err);
    }
  }

  return tmpBinaryPath;
}

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

// ==========================================
// MEDIA EXTRACTION ROUTE
// ==========================================
app.post("/api/extract", async (req, res) => {
  const { url } = req.body ?? {};

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ error: "Media URL is required" });
  }

  try {
    const ytDlpPath = await getExecutablePath();
    const cookiesPath = path.join(currentDirectory, "cookies.txt");

    const args = [
      "-j",
      "--no-playlist",
      "--no-check-certificates",
      "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "--extractor-args", "youtube:player_client=tv,creator",
      url.trim()
    ];

    if (fs.existsSync(cookiesPath)) {
      args.push("--cookies", cookiesPath);
    }

    const { stdout } = await execFileAsync(ytDlpPath, args, { timeout: 30000 });
    const output = JSON.parse(stdout);

    return res.json({
      title: output.title || "downloaded_media",
      downloadUrl: output.url,
      thumbnail: output.thumbnail,
      ext: output.ext || "mp4"
    });
  } catch (error) {
    const rawError = error.stderr || error.stdout || error.message || String(error);
    console.error("yt-dlp extraction failed:", rawError);

    // Clean error message for user UI
    const cleanError = rawError.includes("Sign in to confirm")
        ? "YouTube requested authentication. Please add cookies.txt to backend."
        : "Media extraction failed. Verify link is public and accessible.";

    return res.status(500).json({
      error: "Extraction failed",
      details: cleanError
    });
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