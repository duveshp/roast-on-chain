require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const { startListener } = require("./listener");
const {
  initDB,
  upsertProfile,
  getProfile,
  upsertContent,
  getContentForRoast,
  getRecentRoasts,
  getRoastById,
  getParticipantRoasts,
} = require("./db");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ ok: true }));

// ─── Profiles ────────────────────────────────────────────────────────────────

/**
 * GET /profile/:address
 * Returns profile for a wallet address. 200 with defaults if not set yet.
 */
app.get("/profile/:address", async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    const profile = await getProfile(address);
    if (!profile) {
      return res.json({ address, username: "", avatar_url: "", bio: "" });
    }
    res.json(profile);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * POST /profile
 * Body: { address, username, avatar_url?, bio? }
 * Upserts profile. No auth in V1 — wallet address is identity.
 */
app.post("/profile", async (req, res) => {
  const { address, username, avatar_url = "", bio = "" } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }
  if (!username || username.trim().length === 0) {
    return res.status(400).json({ error: "Username required" });
  }
  if (username.trim().length > 32) {
    return res.status(400).json({ error: "Username max 32 chars" });
  }

  try {
    await upsertProfile({
      address: address.toLowerCase(),
      username: username.trim(),
      avatar_url: avatar_url.slice(0, 200),
      bio: bio.slice(0, 160),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Roast Content ───────────────────────────────────────────────────────────

/**
 * POST /roast/:roastId/content
 * Body: { author, content }
 * Stores the actual roast text off-chain. One per address per roast.
 */
app.post("/roast/:roastId/content", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  const { author, content } = req.body;

  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  if (!author || !ethers.isAddress(author)) {
    return res.status(400).json({ error: "Invalid author address" });
  }
  if (!content || content.trim().length === 0) {
    return res.status(400).json({ error: "Content required" });
  }
  if (content.trim().length > 500) {
    return res.status(400).json({ error: "Content max 500 chars" });
  }

  try {
    await upsertContent({
      roast_id: roastId,
      author: author.toLowerCase(),
      content: content.trim(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /roast/:roastId/content
 * Returns all roast submissions for an arena, joined with profiles.
 */
app.get("/roast/:roastId/content", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  try {
    const rows = await getContentForRoast(roastId);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Roast Index ─────────────────────────────────────────────────────────────

/**
 * GET /roasts?limit=20
 * Returns recent roasts, newest first.
 */
app.get("/roasts", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  try {
    const rows = await getRecentRoasts(limit);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * GET /roast/:roastId
 * Returns a single roast from the index.
 */
app.get("/roast/:roastId", async (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  try {
    const row = await getRoastById(roastId);
    if (!row) return res.status(404).json({ error: "Roast not found in index" });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── User Roast History ───────────────────────────────────────────────────────

/**
 * GET /profile/:address/roasts
 * Returns all roasts a wallet has participated in.
 */
app.get("/profile/:address/roasts", async (req, res) => {
  const address = req.params.address.toLowerCase();
  try {
    const rows = await getParticipantRoasts(address);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log(`[server] RoastArena backend running on port ${PORT}`);

  try {
    await initDB();
    console.log("[server] DB initialized successfully");
  } catch (err) {
    console.error("[server] DB init error:", err);
  }

  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.warn("[server] CONTRACT_ADDRESS not set — listener not started.");
    console.warn("[server] Deploy the contract first, then add it to .env");
    return;
  }

  startListener(contractAddress);
});
