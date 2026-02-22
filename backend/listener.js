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
let lastPolledBlock = 0;

async function pollEvents() {
  if (!contract) return;

  try {
    const currentBlock = await contract.runner.provider.getBlockNumber();
    if (lastPolledBlock === 0) {
      // Initialize if starting up, just check last 100 blocks or from current
      lastPolledBlock = currentBlock - 100;
      if (lastPolledBlock < 0) lastPolledBlock = 0;
    }

    if (currentBlock <= lastPolledBlock) return;

    const fromBlock = lastPolledBlock + 1;
    const toBlock = currentBlock;

    // Fetch all events in the block range
    const filter = {
      address: contract.target,
      fromBlock,
      toBlock
    };

    const logs = await contract.runner.provider.getLogs(filter);

    for (const log of logs) {
      const parsedLog = contract.interface.parseLog({
        topics: [...log.topics],
        data: log.data
      });

      if (!parsedLog) continue;

      try {
        if (parsedLog.name === "RoastCreated") {
          const [roastId, creator, roastStake, voteStake, openUntil, voteUntil] = parsedLog.args;
          await insertRoast({
            roast_id: Number(roastId),
            creator: creator.toLowerCase(),
            roast_stake: roastStake.toString(),
            vote_stake: voteStake.toString(),
            open_until: Number(openUntil),
            vote_until: Number(voteUntil),
            tx_hash: log.transactionHash,
            block_number: log.blockNumber,
          });
          console.log(`[listener] RoastCreated  id=${roastId} creator=${creator}`);
        }
        else if (parsedLog.name === "ParticipantJoined") {
          const [roastId, participant] = parsedLog.args;
          await insertParticipant({
            roast_id: Number(roastId),
            address: participant.toLowerCase(),
            tx_hash: log.transactionHash,
          });
          console.log(`[listener] ParticipantJoined id=${roastId} addr=${participant}`);
        }
        else if (parsedLog.name === "VoteCast") {
          const [roastId, voter, candidate] = parsedLog.args;
          console.log(`[listener] VoteCast      id=${roastId} voter=${voter} -> ${candidate}`);
        }
        else if (parsedLog.name === "RoastSettled") {
          const [roastId, numWinners, roasterPool, voterPool, winnerVoterCount] = parsedLog.args;
          await updateRoastSettled({
            roast_id: Number(roastId),
            num_winners: Number(numWinners),
            roaster_pool: roasterPool.toString(),
            voter_pool: voterPool.toString(),
            winner_voter_count: Number(winnerVoterCount),
          });
          console.log(`[listener] RoastSettled  id=${roastId} numWinners=${numWinners}`);
        }
        else if (parsedLog.name === "RoastCancelled") {
          const [roastId, reason] = parsedLog.args;
          await updateRoastCancelled({ roast_id: Number(roastId) });
          console.log(`[listener] RoastCancelled id=${roastId} reason="${reason}"`);
        }
      } catch (dbErr) {
        // Silently ignore unique constraint errors which are natural during fast polling
        if (!dbErr.message.includes('UNIQUE constraint failed')) {
          console.error(`[listener] DB Error for ${parsedLog.name}:`, dbErr.message);
        }
      }
    }

    lastPolledBlock = toBlock;

  } catch (err) {
    if (err.message && err.message.includes("limit")) {
      console.warn("[listener] Polling range too large, slowing down or limiting");
    } else {
      console.error("[listener] Polling error:", err.message);
    }
  }
}

function startListener(contractAddress) {
  const provider = new ethers.JsonRpcProvider(
    process.env.MONAD_RPC || "https://testnet-rpc.monad.xyz"
  );

  contract = new ethers.Contract(contractAddress, ABI, provider);

  console.log(`[listener] Watching ${contractAddress} via Manual Polling`);

  // Run the poll loop every 5 seconds instead of using contract.on (which uses eth_newFilter)
  setInterval(pollEvents, 5000);

  // Do a first poll immediately
  pollEvents();
}

module.exports = { startListener };
