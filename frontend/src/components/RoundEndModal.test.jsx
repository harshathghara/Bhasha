import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RoundEndModal from "./RoundEndModal";

describe("RoundEndModal", () => {
  it("renders round title, recap, and action buttons", () => {
    render(
      <RoundEndModal
        round={2}
        recap="Blame settled on Vikram — for now."
        narratives={{ 1: "Earlier.", 2: "Blame settled on Vikram — for now." }}
        storyOpen={false}
        showOver={false}
        starting={false}
        onStartNext={() => {}}
        onToggleStory={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: /round 2 ended/i })).toBeInTheDocument();
    expect(screen.getByTestId("round-end-recap")).toHaveTextContent(
      "Blame settled on Vikram — for now.",
    );
    expect(screen.getByRole("button", { name: /start next round/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /story so far/i })).toBeInTheDocument();
  });

  it("shows story chapters when storyOpen is true", () => {
    render(
      <RoundEndModal
        round={2}
        recap="Latest."
        narratives={{ 1: "Chapter one.", 2: "Chapter two." }}
        storyOpen
        showOver={false}
        starting={false}
        onStartNext={() => {}}
        onToggleStory={() => {}}
      />,
    );

    const story = screen.getByTestId("story-so-far");
    expect(story).toHaveTextContent("Round 1");
    expect(story).toHaveTextContent("Chapter one.");
    expect(story).toHaveTextContent("Round 2");
    expect(story).toHaveTextContent("Chapter two.");
  });

  it("fires callbacks for next round and story toggle", () => {
    const onStartNext = vi.fn();
    const onToggleStory = vi.fn();
    render(
      <RoundEndModal
        round={1}
        recap="Recap."
        narratives={{ 1: "Recap." }}
        storyOpen={false}
        showOver={false}
        starting={false}
        onStartNext={onStartNext}
        onToggleStory={onToggleStory}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start next round/i }));
    fireEvent.click(screen.getByRole("button", { name: /story so far/i }));

    expect(onStartNext).toHaveBeenCalledTimes(1);
    expect(onToggleStory).toHaveBeenCalledTimes(1);
  });
});
