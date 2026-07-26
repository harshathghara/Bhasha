import { useState } from "react";
import { startRound, stopRound, killAgent, injectEvent } from "../api/client";

export default function LiveRoom({ show, onShowUpdated }) {
  const [brief, setBrief] = useState("");
  const [clue, setClue] = useState("");
  const [starting, setStarting] = useState(false);
  const [injecting, setInjecting] = useState(false);

  async function handleStart(event) {
    event.preventDefault();
    setStarting(true);
    try {
      const opening_brief = brief.trim();
      await startRound(
        show.id,
        opening_brief ? { opening_brief } : {}
      );
      setBrief("");
      onShowUpdated();
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    onShowUpdated(await stopRound(show.id));
  }

  async function handleKill(agentId) {
    onShowUpdated(await killAgent(show.id, agentId));
  }

  async function handleInject(event) {
    event.preventDefault();
    const text = clue.trim();
    if (!text) return;
    setInjecting(true);
    try {
      await injectEvent(show.id, text);
      setClue("");
      onShowUpdated();
    } finally {
      setInjecting(false);
    }
  }

  return (
    <div>
      <form onSubmit={handleStart}>
        <label htmlFor="round-brief">Round brief (optional)</label>
        <input
          id="round-brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. Police found footprints by the back door"
          disabled={starting}
        />
        <button type="submit" disabled={starting}>
          Start round
        </button>
      </form>
      <button type="button" onClick={handleStop}>Stop round</button>

      <form onSubmit={handleInject}>
        <label htmlFor="producer-clue">Inject public clue</label>
        <input
          id="producer-clue"
          value={clue}
          onChange={(e) => setClue(e.target.value)}
          placeholder="e.g. A bloody handkerchief under the sofa"
        />
        <button type="submit" disabled={injecting || !clue.trim()}>
          Inject clue
        </button>
      </form>

      <ul>
        {show.contestants.map((agent) => (
          <li key={agent.id}>
            <span>{agent.name}</span>
            <span>{agent.status}</span>
            <button
              aria-label={`Kill ${agent.name}`}
              onClick={() => handleKill(agent.id)}
            >
              Kill
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
