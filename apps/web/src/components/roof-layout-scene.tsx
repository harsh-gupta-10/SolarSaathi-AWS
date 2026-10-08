"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import type { RoofLayout } from "@solarsaathi/calculations";

export type ViewCommand = { action: "left" | "right" | "in" | "out" | "top" | "reset"; sequence: number };
type Point = { x: number; y: number; z: number };

function SurfaceBatch({ shapes, color, border }: { shapes: readonly { corners: readonly Point[] }[]; color: string; border: string }) {
  const { faces, edges } = useMemo(() => {
    const facePositions: number[] = [];
    const edgePositions: number[] = [];
    for (const shape of shapes) {
      const corners = shape.corners;
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const point = corners[index];
        facePositions.push(point.x, point.y, point.z);
      }
      for (let index = 0; index < 4; index++) {
        const start = corners[index], end = corners[(index + 1) % 4];
        edgePositions.push(start.x, start.y + 0.014, start.z, end.x, end.y + 0.014, end.z);
      }
    }
    const faces = new BufferGeometry();
    faces.setAttribute("position", new Float32BufferAttribute(facePositions, 3));
    faces.computeVertexNormals();
    const edges = new BufferGeometry();
    edges.setAttribute("position", new Float32BufferAttribute(edgePositions, 3));
    return { faces, edges };
  }, [shapes]);
  useEffect(() => () => { faces.dispose(); edges.dispose(); }, [faces, edges]);
  return <>
    <mesh geometry={faces}>
      <meshStandardMaterial color={color} side={DoubleSide} roughness={0.85} metalness={0.06} />
    </mesh>
    <lineSegments geometry={edges}><lineBasicMaterial color={border} /></lineSegments>
  </>;
}

function CameraControls({ layout, command, reducedMotion }: { layout: RoofLayout; command: ViewCommand; reducedMotion: boolean }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  const bounds = layout.bounds;
  const center = bounds ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 } : { x: 0, y: 0, z: 0 };
  const width = bounds ? bounds.max.x - bounds.min.x : 8;
  const depth = bounds ? bounds.max.z - bounds.min.z : 8;
  const distance = Math.max(width, depth, 6) * 1.7;

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || command.sequence === 0) return;
    const offset = camera.position.clone().sub(orbit.target);
    if (command.action === "reset") camera.position.set(center.x + distance * 0.7, center.y + distance * 0.85, center.z + distance * 0.8);
    if (command.action === "top") camera.position.set(center.x, center.y + distance * 1.35, center.z + 0.001);
    if (command.action === "left" || command.action === "right") {
      const angle = command.action === "left" ? Math.PI / 6 : -Math.PI / 6;
      offset.applyAxisAngle(camera.up, angle);
      camera.position.copy(orbit.target).add(offset);
    }
    if (command.action === "in" || command.action === "out") {
      const factor = command.action === "in" ? 0.8 : 1.25;
      offset.multiplyScalar(factor);
      camera.position.copy(orbit.target).add(offset);
    }
    orbit.target.set(center.x, center.y, center.z);
    orbit.update(); invalidate();
  }, [camera, center.x, center.y, center.z, command, distance, invalidate]);

  return <OrbitControls ref={controls} target={[center.x, center.y, center.z]} enablePan={false}
    enableDamping={!reducedMotion} dampingFactor={0.08} minDistance={Math.max(1.5, distance * 0.25)}
    maxDistance={distance * 3} minPolarAngle={0.05} maxPolarAngle={Math.PI / 2.1} />;
}

export default function RoofLayoutScene({ layout, command, reducedMotion }: { layout: RoofLayout; command: ViewCommand; reducedMotion: boolean }) {
  const bounds = layout.bounds;
  const center = bounds ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 } : { x: 0, y: 0, z: 0 };
  const width = bounds ? bounds.max.x - bounds.min.x : 8;
  const depth = bounds ? bounds.max.z - bounds.min.z : 8;
  const distance = Math.max(width, depth, 6) * 1.7;
  const measuredSegments = useMemo(() => layout.segments.filter(segment => segment.geometryKind !== "AREA_ONLY_ILLUSTRATION"), [layout.segments]);
  const symbolicSegments = useMemo(() => layout.segments.filter(segment => segment.geometryKind === "AREA_ONLY_ILLUSTRATION"), [layout.segments]);
  return <Canvas camera={{ position: [center.x + distance * 0.7, center.y + distance * 0.85, center.z + distance * 0.8], fov: 44, near: 0.1, far: distance * 10 }}
    frameloop="demand" dpr={[1, 1.8]} gl={{ antialias: true, alpha: false }} fallback={<p role="status">3D graphics are unavailable. Use the plan view.</p>}>
    <color attach="background" args={["#102a27"]} />
    <ambientLight intensity={1.6} />
    <directionalLight position={[center.x - distance, center.y + distance * 1.5, center.z + distance]} intensity={1.8} />
    <gridHelper args={[Math.max(width, depth, 6) * 2.4, 24, "#54746b", "#294b44"]} position={[center.x, (bounds?.min.y ?? 0) - 0.3, center.z]} />
    {measuredSegments.length > 0 && <SurfaceBatch shapes={measuredSegments} color="#83a98b" border="#d1e6ce" />}
    {symbolicSegments.length > 0 && <SurfaceBatch shapes={symbolicSegments} color="#64746a" border="#d1e6ce" />}
    {layout.panels.length > 0 && <SurfaceBatch shapes={layout.panels} color="#183d50" border="#e8b44b" />}
    <CameraControls layout={layout} command={command} reducedMotion={reducedMotion} />
  </Canvas>;
}
