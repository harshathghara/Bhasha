import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LeakConfirmDialog from "./LeakConfirmDialog";

describe("LeakConfirmDialog", () => {
  it("shows the quoted text and fires confirm/cancel callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <LeakConfirmDialog
        text="Ally with me."
        error={null}
        pending={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByTestId("leak-confirm-text")).toHaveTextContent("Ally with me.");
    fireEvent.click(screen.getByRole("button", { name: /^leak$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables confirm while pending and shows an inline error", () => {
    render(
      <LeakConfirmDialog
        text="Ally with me."
        error="Event has already been leaked"
        pending
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: /leaking/i })).toBeDisabled();
    expect(screen.getByTestId("leak-confirm-error")).toHaveTextContent(
      "Event has already been leaked",
    );
  });
});
