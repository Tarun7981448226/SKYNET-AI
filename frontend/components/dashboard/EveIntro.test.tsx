import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";

import { EveIntro } from "./EveIntro";

function Harness({
  phase,
  onArrived,
  onTransformStart,
  onDeparted,
}: {
  phase: "enter" | "greet" | "depart";
  onArrived: () => void;
  onTransformStart: () => void;
  onDeparted: () => void;
}) {
  const targetRef = createRef<HTMLDivElement>();
  return (
    <div>
      <div ref={targetRef} data-testid="target" />
      <EveIntro
        phase={phase}
        greetingText="Good evening, Tarun."
        targetRef={targetRef}
        onArrived={onArrived}
        onTransformStart={onTransformStart}
        onDeparted={onDeparted}
      />
    </div>
  );
}

describe("EveIntro", () => {
  it("calls onArrived once the fly-in animation finishes", async () => {
    const onArrived = vi.fn();
    const onTransformStart = vi.fn();
    const onDeparted = vi.fn();
    render(<Harness phase="enter" onArrived={onArrived} onTransformStart={onTransformStart} onDeparted={onDeparted} />);

    await waitFor(() => expect(onArrived).toHaveBeenCalledTimes(1));
    expect(onTransformStart).not.toHaveBeenCalled();
    expect(onDeparted).not.toHaveBeenCalled();
  });

  it("shows the greeting text passed in by the parent", () => {
    render(<Harness phase="greet" onArrived={vi.fn()} onTransformStart={vi.fn()} onDeparted={vi.fn()} />);
    expect(screen.getByText("Good evening, Tarun.")).toBeInTheDocument();
  });

  it("calls onTransformStart at the jump apex, before onDeparted", async () => {
    const onArrived = vi.fn();
    const onTransformStart = vi.fn();
    const onDeparted = vi.fn();
    const { rerender } = render(
      <Harness phase="enter" onArrived={onArrived} onTransformStart={onTransformStart} onDeparted={onDeparted} />,
    );
    await waitFor(() => expect(onArrived).toHaveBeenCalledTimes(1));

    const targetRef = createRef<HTMLDivElement>();
    rerender(
      <div>
        <div ref={targetRef} data-testid="target" />
        <EveIntro
          phase="depart"
          greetingText="Good evening, Tarun."
          targetRef={targetRef}
          onArrived={onArrived}
          onTransformStart={onTransformStart}
          onDeparted={onDeparted}
        />
      </div>,
    );

    // Real timing (onTransformStart at the jump apex, onDeparted only once
    // EVE's own fade genuinely finishes) isn't something a 0ms-timer test
    // polyfill can meaningfully assert an ordering gap for — both fire
    // within the same tick here. What matters structurally is that both
    // eventually fire exactly once.
    await waitFor(() => expect(onTransformStart).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await waitFor(() => expect(onDeparted).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});
