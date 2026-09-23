"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// A real 3D holographic wireframe sphere (WebGL, via Three.js) — layered
// rotating wireframe shells plus a scattered particle field, evoking Tony
// Stark's arc-reactor-room holograms rather than a flat waveform icon.
// Requires an actual WebGL-capable browser; SiriOrb only mounts this after
// confirming support and falls back to the old CSS bars otherwise (jsdom,
// this dev sandbox's test runner, and some restricted browsers have none).
export type HologramState = "idle" | "listening" | "speaking" | "thinking";

// Idle: calm blue, small. Any active state (listening/speaking/thinking):
// hot-rod-red, enlarged — the size change itself is handled by SiriOrb via
// a CSS transform on the wrapping container, not here.
const IDLE_COLOR = 0x38bdf8; // cyan/blue, matches --glow-primary
const ACTIVE_COLOR = 0xe8102a; // hot-rod-red, matches the SKYNET wordmark
const CORE_COLOR = 0xfff4d6; // small warm "sun" at the center — constant, not state-driven

function isActiveState(state: HologramState): boolean {
  return state !== "idle";
}

const SPEED_MULTIPLIER: Record<HologramState, number> = {
  idle: 0.5,
  listening: 1.6,
  speaking: 2.4,
  thinking: 1.2,
};

export function HologramOrb({
  state,
  onClick,
  label,
  size = 120,
}: {
  state: HologramState;
  onClick: () => void;
  label: string;
  size?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 4.2;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);

    // Small glowing "sun" core at the center — a bright solid sphere plus a
    // larger additive-blended halo sphere around it for a soft glow. Its
    // warm color stays constant regardless of state, unlike the shell.
    const coreGeo = new THREE.SphereGeometry(0.2, 24, 24);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: CORE_COLOR });
    const core = new THREE.Mesh(coreGeo, coreMaterial);
    const coreGlowGeo = new THREE.SphereGeometry(0.32, 24, 24);
    const coreGlowMaterial = new THREE.MeshBasicMaterial({
      color: CORE_COLOR,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreGlow = new THREE.Mesh(coreGlowGeo, coreGlowMaterial);
    group.add(core, coreGlow);

    // Two layered wireframe shells rotating at different speeds/axes —
    // reads as overlapping rings rather than one flat sphere outline.
    const outerGeo = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.4, 2));
    const innerGeo = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.95, 1));
    const outerMaterial = new THREE.LineBasicMaterial({
      color: isActiveState(stateRef.current) ? ACTIVE_COLOR : IDLE_COLOR,
      transparent: true,
      opacity: 0.85,
    });
    const innerMaterial = outerMaterial.clone();

    const outerShell = new THREE.LineSegments(outerGeo, outerMaterial);
    const innerShell = new THREE.LineSegments(innerGeo, innerMaterial);
    group.add(outerShell, innerShell);

    // Scattered glowing points around the shells for the "spark" look.
    const particleCount = 200;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const radius = 1.1 + Math.random() * 0.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: isActiveState(stateRef.current) ? ACTIVE_COLOR : IDLE_COLOR,
      size: 0.035,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeo, particleMaterial);
    group.add(particles);

    let frameId: number | null = null;
    let elapsed = 0;
    const clock = new THREE.Clock();

    function renderFrame() {
      const delta = clock.getDelta();
      elapsed += delta;
      const currentState = stateRef.current;
      const speed = SPEED_MULTIPLIER[currentState];

      if (!prefersReducedMotion) {
        outerShell.rotation.y += delta * 0.25 * speed;
        outerShell.rotation.x += delta * 0.08 * speed;
        innerShell.rotation.y -= delta * 0.4 * speed;
        innerShell.rotation.x += delta * 0.15 * speed;
        particles.rotation.y += delta * 0.12 * speed;
        core.rotation.y += delta * 0.3;

        const pulseSpeed = currentState === "speaking" ? 10 : currentState === "thinking" ? 4 : 1.2;
        const pulseAmount = currentState === "speaking" ? 0.05 : currentState === "thinking" ? 0.04 : 0.02;
        const shellPulse = 1 + Math.sin(elapsed * pulseSpeed) * pulseAmount;
        outerShell.scale.setScalar(shellPulse);
        innerShell.scale.setScalar(shellPulse);
        particles.scale.setScalar(shellPulse);
        // The core "sun" breathes gently regardless of state, independent
        // of the shell's state-driven pulse.
        core.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.08);
        coreGlow.scale.setScalar(1 + Math.sin(elapsed * 2) * 0.12);
      }

      const shellColor = isActiveState(currentState) ? ACTIVE_COLOR : IDLE_COLOR;
      outerMaterial.color.setHex(shellColor);
      innerMaterial.color.setHex(shellColor);
      particleMaterial.color.setHex(shellColor);

      renderer.render(scene, camera);
    }

    if (prefersReducedMotion) {
      renderFrame();
    } else {
      const animate = () => {
        frameId = requestAnimationFrame(animate);
        renderFrame();
      };
      animate();
    }

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      renderer.dispose();
      coreGeo.dispose();
      coreMaterial.dispose();
      coreGlowGeo.dispose();
      coreGlowMaterial.dispose();
      outerGeo.dispose();
      innerGeo.dispose();
      outerMaterial.dispose();
      innerMaterial.dispose();
      particleGeo.dispose();
      particleMaterial.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [size]);

  return (
    <div
      ref={containerRef}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      aria-label={label}
      className="hologram-orb"
      style={{ width: size, height: size }}
    />
  );
}
