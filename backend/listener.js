const { ethers } = require("ethers");
const {
  insertRoast,
  updateRoastSettled,
  updateRoastCancelled,
  insertParticipant,
} = require("./db");

const ABI = [
  "event RoastCreated(uint256 indexed roastId, address indexed creator, uint256 roastStake, uint256 voteStake, uint256 openUntil, uint256 voteUntil)",
  "event ParticipantJoined(uint256 indexed roastId, address indexed participant)",
  "event VoteCast(uint256 indexed roastId, address indexed voter, address indexed candidate)",
  "event RoastSettled(uint256 indexed roastId, uint256 numWinners, uint256 roasterPool, uint256 voterPool, uint256 winnerVoterCount)",
  "event RoastCancelled(uint256 indexed roastId, string reason)",
];

let contract = null;

function startListener(contractAddress) {
  const provider = new ethers.JsonRpcProvider(
    process.env.MONAD_RPC || "http://127.0.0.1:8545"
  );

  contract = new ethers.Contract(contractAddress, ABI, provider);

  console.log(`[listener] Watching ${contractAddress}`);

  // ── RoastCreated ─────────────────────────────────────────────────────────
  contract.on("RoastCreated", (roastId, creator, roastStake, voteStake, openUntil, voteUntil, event) => {
    try {
      insertRoast.run({
        roast_id:     Number(roastId),
        creator:      creator.toLowerCase(),
        roast_stake:  roastStake.toString(),
        vote_stake:   voteStake.toString(),
        open_until:   Number(openUntil),
        vote_until:   Number(voteUntil),
        tx_hash:      event.log.transactionHash,
        block_number: event.log.blockNumber,
      });
      console.log(`[listener] RoastCreated  id=${roastId} creator=${creator}`);
    } catch (err) {
      console.error("[listener] RoastCreated error:", err.message);
    }
  });

  // ── ParticipantJoined ────────────────────────────────────────────────────
  contract.on("ParticipantJoined", (roastId, participant, event) => {
    try {
      insertParticipant.run({
        roast_id: Number(roastId),
        address:  participant.toLowerCase(),
        tx_hash:  event.log.transactionHash,
      });
      console.log(`[listener] ParticipantJoined id=${roastId} addr=${participant}`);
    } catch (err) {
      console.error("[listener] ParticipantJoined error:", err.message);
    }
  });

  // ── VoteCast ─────────────────────────────────────────────────────────────
  contract.on("VoteCast", (roastId, voter, candidate) => {
    console.log(`[listener] VoteCast      id=${roastId} voter=${voter} -> ${candidate}`);
  });

  // ── RoastSettled ─────────────────────────────────────────────────────────
  contract.on("RoastSettled", (roastId, numWinners, roasterPool, voterPool, winnerVoterCount) => {
    try {
      updateRoastSettled.run({
        roast_id:          Number(roastId),
        num_winners:       Number(numWinners),
        roaster_pool:      roasterPool.toString(),
        voter_pool:        voterPool.toString(),
        winner_voter_count: Number(winnerVoterCount),
      });
      console.log(`[listener] RoastSettled  id=${roastId} numWinners=${numWinners}`);
    } catch (err) {
      console.error("[listener] RoastSettled error:", err.message);
    }
  });

  // ── RoastCancelled ───────────────────────────────────────────────────────
  contract.on("RoastCancelled", (roastId, reason) => {
    try {
      updateRoastCancelled.run({ roast_id: Number(roastId) });
      console.log(`[listener] RoastCancelled id=${roastId} reason="${reason}"`);
    } catch (err) {
      console.error("[listener] RoastCancelled error:", err.message);
    }
  });

  provider.on("error", (err) => {
    console.error("[listener] Provider error:", err.message);
  });
}

module.exports = { startListener };
