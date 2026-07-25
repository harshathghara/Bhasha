import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EventFeed from "./EventFeed";
import * as api from "../api/client";

const events = [
  { seq: 0, round: 1, sender_id: "game_master", text: "Round 1 begins.",
    kind: "gm_announcement", visibility: "public", recipients: [], released: false },
  { seq: 1, round: 1, sender_id: "vikram", text: "I trust no one.",
    kind: "agent_action", visibility: "public", recipients: [], released: false },
  { seq: 2, round: 1, sender_id: "simran", text: "Ally with me.",
    kind: "agent_action", visibility: "private", recipients: ["karan"], released: false },
  { seq: 3, round: 1, sender_id: "simran", text: "I am playing both sides.",
    kind: "confession", visibility: "private", recipients: [], released: false },
];

const narratives = { 1: "The house settled into an uneasy quiet." };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("EventFeed", () => {
  it("live feed shows public, private, and confession events", () => {
    render(<EventFeed showId="s1" events={events} narratives={narratives}
                      onEventReleased={() => {}} />);
    expect(screen.getByText(/I trust no one\./)).toBeInTheDocument();
    expect(screen.getByText(/Ally with me\./)).toBeInTheDocument();
    expect(screen.getByText(/I am playing both sides\./)).toBeInTheDocument();
  });

  it("story tab shows narratives and hides raw events", () => {
    render(<EventFeed showId="s1" events={events} narratives={narratives}
                      onEventReleased={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /story/i }));

    expect(screen.getByText("The house settled into an uneasy quiet.")).toBeInTheDocument();
    expect(screen.queryByText(/I trust no one\./)).not.toBeInTheDocument();
  });

  it("reveal appears only on unreleased private events and calls the API", async () => {
    const spy = vi.spyOn(api, "releaseEvent").mockResolvedValue({ seq: 2, released: true });
    const onEventReleased = vi.fn();

    render(<EventFeed showId="s1" events={events} narratives={narratives}
                      onEventReleased={onEventReleased} />);

    const revealButtons = screen.getAllByRole("button", { name: /reveal/i });
    expect(revealButtons).toHaveLength(2);

    fireEvent.click(revealButtons[0]);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("s1", 2));
    expect(onEventReleased).toHaveBeenCalledWith({ seq: 2, released: true });
  });
});
