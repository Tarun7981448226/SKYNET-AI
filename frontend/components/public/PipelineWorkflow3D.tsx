"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// The presentation's centerpiece: a real animated diagram of SKYNET's
// actual pipeline (search -> watch -> score -> tailor -> deliver) instead
// of a flat icon per slide — mounted once by SkynetPresentation.tsx and
// driven by `activeStage` as slides advance, so it reads as one continuous
// diagram lighting up progressively rather than 7 separate animations.
// Same wireframe-hologram visual language as HologramBackdrop.tsx/
// HologramOrb.tsx (idle blue, active amber — this app's standing
// convention for "at rest" vs. "doing something right now").
//
// Stage 5 ("ready every morning") intentionally maps to the same Deliver
// node as stage 4 ("running every hour") — both are about the pipeline's
// cadence/output, not a distinct stage; there's no 6th real pipeline stage
// to invent one for. Stage 6 is the "paste a link" on-demand path
// (LinkResumePanel.tsx / run_link_resume) — a genuinely different entry
// point that still feeds the same Score step, shown as a separate branch
// with a dashed connector rather than pretending it's a 6th linear stage.
const IDLE_COLOR = 0x5fc8ff;
const ACTIVE_COLOR = 0xffb454;

const STAGE_LABELS = ["Search", "Watch", "Score", "Tailor", "Deliver"] as const;
// One emoji per main node, index-matched to STAGE_LABELS — a lightweight,
// legible label without needing an in-3D text/sprite system (see the
// no-3D-text reasoning below). Tarun's own picks for Search (🔍) and
// Deliver (☀️, "ready every morning"); the rest chosen to match.
const STAGE_EMOJI = ["🔍", "👀", "🎯", "✂️", "☀️"] as const;
const PLAN_B_EMOJI = "🔗";
// activeStage (0-6, from SkynetPresentation's slide index) -> which of the
// 5 main nodes lights up. Index 5 stays on Deliver (see note above); index
// 6 is handled separately as the Plan B branch.
const STAGE_TO_NODE = [0, 1, 2, 3, 4, 4];

export function PipelineWorkflow3D({ activeStage }: { activeStage: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeStageRef = useRef(activeStage);
  activeStageRef.current = activeStage;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.8, 5.5);
    camera.lookAt(0, -0.2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    container.style.position = "relative";

    // 5 main stage nodes along a gentle arc, left to right.
    const mainPositions = STAGE_LABELS.map((_, i) => {
      const t = i / (STAGE_LABELS.length - 1); // 0..1
      const x = (t - 0.5) * 5.6;
      const y = Math.sin(t * Math.PI) * 0.45; // gentle arc, peaks in the middle
      return new THREE.Vector3(x, y, 0);
    });
    // Plan B branch node — offset below/behind the Score node (index 2).
    const planBPosition = mainPositions[2].clone().add(new THREE.Vector3(0, -1.5, -0.6));
    const allNodePositions = [...mainPositions, planBPosition];

    // Emoji labels as plain absolutely-positioned DOM overlays rather than
    // in-3D text/sprites — node *positions* are fixed (only rotation/scale/
    // color animate), so each label's screen position only needs
    // recomputing on resize, not every frame; a whole text-sprite/CSS3D-
    // renderer subsystem would be a lot of machinery for a label that never
    // moves relative to its node.
    const labelEls = [...STAGE_EMOJI, PLAN_B_EMOJI].map((emoji) => {
      const el = document.createElement("div");
      el.textContent = emoji;
      Object.assign(el.style, {
        position: "absolute",
        transform: "translate(-50%, -50%)",
        fontSize: "15px",
        pointerEvents: "none",
        transition: "opacity 250ms ease, font-size 250ms ease",
        opacity: "0.55",
      });
      container.appendChild(el);
      return el;
    });

    function resize() {
      const w = containerRef.current?.clientWidth ?? 0;
      const h = containerRef.current?.clientHeight ?? 0;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      positionLabels(w, h);
    }
    function positionLabels(w: number, h: number) {
      allNodePositions.forEach((pos, i) => {
        const ndc = pos.clone().project(camera);
        labelEls[i].style.left = `${((ndc.x + 1) / 2) * w}px`;
        // Sit just above the node, not centered on it, so it doesn't cover
        // the node's own active/idle color.
        labelEls[i].style.top = `${((1 - ndc.y) / 2) * h - 20}px`;
      });
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const nodeGeo = new THREE.IcosahedronGeometry(0.26, 1);
    const nodes = allNodePositions.map((pos) => {
      const material = new THREE.MeshStandardMaterial({
        color: IDLE_COLOR,
        emissive: IDLE_COLOR,
        emissiveIntensity: 0.7,
        roughness: 0.35,
        metalness: 0.1,
      });
      const mesh = new THREE.Mesh(nodeGeo, material);
      mesh.position.copy(pos);
      scene.add(mesh);
      return mesh;
    });

    // Main chain connectors (0-1, 1-2, 2-3, 3-4) plus the dashed Plan B
    // branch (2 -> planB).
    function makeConnector(a: THREE.Vector3, b: THREE.Vector3, dashed: boolean) {
      const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
      const material = dashed
        ? new THREE.LineDashedMaterial({ color: IDLE_COLOR, transparent: true, opacity: 0.45, dashSize: 0.12, gapSize: 0.08 })
        : new THREE.LineBasicMaterial({ color: IDLE_COLOR, transparent: true, opacity: 0.45 });
      const line = new THREE.Line(geometry, material);
      if (dashed) line.computeLineDistances();
      scene.add(line);
      return line;
    }
    const mainConnectors = mainPositions.slice(0, -1).map((pos, i) => makeConnector(pos, mainPositions[i + 1], false));
    const planBConnector = makeConnector(mainPositions[2], planBPosition, true);

    // Traveling packet — a small glowing sphere that slides along whichever
    // connector is "active" right now, giving the sense of a real posting
    // flowing through the pipeline rather than a static diagram.
    const packetGeo = new THREE.SphereGeometry(0.07, 12, 12);
    const packetMaterial = new THREE.MeshBasicMaterial({ color: ACTIVE_COLOR });
    const packet = new THREE.Mesh(packetGeo, packetMaterial);
    scene.add(packet);

    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2, 3, 4);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    let frameId: number | null = null;
    let elapsed = 0;
    const clock = new THREE.Clock();

    function renderFrame() {
      const delta = clock.getDelta();
      elapsed += delta;
      const stage = activeStageRef.current;
      const isPlanB = stage === 6;
      const activeNodeIndex = isPlanB ? 5 : STAGE_TO_NODE[stage] ?? 0;

      const t = Math.min(1, delta * 6);
      nodes.forEach((mesh, i) => {
        const isActive = i === activeNodeIndex;
        const targetColor = isActive ? ACTIVE_COLOR : IDLE_COLOR;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.lerp(new THREE.Color(targetColor), t);
        mat.color.lerp(new THREE.Color(targetColor), t);
        mat.emissiveIntensity += ((isActive ? 1.4 : 0.7) - mat.emissiveIntensity) * t;
        const targetScale = isActive ? 1.35 : 1;
        mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * t);
        if (!prefersReducedMotion) mesh.rotation.y += delta * 0.4;
        labelEls[i].style.opacity = isActive ? "1" : "0.55";
        labelEls[i].style.fontSize = isActive ? "20px" : "15px";
      });

      // Fade the plan B connector in only while that branch is active;
      // otherwise it stays faint so the main chain reads as the primary
      // path.
      (planBConnector.material as THREE.LineDashedMaterial).opacity = isPlanB ? 0.85 : 0.25;
      mainConnectors.forEach((line) => {
        (line.material as THREE.LineBasicMaterial).opacity = isPlanB ? 0.25 : 0.45;
      });

      if (!prefersReducedMotion) {
        // Slide the packet along the segment feeding the active node —
        // for the Plan B branch that's Score -> planB; otherwise it's the
        // previous main node -> the active one (stage 0 has no
        // predecessor, so just idle it at the Search node).
        const cycle = (elapsed % 1.6) / 1.6;
        let from: THREE.Vector3;
        let to: THREE.Vector3;
        if (isPlanB) {
          from = mainPositions[2];
          to = planBPosition;
        } else if (activeNodeIndex === 0) {
          from = mainPositions[0];
          to = mainPositions[0];
        } else {
          from = mainPositions[activeNodeIndex - 1];
          to = mainPositions[activeNodeIndex];
        }
        packet.position.lerpVectors(from, to, cycle);
        packet.visible = true;
      } else {
        packet.visible = false;
      }

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
      resizeObserver.disconnect();
      renderer.dispose();
      nodeGeo.dispose();
      nodes.forEach((mesh) => (mesh.material as THREE.Material).dispose());
      packetGeo.dispose();
      packetMaterial.dispose();
      mainConnectors.forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      planBConnector.geometry.dispose();
      (planBConnector.material as THREE.Material).dispose();
      labelEls.forEach((el) => el.remove());
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
