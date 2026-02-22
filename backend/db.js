const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "roastarena.db"));

db.pragma("journal_mode = WAL");

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    address     TEXT PRIMARY KEY,
    username    TEXT NOT NULL DEFAULT '',
    avatar_url  TEXT NOT NULL DEFAULT '',
    bio         TEXT NOT NULL DEFAULT '',
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS roast_content (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    roast_id    INTEGER NOT NULL,
    author      TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(roast_id, author)
  );

  CREATE TABLE IF NOT EXISTS roast_index (
    roast_id          INTEGER PRIMARY KEY,
    creator           TEXT NOT NULL,
    roast_stake       TEXT NOT NULL DEFAULT '0',   -- wei as string
    vote_stake        TEXT NOT NULL DEFAULT '0',   -- wei as string
    open_until        INTEGER NOT NULL,
    vote_until        INTEGER NOT NULL,
    state             TEXT NOT NULL DEFAULT 'OPEN',
    num_winners       INTEGER,
    roaster_pool      TEXT,                        -- wei as string
    voter_pool        TEXT,                        -- wei as string
    winner_voter_count INTEGER,
    tx_hash           TEXT,
    block_number      INTEGER,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS participant_index (
    roast_id    INTEGER NOT NULL,
    address     TEXT NOT NULL,
    tx_hash     TEXT,
    PRIMARY KEY (roast_id, address)
  );

  CREATE INDEX IF NOT EXISTS idx_content_roast    ON roast_content(roast_id);
  CREATE INDEX IF NOT EXISTS idx_content_author   ON roast_content(author);
  CREATE INDEX IF NOT EXISTS idx_participant_addr ON participant_index(address);
`);

// ─── Profile Helpers ────────────────────────────────────────────────────────

const upsertProfile = db.prepare(`
  INSERT INTO profiles (address, username, avatar_url, bio, updated_at)
  VALUES (@address, @username, @avatar_url, @bio, strftime('%s', 'now'))
  ON CONFLICT(address) DO UPDATE SET
    username   = excluded.username,
    avatar_url = excluded.avatar_url,
    bio        = excluded.bio,
    updated_at = excluded.updated_at
`);

const getProfile = db.prepare(`SELECT * FROM profiles WHERE address = ?`);

// ─── Content Helpers ────────────────────────────────────────────────────────

const upsertContent = db.prepare(`
  INSERT INTO roast_content (roast_id, author, content)
  VALUES (@roast_id, @author, @content)
  ON CONFLICT(roast_id, author) DO UPDATE SET
    content    = excluded.content,
    created_at = strftime('%s', 'now')
`);

const getContentForRoast = db.prepare(`
  SELECT rc.*, p.username, p.avatar_url
  FROM roast_content rc
  LEFT JOIN profiles p ON p.address = rc.author
  WHERE rc.roast_id = ?
  ORDER BY rc.created_at ASC
`);

// ─── Roast Index Helpers ────────────────────────────────────────────────────

const insertRoast = db.prepare(`
  INSERT OR IGNORE INTO roast_index
    (roast_id, creator, roast_stake, vote_stake, open_until, vote_until, tx_hash, block_number)
  VALUES
    (@roast_id, @creator, @roast_stake, @vote_stake, @open_until, @vote_until, @tx_hash, @block_number)
`);

const updateRoastSettled = db.prepare(`
  UPDATE roast_index
  SET state              = 'SETTLED',
      num_winners        = @num_winners,
      roaster_pool       = @roaster_pool,
      voter_pool         = @voter_pool,
      winner_voter_count = @winner_voter_count
  WHERE roast_id = @roast_id
`);

const updateRoastCancelled = db.prepare(`
  UPDATE roast_index SET state = 'CANCELLED' WHERE roast_id = @roast_id
`);

const getRecentRoasts = db.prepare(`
  SELECT ri.*, p.username as creator_username
  FROM roast_index ri
  LEFT JOIN profiles p ON p.address = ri.creator
  ORDER BY ri.roast_id DESC
  LIMIT ?
`);

const getRoastById = db.prepare(`
  SELECT ri.*, p.username as creator_username
  FROM roast_index ri
  LEFT JOIN profiles p ON p.address = ri.creator
  WHERE ri.roast_id = ?
`);

// ─── Participant Index Helpers ──────────────────────────────────────────────

const insertParticipant = db.prepare(`
  INSERT OR IGNORE INTO participant_index (roast_id, address, tx_hash)
  VALUES (@roast_id, @address, @tx_hash)
`);

const getParticipantRoasts = db.prepare(`
  SELECT pi.roast_id, ri.state, ri.open_until, ri.vote_until,
         ri.roast_stake, ri.vote_stake, ri.num_winners
  FROM participant_index pi
  JOIN roast_index ri ON ri.roast_id = pi.roast_id
  WHERE pi.address = ?
  ORDER BY pi.roast_id DESC
`);

module.exports = {
  db,
  upsertProfile,
  getProfile,
  upsertContent,
  getContentForRoast,
  insertRoast,
  updateRoastSettled,
  updateRoastCancelled,
  getRecentRoasts,
  getRoastById,
  insertParticipant,
  getParticipantRoasts,
};
