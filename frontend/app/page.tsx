"use client";
import { useEffect, useState, useCallback } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { useWallet } from "@/lib/useWallet";
import { ROAST_ARENA_ABI, CONTRACT_ADDRESS, RoastState, STATE_LABEL, STATE_COLOR } from "@/lib/contract";
import { getRecentRoastsFromDB, type RoastIndex } from "@/lib/api";
import { useCountdown, formatCountdown } from "@/lib/useCountdown";

function Countdown({ openUntil, voteUntil, state }: { openUntil: number; voteUntil: number; state: string }) {
  // DB state never transitions to "VOTING" (listener doesn't update it on VoteCast).
  // Derive the correct countdown target from timestamps instead.
  const now = Math.floor(Date.now() / 1000);
  const target =
    state === "SETTLED" || state === "CANCELLED" ? 0
    : now < openUntil ? openUntil   // roasting window — counts down to 3-min mark
    : voteUntil;                     // voting window   — counts down to 7-min mark
  const secs = useCountdown(target);
  if (state === "SETTLED" || state === "CANCELLED") return <span className="text-zinc-600">—</span>;
  return (
    <span className={secs < 30 ? "text-red-400 animate-pulse" : "text-zinc-300"}>
      {formatCountdown(secs)}
    </span>
  );
}

export default function Home() {
  const { address, signer, isWrongNetwork, connect, switchNetwork } = useWallet();
  const [roasts, setRoasts]       = useState<RoastIndex[]>([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [showForm, setShowForm]   = useState(false);
  const [roastStake, setRoastStake] = useState("0.01");
  const [voteStake, setVoteStake]   = useState("0.005");
  const [error, setError]         = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await getRecentRoastsFromDB(20);
      setRoasts(rows);
    } catch {
      setError("Could not load arenas — is the backend running?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const handleCreate = async () => {
    if (!signer) { connect(); return; }
    if (isWrongNetwork) { switchNetwork(); return; }

    const roastWei = ethers.parseEther(roastStake || "0");
    const voteWei  = ethers.parseEther(voteStake  || "0");
    if (roastWei === 0n || voteWei === 0n) {
      setError("Both stake amounts must be > 0");
      return;
    }

    setCreating(true);
    setError("");
    try {
      const contract = new ethers.Contract(CONTRACT_ADDRESS, ROAST_ARENA_ABI as string[], signer);
      const tx = await contract.createRoast(roastWei, voteWei, { value: roastWei });
      const receipt = await tx.wait();
      const iface = new ethers.Interface(ROAST_ARENA_ABI as string[]);
      let roastId: string | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "RoastCreated") { roastId = parsed.args.roastId.toString(); break; }
        } catch { /* skip non-matching logs */ }
      }
      if (roastId) window.location.href = `/arena/${roastId}`;
      else load();
    } catch (err: unknown) {
      setError((err as Error).message?.slice(0, 120) || "Transaction failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold mb-3">
            <span className="text-orange-500">Roast</span>Arena
          </h1>
          <p className="text-zinc-400 text-lg">
            3 min to roast. 4 min to vote. Chain decides the winner.
          </p>
        </div>

        {/* Create button / form */}
        <div className="flex flex-col items-center mb-10 gap-4">
          {!showForm ? (
            <button
              onClick={() => { if (!signer) { connect(); } else { setShowForm(true); } }}
              className="bg-orange-600 hover:bg-orange-500 text-white font-bold text-lg px-8 py-4 rounded-lg transition-all"
            >
              + Create New Arena
            </button>
          ) : (
            <div className="border border-zinc-700 rounded-xl p-6 w-full max-w-sm space-y-4">
              <h3 className="text-white font-bold text-lg">Set Stake Amounts</h3>

              <label className="block">
                <span className="text-zinc-400 text-sm">Roaster stake (ETH per roaster)</span>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={roastStake}
                  onChange={(e) => setRoastStake(e.target.value)}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                />
              </label>

              <label className="block">
                <span className="text-zinc-400 text-sm">Vote stake (ETH per vote)</span>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={voteStake}
                  onChange={(e) => setVoteStake(e.target.value)}
                  className="mt-1 w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white focus:outline-none focus:border-orange-500"
                />
              </label>

              <p className="text-zinc-500 text-xs">
                You pay {roastStake} ETH now to create &amp; join. Others stake the same to roast.
                Voters stake {voteStake} ETH. Winning voters share the voter pool.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white font-bold py-2 rounded-lg"
                >
                  {creating ? "Creating…" : "Create Arena"}
                </button>
                <button
                  onClick={() => { setShowForm(false); setError(""); }}
                  className="px-4 py-2 text-zinc-400 hover:text-white border border-zinc-700 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isWrongNetwork && (
            <p className="text-yellow-400 text-sm">
              Wrong network.{" "}
              <button onClick={switchNetwork} className="underline">Switch</button>
            </p>
          )}
        </div>

        {error && <p className="text-center text-red-400 mb-6 text-sm">{error}</p>}

        <h2 className="text-zinc-500 text-xs uppercase tracking-widest mb-4">Recent Arenas</h2>

        {loading ? (
          <p className="text-zinc-600 text-center py-10">Loading arenas…</p>
        ) : roasts.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-800 rounded-lg">
            <p className="text-zinc-500 text-lg mb-2">No arenas yet.</p>
            <p className="text-zinc-600 text-sm">Be the first to create one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {roasts.map((r) => (
              <Link
                key={r.roast_id}
                href={`/arena/${r.roast_id}`}
                className="block border border-zinc-800 hover:border-orange-500 rounded-lg px-5 py-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-white font-bold">Arena #{r.roast_id}</span>
                    <span className="text-zinc-600 text-sm ml-3">
                      by {r.creator_username || `${r.creator.slice(0, 6)}…`}
                    </span>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <Countdown openUntil={r.open_until} voteUntil={r.vote_until} state={r.state} />
                    <span className={
                      r.state === "OPEN"      ? "text-green-400"
                      : r.state === "VOTING"  ? "text-yellow-400"
                      : r.state === "SETTLED" ? "text-blue-400"
                      : "text-red-400"
                    }>
                      {r.state}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
