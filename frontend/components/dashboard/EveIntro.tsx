"use client";

import { useEffect, useRef } from "react";

import { SkynetBot } from "@/components/character/SkynetBot";

// A small EVE (WALL-E's companion) flies in from off-screen left to the
// middle of the screen, hovers while the real time-of-day greeting is
// spoken (driven by the parent, not a fixed timer — see SiriOrb.tsx's
// onArrived/onDeparted wiring), then flies to SiriOrb's exact on-screen
// spot and pops into a spark burst as the real orb fades in right there.
// Pure WAAPI choreography on refs — no animation library.
//
// `phase` is parent-controlled: "enter" runs the fly-in once on mount and
// calls onArrived when it lands; "greet" just holds position while the
// caption shows; "depart" (set by the parent once real speech has finished)
// runs the fly-to-target + pop and calls onDeparted at the end.
export function EveIntro({
  phase,
  greetingText,
  targetRef,
  onArrived,
  onTransformStart,
  onDeparted,
}: {
  phase: "enter" | "greet" | "depart";
  greetingText: string;
  targetRef: React.RefObject<HTMLElement | null>;
  onArrived: () => void;
  // Fires the instant the burst/fade starts (jump apex) — the parent uses
  // this to start popping the real orb in immediately, overlapping EVE's
  // own fade rather than waiting for it. onDeparted fires only once EVE's
  // fade has genuinely finished, for unmounting this component — calling
  // it any earlier would remove her from the DOM mid-animation and cut
  // the fade off before it's visible at all.
  onTransformStart: () => void;
  onDeparted: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const armLeftRef = useRef<SVGGElement>(null);
  const armRightRef = useRef<SVGGElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);

  const bobAnim = useRef<Animation | null>(null);
  const armLeftAnim = useRef<Animation | null>(null);
  const armRightAnim = useRef<Animation | null>(null);
  const enterAnim = useRef<Animation | null>(null);
  const flutterActive = useRef(true);

  // Arm flutter: continuous, phase-offset left/right paddle motion for the
  // whole time EVE is on screen — stopped explicitly right before she pops
  // (see depart effect below), settling to a neutral pose first.
  useEffect(() => {
    flutterActive.current = true;
    function left() {
      if (!flutterActive.current || !armLeftRef.current) return;
      const h = armLeftRef.current.animate(
        [{ transform: "rotate(-8deg)" }, { transform: "rotate(-26deg)" }, { transform: "rotate(-8deg)" }],
        { duration: 620, easing: "ease-in-out" },
      );
      armLeftAnim.current = h;
      h.onfinish = left;
    }
    function right() {
      if (!flutterActive.current || !armRightRef.current) return;
      setTimeout(() => {
        if (!flutterActive.current || !armRightRef.current) return;
        const h = armRightRef.current.animate(
          [{ transform: "rotate(8deg)" }, { transform: "rotate(26deg)" }, { transform: "rotate(8deg)" }],
          { duration: 620, easing: "ease-in-out" },
        );
        armRightAnim.current = h;
        h.onfinish = right;
      }, 250);
    }
    left();
    right();
    return () => {
      flutterActive.current = false;
      armLeftAnim.current?.cancel();
      armRightAnim.current?.cancel();
    };
  }, []);

  // Idle hover bob — runs during enter/greet, stopped before she settles
  // and pops (same element/property the pop's scale animation uses).
  useEffect(() => {
    if (phase === "depart" || !innerRef.current) return;
    let active = true;
    const el = innerRef.current;
    function loop() {
      if (!active) return;
      // Every keyframe carries the same translate(-50%,-50%) the element's
      // base style sets — WAAPI replaces the whole `transform` property
      // while an animation is active, so dropping this prefix here would
      // pop the character off-center (visible as "she's not landing on
      // the orb") for the animation's duration.
      const h = el.animate(
        [
          { transform: "translate(-50%,-50%) translateY(0px) rotate(0deg)" },
          { transform: "translate(-50%,-50%) translateY(-7px) rotate(-1.5deg)" },
          { transform: "translate(-50%,-50%) translateY(0px) rotate(0deg)" },
          { transform: "translate(-50%,-50%) translateY(5px) rotate(1.5deg)" },
          { transform: "translate(-50%,-50%) translateY(0px) rotate(0deg)" },
        ],
        { duration: 2200, easing: "ease-in-out" },
      );
      bobAnim.current = h;
      h.onfinish = loop;
    }
    loop();
    return () => {
      active = false;
      bobAnim.current?.cancel();
    };
  }, [phase]);

  // Fly in from off-screen left to screen-middle, once, on mount.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.left = "-12vw";
    root.style.top = "24vh";
    const h = root.animate([{ left: "-12vw", top: "24vh" }, { left: "46vw", top: "22vh" }], {
      duration: 1700,
      easing: "cubic-bezier(.35,.05,.25,1)",
      fill: "forwards",
    });
    enterAnim.current = h;
    h.onfinish = () => onArrived();
    return () => h.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Caption fades with the greet phase.
  useEffect(() => {
    if (!captionRef.current) return;
    captionRef.current.animate([{ opacity: phase === "greet" ? 0 : 1 }, { opacity: phase === "greet" ? 1 : 0 }], {
      duration: 400,
      fill: "forwards",
    });
  }, [phase]);

  // A handful of small sparks radiating out from wherever EVE currently is
  // — appended to document.body (not root) with real viewport coordinates
  // from getBoundingClientRect, so they land exactly where she settles
  // regardless of root's own position/transform math, and self-remove.
  function spawnBurst() {
    if (!innerRef.current) return;
    const rect = innerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < 14; i++) {
      const span = document.createElement("span");
      const warm = i % 2 === 0;
      Object.assign(span.style, {
        position: "fixed",
        left: cx + "px",
        top: cy + "px",
        width: "5px",
        height: "5px",
        borderRadius: "50%",
        background: warm ? "#ffb454" : "#5fc8ff",
        boxShadow: warm ? "0 0 8px #ffb454" : "0 0 8px #5fc8ff",
        pointerEvents: "none",
        zIndex: "60",
      });
      document.body.appendChild(span);
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
      const dist = 22 + Math.random() * 30;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      const h = span.animate(
        [
          { transform: "translate(-50%,-50%) translate(0,0) scale(0.5)", opacity: 1 },
          { transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) scale(1)`, opacity: 0 },
        ],
        { duration: 480 + Math.random() * 180, easing: "cubic-bezier(.15,.6,.4,1)" },
      );
      h.onfinish = () => span.remove();
    }
  }

  // Depart: fly to SiriOrb's exact real on-screen spot, settle, then pop
  // straight into it — no jump/hop, she just arrives and becomes the orb.
  useEffect(() => {
    if (phase !== "depart") return;
    const root = rootRef.current;
    if (!root || !targetRef.current) return;

    // A click can dismiss her mid-flight, before the enter animation has
    // finished — cancel it first so this new fly-to-target animation
    // doesn't run concurrently with it (WAAPI would otherwise composite
    // both, reading as a visible glitch rather than a clean redirect).
    enterAnim.current?.cancel();

    const rect = targetRef.current.getBoundingClientRect();
    const targetLeft = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
    const targetTop = ((rect.top + rect.height / 2) / window.innerHeight) * 100;

    const fly = root.animate([{ left: getComputedStyle(root).left, top: getComputedStyle(root).top }, { left: targetLeft + "vw", top: targetTop + "vh" }], {
      duration: 1100,
      easing: "cubic-bezier(.35,.05,.25,1)",
      fill: "forwards",
    });

    fly.onfinish = () => {
      // Settle into a clean, still pose exactly at the orb's spot — stop
      // every continuous loop before popping, rather than transforming
      // mid-motion.
      bobAnim.current?.cancel();
      flutterActive.current = false;
      armLeftAnim.current?.cancel();
      armRightAnim.current?.cancel();

      spawnBurst();
      // The real orb starts popping in right now, overlapping EVE's own
      // fade below — that overlap is what sells "becomes the orb"
      // instead of "vanishes, then separately something else appears."
      onTransformStart();
      const fade = root.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.4)" },
        ],
        { duration: 360, easing: "ease-in", fill: "forwards" },
      );
      // Only unmounts once she's actually finished fading — calling this
      // any earlier would remove her from the DOM mid-animation.
      fade.onfinish = onDeparted;
    };

    return () => fly.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div ref={rootRef} className="pointer-events-none fixed z-50" style={{ left: "-12vw", top: "24vh" }} aria-hidden="true">
      <div
        ref={captionRef}
        className="text-center opacity-0"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          // translateX centers it on the origin; translateY moves it up by
          // its own full height (so its bottom edge sits at the origin)
          // plus a fixed clearance — NOT a plain percentage of its own
          // small height (that undershoots badly and lands the bubble
          // overlapping EVE's head, with her SVG painting over it since it
          // comes later in the DOM — read as the caption being "behind"
          // her). The fixed clearance covers her tallest rendered size
          // (~99px at the clamp's upper bound) plus a gap.
          transform: "translate(-50%, calc(-100% - 68px))",
          width: "max-content",
          maxWidth: "220px",
          zIndex: 1,
        }}
      >
        <span className="rounded-full bg-[rgba(9,12,20,0.72)] px-3 py-1 text-xs italic text-[var(--foreground)] shadow-[0_0_0_1px_rgba(180,196,230,0.14)]">
          {greetingText}
        </span>
      </div>
      <div
        ref={innerRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "clamp(44px,7vw,72px)",
          transform: "translate(-50%,-50%)",
          transformOrigin: "50% 85%",
        }}
      >
        <SkynetBot idPrefix="eveIntro" eyeColor="#5fc8ff" armLeftRef={armLeftRef} armRightRef={armRightRef} />
      </div>
    </div>
  );
}
