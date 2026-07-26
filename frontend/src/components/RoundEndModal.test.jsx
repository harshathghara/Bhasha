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
        ending={false}
        onStartNext={() => {}}
        onToggleStory={() => {}}
        onEndGame={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: /round 2 ended/i })).toBeInTheDocument();
    expect(screen.getByTestId("round-end-recap")).toHaveTextContent(
      "Blame settled on Vikram — for now.",
    );
    expect(screen.getByRole("button", { name: /start next round/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /story so far/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /end game/i })).toBeEnabled();
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
        ending={false}
        onStartNext={() => {}}
        onToggleStory={() => {}}
        onEndGame={() => {}}
      />,
    );

    const story = screen.getByTestId("story-so-far");
    expect(story).toHaveTextContent("Round 1");
    expect(story).toHaveTextContent("Chapter one.");
    expect(story).toHaveTextContent("Round 2");
    expect(story).toHaveTextContent("Chapter two.");
  });

  it("fires callbacks for next round, story toggle, and end game", () => {
    const onStartNext = vi.fn();
    const onToggleStory = vi.fn();
    const onEndGame = vi.fn();
    render(
      <RoundEndModal
        round={1}
        recap="Recap."
        narratives={{ 1: "Recap." }}
        storyOpen={false}
        showOver={false}
        starting={false}
        ending={false}
        onStartNext={onStartNext}
        onToggleStory={onToggleStory}
        onEndGame={onEndGame}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start next round/i }));
    fireEvent.click(screen.getByRole("button", { name: /story so far/i }));
    fireEvent.click(screen.getByRole("button", { name: /end game/i }));

    expect(onStartNext).toHaveBeenCalledWith("");
    expect(onToggleStory).toHaveBeenCalledTimes(1);
    expect(onEndGame).toHaveBeenCalledTimes(1);
  });

  it("hides end game when the show is already over", () => {
    render(
      <RoundEndModal
        round={3}
        recap="Final."
        narratives={{ 3: "Final." }}
        storyOpen={false}
        showOver
        starting={false}
        ending={false}
        onStartNext={() => {}}
        onToggleStory={() => {}}
        onEndGame={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: /end game/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show over/i })).toBeDisabled();
  });

  it("passes optional producer note to onStartNext", () => {
    const onStartNext = vi.fn();
    render(
      <RoundEndModal
        round={1}
        recap="Recap."
        narratives={{ 1: "Recap." }}
        storyOpen={false}
        showOver={false}
        starting={false}
        onStartNext={onStartNext}
        onToggleStory={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId("producer-note-input"), {
      target: { value: "  Soft hint: trust nobody.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /start next round/i }));

    expect(onStartNext).toHaveBeenCalledWith("Soft hint: trust nobody.");
  });

  it("starts next round with empty note when field left blank", () => {
    const onStartNext = vi.fn();
    render(
      <RoundEndModal
        round={1}
        recap="Recap."
        narratives={{ 1: "Recap." }}
        storyOpen={false}
        showOver={false}
        starting={false}
        onStartNext={onStartNext}
        onToggleStory={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start next round/i }));
    expect(onStartNext).toHaveBeenCalledWith("");
  });
});
