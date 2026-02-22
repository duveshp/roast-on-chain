require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const { ethers } = require("ethers");
const { startListener } = require("./listener");
const {
  upsertProfile,
  getProfile,
  upsertContent,
  getContentForRoast,
  getRecentRoasts,
  getRoastById,
  getParticipantRoasts,
} = require("./db");

const app  = express();
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
app.get("/profile/:address", (req, res) => {
  const address = req.params.address.toLowerCase();
  const profile = getProfile.get(address);
  if (!profile) {
    return res.json({ address, username: "", avatar_url: "", bio: "" });
  }
  res.json(profile);
});

/**
 * POST /profile
 * Body: { address, username, avatar_url?, bio? }
 * Upserts profile. No auth in V1 — wallet address is identity.
 */
app.post("/profile", (req, res) => {
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

  upsertProfile.run({
    address:    address.toLowerCase(),
    username:   username.trim(),
    avatar_url: avatar_url.slice(0, 200),
    bio:        bio.slice(0, 160),
  });

  res.json({ ok: true });
});

// ─── Roast Content ───────────────────────────────────────────────────────────

/**
 * POST /roast/:roastId/content
 * Body: { author, content }
 * Stores the actual roast text off-chain. One per address per roast.
 */
app.post("/roast/:roastId/content", (req, res) => {
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

  upsertContent.run({
    roast_id: roastId,
    author:   author.toLowerCase(),
    content:  content.trim(),
  });

  res.json({ ok: true });
});

/**
 * GET /roast/:roastId/content
 * Returns all roast submissions for an arena, joined with profiles.
 */
app.get("/roast/:roastId/content", (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  const rows = getContentForRoast.all(roastId);
  res.json(rows);
});

// ─── Roast Index ─────────────────────────────────────────────────────────────

/**
 * GET /roasts?limit=20
 * Returns recent roasts, newest first.
 */
app.get("/roasts", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  const rows  = getRecentRoasts.all(limit);
  res.json(rows);
});

/**
 * GET /roast/:roastId
 * Returns a single roast from the index.
 */
app.get("/roast/:roastId", (req, res) => {
  const roastId = parseInt(req.params.roastId, 10);
  if (isNaN(roastId) || roastId < 0) {
    return res.status(400).json({ error: "Invalid roast ID" });
  }
  const row = getRoastById.get(roastId);
  if (!row) return res.status(404).json({ error: "Roast not found in index" });
  res.json(row);
});

// ─── User Roast History ───────────────────────────────────────────────────────

/**
 * GET /profile/:address/roasts
 * Returns all roasts a wallet has participated in.
 */
app.get("/profile/:address/roasts", (req, res) => {
  const address = req.params.address.toLowerCase();
  const rows    = getParticipantRoasts.all(address);
  res.json(rows);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] RoastArena backend running on port ${PORT}`);

  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.warn("[server] CONTRACT_ADDRESS not set — listener not started.");
    console.warn("[server] Deploy the contract first, then add it to .env");
    return;
  }

  startListener(contractAddress);
});
