import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView at all (unlike canvas.getContext,
// which it has but returns null for unsupported contexts) — components
// that call it (CaptionDisplay) would otherwise throw under jsdom even
// though it works fine in every real browser.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement the Web Animations API at all — components that
// call el.animate(...) (EveIntro's flight/jump choreography) need at least
// a no-op stand-in so tests don't crash. Fires `onfinish` on a macrotask
// regardless of the requested duration, so `waitFor`-based tests resolve
// promptly instead of needing to wait out real animation durations.
if (typeof Element !== "undefined" && !Element.prototype.animate) {
  Element.prototype.animate = function fakeAnimate() {
    let finishHandler: (() => void) | null = null;
    let cancelled = false;
    return {
      cancel() {
        cancelled = true;
      },
      get onfinish() {
        return finishHandler;
      },
      set onfinish(handler: (() => void) | null) {
        finishHandler = handler;
        if (handler) {
          setTimeout(() => {
            if (!cancelled) handler();
          }, 0);
        }
      },
    } as unknown as Animation;
  };
}
