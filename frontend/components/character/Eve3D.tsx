"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// EVE, rendered from Tarun's own real 3D model (public/assets/eve.glb,
// exported from his Downloads/Eva.blend via Blender's headless CLI —
// ~14k verts, glossy PBR materials, a pure-emission blue-eye material)
// instead of a hand-drawn flat SVG. Real geometry + real lighting is what
// "realistic" actually means here, not more SVG gradient tricks.
//
// The source file has no armature — head/body/arms are one fused mesh —
// so there's no way to flutter the arms independently the way the SVG
// version did. A gentle whole-body sway substitutes for that idle motion.
// Callers using this must first confirm `isWebglSupported()` themselves
// and fall back to SkynetBot (the SVG version) otherwise, same pattern
// SiriOrb.tsx already uses for HologramOrb.
//
// The export pipeline now splits the eye-material primitive into its own
// node (named "Eyes", via Blender's separate-by-material) instead of
// leaving it fused into the single body mesh — this is what makes
// `expression` below possible: EVE's actual character design conveys mood
// by tilting/squinting the eye lenses, not a face rig, so a separate,
// independently-transformable eye object is the real fix, not a hack.
const MODEL_URL = "/assets/eve.glb";

export type EveExpression = "neutral" | "listening" | "thinking" | "happy" | "curious";

// Target eye-node pose per expression — lerped toward every frame (see the
// animate() loop below) rather than snapped, so a change reads as an
// actual expression shift instead of a jump cut.
const EXPRESSION_TARGETS: Record<EveExpression, { rotationZ: number; scaleY: number; scaleX: number }> = {
  neutral: { rotationZ: 0, scaleY: 1, scaleX: 1 },
  listening: { rotationZ: 0, scaleY: 1.12, scaleX: 1.04 }, // eyes widen, attentive
  thinking: { rotationZ: -0.08, scaleY: 0.82, scaleX: 1 }, // narrowed, slight tilt — pensive
  happy: { rotationZ: 0, scaleY: 0.62, scaleX: 1.08 }, // upward squint-curve
  curious: { rotationZ: 0.16, scaleY: 1, scaleX: 1 }, // asymmetric tilt, head-tilt-like quizzical look
};

export function Eve3D({
  eyeColor,
  size = 120,
  expression = "neutral",
}: {
  eyeColor: string;
  size?: number;
  expression?: EveExpression;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const eyeColorRef = useRef(eyeColor);
  eyeColorRef.current = eyeColor;
  const expressionRef = useRef(expression);
  expressionRef.current = expression;
  const eyeMaterialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const eyeNodeRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.12, 3.6);
    camera.lookAt(0, 0.05, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    // Blender's own lights weren't exported (export_lights=False in the
    // conversion script) — recreated here as a key/fill/rim/ambient rig
    // to get roughly the same glossy studio look the original render had.
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.85);
    fillLight.position.set(-3, 1, 2);
    scene.add(fillLight);
    const rim = new THREE.DirectionalLight(0xffffff, 1.5);
    rim.position.set(-1, 2, -3);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    let model: THREE.Object3D | null = null;
    let disposed = false;
    const loader = new GLTFLoader();
    loader.load(MODEL_URL, (gltf) => {
      if (disposed) return;
      model = gltf.scene;

      // Defensive only — the export pipeline no longer carries the studio
      // backdrop/ground plane at all (it used to render as a huge flat
      // orange/tan slab dwarfing EVE and skew the bounding-box math below),
      // but this stays as a no-op safety net in case a future re-export
      // brings one back in.
      const toRemove: THREE.Object3D[] = [];
      model.traverse((child) => {
        if (/plane/i.test(child.name)) toRemove.push(child);
      });
      for (const obj of toRemove) obj.parent?.remove(obj);

      // Center and scale to a consistent frame regardless of the source
      // file's own units/origin.
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const dimensions = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(dimensions.x, dimensions.y, dimensions.z) || 1;
      const scale = 2.1 / maxDim;
      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));
      model.userData.baseY = model.position.y;

      // The eyes are the only pure-emission material on the model (found
      // via Blender's node graph: "Material.002", an Emission shader, not
      // a Principled BSDF) — found here by scanning for any material with
      // a non-black emissive color, rather than hardcoding a material
      // index that could shift on a re-export. The export pipeline now
      // splits that material into its own node ("Eyes", via Blender's
      // separate-by-material) instead of leaving it fused into the body,
      // so the mesh carrying it is itself a real, independently
      // transformable object — that's what makes `expression` possible.
      const eyeMats: THREE.MeshStandardMaterial[] = [];
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
          const std = m as THREE.MeshStandardMaterial;
          std.side = THREE.DoubleSide;
          if (std.emissive && (std.emissive.r > 0 || std.emissive.g > 0 || std.emissive.b > 0)) {
            eyeMats.push(std);
            eyeNodeRef.current = mesh;
          }
          // "Material.001" (289 verts, no emissive) is the face's glass
          // dome overlay in the source .blend — a genuine glass BSDF in
          // Blender, but Blender's glTF exporter has no glass equivalent
          // and falls back to an opaque white PBR material. Verified live:
          // with this one mesh hidden, the visor and eyes underneath
          // render perfectly; with it shown opaque, it blankets the whole
          // face and hides both. Approximated here as actual transparent
          // glass instead — keeps the glossy dome read without blocking
          // what's underneath.
          if (std.name === "Material.001") {
            std.transparent = true;
            std.opacity = 0.18;
            std.depthWrite = false;
            std.metalness = 0;
            std.roughness = 0.05;
          }
        }
      });
      eyeMaterialsRef.current = eyeMats;

      // Blender's separate-by-material keeps the split object's origin
      // wherever the *original* fused body's origin was — rotating/scaling
      // around that would swing the eyes through a wide arc instead of
      // tilting in place. Recenter the mesh's local pivot to its own
      // geometry center (same effect as Blender's "Origin to Geometry"),
      // compensating the position so it doesn't visually jump.
      const eyeMesh = eyeNodeRef.current;
      if (eyeMesh) {
        eyeMesh.geometry.computeBoundingBox();
        const eyeCenter = new THREE.Vector3();
        eyeMesh.geometry.boundingBox?.getCenter(eyeCenter);
        eyeMesh.geometry.translate(-eyeCenter.x, -eyeCenter.y, -eyeCenter.z);
        eyeMesh.position.add(eyeCenter);
      }

      scene.add(model);
    });

    let frameId: number;
    let elapsed = 0;
    const clock = new THREE.Clock();
    function animate() {
      frameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      elapsed += delta;
      if (model) {
        // Gentle idle sway/bob — substitutes for the old SVG's arm
        // flutter, since this mesh has no separate arm parts to animate.
        model.rotation.y = Math.sin(elapsed * 0.6) * 0.18;
        model.position.y = model.userData.baseY + Math.sin(elapsed * 1.4) * 0.04;
      }
      for (const mat of eyeMaterialsRef.current) {
        mat.emissive.set(eyeColorRef.current);
        mat.emissiveIntensity = 1.8;
      }
      const eyeMesh = eyeNodeRef.current;
      if (eyeMesh) {
        const target = EXPRESSION_TARGETS[expressionRef.current];
        // Lerp rather than snap, and fast enough (8x delta) that a real
        // state change (e.g. idle -> thinking) still reads within a
        // couple of frames instead of feeling laggy.
        const t = Math.min(1, delta * 8);
        eyeMesh.rotation.z += (target.rotationZ - eyeMesh.rotation.z) * t;
        eyeMesh.scale.y += (target.scaleY - eyeMesh.scale.y) * t;
        eyeMesh.scale.x += (target.scaleX - eyeMesh.scale.x) * t;
      }
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((m) => m?.dispose());
        }
      });
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [size]);

  return <div ref={containerRef} style={{ width: size, height: size }} />;
}
