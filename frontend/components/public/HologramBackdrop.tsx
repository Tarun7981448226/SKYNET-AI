"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// Ambient 3D backdrop for the presentation and capabilities panels — a
// slow-rotating wireframe shell plus a drifting particle field, filling
// the panel behind its real content. Same wireframe-hologram visual
// language as HologramOrb.tsx (that one's the interactive orb; this is
// pure atmosphere behind real content — low opacity, no interaction, no
// state — it's meant to make the panel feel like a real 3D hologram
// chamber, not compete with the text for attention).
export function HologramBackdrop({ color = "#5fc8ff" }: { color?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    function resize() {
      const clientWidth = containerRef.current?.clientWidth ?? 0;
      const clientHeight = containerRef.current?.clientHeight ?? 0;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const shellGeo = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.8, 1));
    const shellMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22 });
    const shell = new THREE.LineSegments(shellGeo, shellMaterial);
    scene.add(shell);

    const innerShellGeo = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.15, 0));
    const innerShellMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.16 });
    const innerShell = new THREE.LineSegments(innerShellGeo, innerShellMaterial);
    scene.add(innerShell);

    const particleCount = 140;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const radius = 2 + Math.random() * 1.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi) - 1;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color,
      size: 0.03,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeo, particleMaterial);
    scene.add(particles);

    let frameId: number | null = null;
    const clock = new THREE.Clock();
    function renderFrame() {
      const delta = clock.getDelta();
      if (!prefersReducedMotion) {
        shell.rotation.y += delta * 0.09;
        shell.rotation.x += delta * 0.03;
        innerShell.rotation.y -= delta * 0.14;
        innerShell.rotation.x -= delta * 0.05;
        particles.rotation.y -= delta * 0.05;
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
      shellGeo.dispose();
      shellMaterial.dispose();
      innerShellGeo.dispose();
      innerShellMaterial.dispose();
      particleGeo.dispose();
      particleMaterial.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [color]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
    />
  );
}
