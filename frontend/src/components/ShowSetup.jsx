import { useState } from "react";
import { createShow } from "../api/client";
import {
  PRESET_AGENTS, DEFAULT_SHOW_PROMPT, DEFAULT_GM_PROMPT, DEFAULT_RULES_TEXT,
  SHOW_TITLE,
} from "../presets";

export default function ShowSetup({ onCreated }) {
  const [showPrompt, setShowPrompt] = useState(DEFAULT_SHOW_PROMPT);
  const [gmPrompt, setGmPrompt] = useState(DEFAULT_GM_PROMPT);
  const [rulesText, setRulesText] = useState(DEFAULT_RULES_TEXT);
  const [maxRounds, setMaxRounds] = useState("");
  const [selectedIds, setSelectedIds] = useState(
    () => PRESET_AGENTS.map((agent) => agent.id)
  );
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleAgent(id) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id]
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const show = await createShow({
        title: SHOW_TITLE,
        show_prompt: showPrompt,
        gm_prompt: gmPrompt,
        rules_text: rulesText,
        max_rounds: maxRounds === "" ? null : Number(maxRounds),
        agent_preset_ids: selectedIds,
      });
      onCreated(show);
    } catch (err) {
      setError(err.message || "Failed to start show");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <p>
        <span>Show title</span>
        <strong data-testid="show-title">{SHOW_TITLE}</strong>
      </p>

      <label htmlFor="max-rounds">Number of rounds (blank for unlimited)</label>
      <input
        id="max-rounds"
        type="number"
        min="1"
        value={maxRounds}
        onChange={(e) => setMaxRounds(e.target.value)}
      />

      <label htmlFor="show-prompt">Show premise</label>
      <textarea
        id="show-prompt"
        value={showPrompt}
        onChange={(e) => setShowPrompt(e.target.value)}
      />

      <label htmlFor="gm-prompt">Game Master personality</label>
      <textarea
        id="gm-prompt"
        value={gmPrompt}
        onChange={(e) => setGmPrompt(e.target.value)}
      />

      <label htmlFor="rules-text">House rules</label>
      <textarea
        id="rules-text"
        value={rulesText}
        onChange={(e) => setRulesText(e.target.value)}
      />

      <fieldset>
        <legend>The five under suspicion (uncheck to exclude — need exactly five)</legend>
        {PRESET_AGENTS.map((agent) => (
          <label key={agent.id} htmlFor={`agent-${agent.id}`}>
            <input
              id={`agent-${agent.id}`}
              type="checkbox"
              checked={selectedIds.includes(agent.id)}
              onChange={() => toggleAgent(agent.id)}
            />
            {agent.name}
          </label>
        ))}
      </fieldset>

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={selectedIds.length !== 5 || submitting}>
        {submitting ? "Starting…" : "Start show"}
      </button>
    </form>
  );
}
