import { startRound, stopRound, killAgent } from "../api/client";

export default function LiveRoom({ show, onShowUpdated }) {
  async function handleStart() {
    onShowUpdated(await startRound(show.id));
  }

  async function handleStop() {
    onShowUpdated(await stopRound(show.id));
  }

  async function handleKill(agentId) {
    onShowUpdated(await killAgent(show.id, agentId));
  }

  return (
    <div>
      <button onClick={handleStart}>Start round</button>
      <button onClick={handleStop}>Stop round</button>

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
