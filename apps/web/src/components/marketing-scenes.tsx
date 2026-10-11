"use client";

import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { ExtrudeGeometry, MathUtils, Shape, type Group } from "three";

// Marketing-only 3D scenes. They are decorative concept models: no property data, no measurements.

const CARBON = "#0a0a0a";
const PAPER = "#f3f3f3";
const CONCRETE = "#d4d4d4";
const GRAPHITE = "#2f2f2f";
const MINT = "#d1ffca";
const SUN = "#fff100";
const CELL = "#101a2e";

function useCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}
function useReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const ROOF_RISE = 1.2;
const ROOF_RUN = 1.5;
const SLOPE = Math.atan2(ROOF_RISE, ROOF_RUN);
const SLOPE_LENGTH = Math.hypot(ROOF_RISE, ROOF_RUN);
const WALL_HEIGHT = 2.2;

function Panel({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[1.02, 0.05, 0.72]} />
        <meshStandardMaterial color={PAPER} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.94, 0.02, 0.64]} />
        <meshStandardMaterial color={CELL} roughness={0.25} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.045, 0]}>
        <boxGeometry args={[0.012, 0.004, 0.64]} />
        <meshStandardMaterial color={MINT} />
      </mesh>
    </group>
  );
}

function House() {
  const gable = useMemo(() => {
    const shape = new Shape();
    shape.moveTo(-ROOF_RUN, 0);
    shape.lineTo(ROOF_RUN, 0);
    shape.lineTo(0, ROOF_RISE);
    shape.closePath();
    return new ExtrudeGeometry(shape, { depth: 3.9, bevelEnabled: false });
  }, []);

  // Panels sit on the front (south, +z) roof slope: a 3 x 2 array.
  const panels = useMemo(() => {
    const items: [number, number, number][] = [];
    const ridgeY = WALL_HEIGHT + ROOF_RISE;
    for (const s of [0.5, 1.3]) {
      for (const x of [-1.15, 0, 1.15]) {
        const lift = 0.1;
        items.push([
          x,
          ridgeY - Math.sin(SLOPE) * s + Math.cos(SLOPE) * lift,
          Math.cos(SLOPE) * s + Math.sin(SLOPE) * lift,
        ]);
      }
    }
    return items;
  }, []);

  return (
    <group position={[0, -1.7, 0]}>
      <mesh position={[0, WALL_HEIGHT / 2, 0]}>
        <boxGeometry args={[4, WALL_HEIGHT, 3]} />
        <meshStandardMaterial color={CONCRETE} roughness={0.95} flatShading />
      </mesh>
      <mesh geometry={gable} position={[-1.95, WALL_HEIGHT, 0]} rotation={[0, Math.PI / 2, 0]}>
        <meshStandardMaterial color={CONCRETE} roughness={0.95} />
      </mesh>
      {/* two roof slabs */}
      <mesh position={[0, WALL_HEIGHT + ROOF_RISE / 2 + 0.02, ROOF_RUN / 2 + 0.12]} rotation={[SLOPE, 0, 0]}>
        <boxGeometry args={[4.5, 0.12, SLOPE_LENGTH + 0.45]} />
        <meshStandardMaterial color={GRAPHITE} roughness={0.8} />
      </mesh>
      <mesh position={[0, WALL_HEIGHT + ROOF_RISE / 2 + 0.02, -ROOF_RUN / 2 - 0.12]} rotation={[-SLOPE, 0, 0]}>
        <boxGeometry args={[4.5, 0.12, SLOPE_LENGTH + 0.45]} />
        <meshStandardMaterial color={GRAPHITE} roughness={0.8} />
      </mesh>
      {panels.map((p, i) => (
        <group key={i} position={p} rotation={[SLOPE, 0, 0]}>
          <Panel position={[0, 0.07, 0]} />
        </group>
      ))}
      {/* door and windows */}
      <mesh position={[-0.9, 0.75, 1.51]}>
        <boxGeometry args={[0.7, 1.5, 0.04]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>
      {[0.5, 1.4].map(x => (
        <mesh key={x} position={[x, 1.2, 1.51]}>
          <boxGeometry args={[0.6, 0.6, 0.04]} />
          <meshStandardMaterial color={SUN} emissive={SUN} emissiveIntensity={0.25} />
        </mesh>
      ))}
      {/* rooftop water tank, kept clear of the panel array */}
      <mesh position={[1.35, WALL_HEIGHT + ROOF_RISE + 0.28, -0.55]}>
        <cylinderGeometry args={[0.28, 0.28, 0.5, 20]} />
        <meshStandardMaterial color={PAPER} roughness={0.6} />
      </mesh>
      {/* plinth */}
      <mesh position={[0, 0.04, 0]}>
        <boxGeometry args={[4.4, 0.08, 3.4]} />
        <meshStandardMaterial color={PAPER} />
      </mesh>
    </group>
  );
}

function Tree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.5, 8]} />
        <meshStandardMaterial color={GRAPHITE} />
      </mesh>
      <mesh position={[0, 0.85, 0]}>
        <coneGeometry args={[0.38, 1.1, 10]} />
        <meshStandardMaterial color={MINT} roughness={0.9} flatShading />
      </mesh>
    </group>
  );
}

function SunOrb() {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = 3.6 + Math.sin(clock.elapsedTime * 0.8) * 0.12;
  });
  return (
    <group ref={ref} position={[-3.1, 3.6, 2.2]}>
      <mesh>
        <sphereGeometry args={[0.38, 32, 32]} />
        <meshBasicMaterial color={SUN} />
      </mesh>
    </group>
  );
}

function Lights() {
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[-3, 6, 4]} intensity={2.1} />
      <directionalLight position={[4, 2, -3]} intensity={0.5} />
    </>
  );
}

export function HouseScene() {
  const interactive = !useCoarsePointer();
  const reduced = useReducedMotion();
  return (
    <Canvas camera={{ position: [5.6, 2.6, 6.4], fov: 32 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
      <Lights />
      <group position={[0, -0.1, 0]}>
        <House />
        <Tree position={[-3, -1.7, 1.6]} />
        <Tree position={[3.1, -1.7, 1.2]} />
        <ContactShadows position={[0, -1.69, 0]} opacity={0.35} scale={14} blur={2.6} far={4} frames={1} />
      </group>
      <SunOrb />
      <OrbitControls
        enabled={interactive}
        enableZoom={false}
        enablePan={false}
        autoRotate={!reduced}
        autoRotateSpeed={0.9}
        minPolarAngle={Math.PI / 3.6}
        maxPolarAngle={Math.PI / 2.1}
      />
    </Canvas>
  );
}

const LAYERS = [
  { name: "back sheet", y: -0.5, color: PAPER, size: [1.8, 0.04, 3] as const },
  { name: "cells", y: -0.17, color: CELL, size: [1.7, 0.03, 2.9] as const },
  { name: "glass", y: 0.2, color: "#9fd8ff", size: [1.8, 0.03, 3], opacity: 0.35 },
  { name: "frame", y: 0.55, color: MINT, size: [1.9, 0.08, 3.1] as const, frame: true },
] as const;

function CellGrid() {
  const cells = useMemo(() => {
    const items: [number, number][] = [];
    for (let col = 0; col < 6; col++) for (let row = 0; row < 10; row++) items.push([-0.68 + col * 0.272, -1.3 + row * 0.29]);
    return items;
  }, []);
  return (
    <>
      {cells.map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.02, z]}>
          <boxGeometry args={[0.24, 0.02, 0.26]} />
          <meshStandardMaterial color="#1c2d52" roughness={0.3} metalness={0.5} />
        </mesh>
      ))}
    </>
  );
}

function ExplodedPanel({ exploded }: { exploded: boolean }) {
  const refs = useRef<(Group | null)[]>([]);
  useFrame((_, delta) => {
    LAYERS.forEach((layer, index) => {
      const node = refs.current[index];
      if (!node) return;
      const target = exploded ? layer.y * 1.5 : layer.y * 0.18;
      node.position.y = MathUtils.damp(node.position.y, target, 5, delta);
    });
  });
  return (
    <group rotation={[0.25, 0, 0]}>
      {LAYERS.map((layer, index) => (
        <group key={layer.name} ref={node => { refs.current[index] = node; }}>
          {"frame" in layer ? (
            <>
              {/* open aluminium frame: four bars */}
              <mesh position={[0, 0, 1.5]}><boxGeometry args={[1.9, 0.08, 0.1]} /><meshStandardMaterial color={layer.color} roughness={0.5} /></mesh>
              <mesh position={[0, 0, -1.5]}><boxGeometry args={[1.9, 0.08, 0.1]} /><meshStandardMaterial color={layer.color} roughness={0.5} /></mesh>
              <mesh position={[0.9, 0, 0]}><boxGeometry args={[0.1, 0.08, 3.1]} /><meshStandardMaterial color={layer.color} roughness={0.5} /></mesh>
              <mesh position={[-0.9, 0, 0]}><boxGeometry args={[0.1, 0.08, 3.1]} /><meshStandardMaterial color={layer.color} roughness={0.5} /></mesh>
            </>
          ) : layer.name === "cells" ? (
            <>
              <mesh><boxGeometry args={[...layer.size]} /><meshStandardMaterial color="#0a1226" roughness={0.6} /></mesh>
              <CellGrid />
            </>
          ) : (
            <mesh>
              <boxGeometry args={[...layer.size]} />
              <meshStandardMaterial color={layer.color} roughness={0.2} transparent={"opacity" in layer} opacity={"opacity" in layer ? layer.opacity : 1} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

export function PanelScene() {
  const interactive = !useCoarsePointer();
  const reduced = useReducedMotion();
  const [exploded, setExploded] = useState(true);
  return (
    <div className="relative size-full">
      <Canvas camera={{ position: [4.2, 3.4, 5.2], fov: 32 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={1} />
        <directionalLight position={[-3, 6, 4]} intensity={2.2} color="#ffffff" />
        <directionalLight position={[4, -2, -3]} intensity={0.6} color={SUN} />
        <ExplodedPanel exploded={exploded} />
        <OrbitControls enabled={interactive} enableZoom={false} enablePan={false} autoRotate={!reduced} autoRotateSpeed={1.1} />
      </Canvas>
      <button
        type="button"
        aria-pressed={exploded}
        onClick={() => setExploded(value => !value)}
        className="absolute bottom-3 left-3 min-h-11 rounded-lg bg-white px-4 font-mono text-xs text-black transition hover:bg-[#d1ffca] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fff100]"
      >
        {exploded ? "Assemble panel" : "Explode panel"}
      </button>
    </div>
  );
}
