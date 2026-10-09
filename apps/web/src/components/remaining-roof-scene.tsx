"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import type { DesignsResponse, DesignCandidate } from "../lib/designs-api";
import type { ViewCommand } from "./roof-layout-scene";

type Point = { x: number; y: number; z: number };
type Shape = { corners: readonly Point[] };

function Layer({ shapes, color, border, lift = 0, opacity = 1, thickness = 0, sideColor = color }: {
  shapes: readonly Shape[]; color: string; border: string; lift?: number; opacity?: number;
  thickness?: number; sideColor?: string;
}) {
  const { faces, sides, edges } = useMemo(() => {
    const facePositions: number[] = [], sidePositions: number[] = [], edgePositions: number[] = [];
    for (const shape of shapes) {
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const point = shape.corners[index]; facePositions.push(point.x, point.y + lift, point.z);
      }
      for (let index = 0; index < 4; index++) {
        const start = shape.corners[index], end = shape.corners[(index + 1) % 4];
        edgePositions.push(start.x, start.y + lift + 0.01, start.z, end.x, end.y + lift + 0.01, end.z);
        if (thickness > 0) {
          const topA = [start.x, start.y + lift, start.z];
          const topB = [end.x, end.y + lift, end.z];
          const bottomA = [start.x, start.y + lift - thickness, start.z];
          const bottomB = [end.x, end.y + lift - thickness, end.z];
          sidePositions.push(...topA, ...topB, ...bottomB, ...topA, ...bottomB, ...bottomA);
          edgePositions.push(...bottomA, ...bottomB);
        }
      }
    }
    const faces = new BufferGeometry(); faces.setAttribute("position", new Float32BufferAttribute(facePositions, 3)); faces.computeVertexNormals();
    const sides = new BufferGeometry(); sides.setAttribute("position", new Float32BufferAttribute(sidePositions, 3)); sides.computeVertexNormals();
    const edges = new BufferGeometry(); edges.setAttribute("position", new Float32BufferAttribute(edgePositions, 3));
    return { faces, sides, edges };
  }, [shapes, lift, thickness]);
  useEffect(() => () => { faces.dispose(); sides.dispose(); edges.dispose(); }, [faces, sides, edges]);
  return <><mesh geometry={faces}><meshStandardMaterial color={color} side={DoubleSide} roughness={0.8}
    transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} /></mesh>
    {thickness > 0 && <mesh geometry={sides}><meshStandardMaterial color={sideColor} side={DoubleSide} roughness={0.9} /></mesh>}
    <lineSegments geometry={edges}><lineBasicMaterial color={border} /></lineSegments></>;
}

function CameraControls({ center, distance, command, reducedMotion }: {
  center: Point; distance: number; command: ViewCommand; reducedMotion: boolean;
}) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || !command.sequence) return;
    const offset = camera.position.clone().sub(orbit.target);
    if (command.action === "reset") camera.position.set(center.x + distance * 0.7, center.y + distance * 0.85, center.z + distance * 0.8);
    if (command.action === "top") camera.position.set(center.x, center.y + distance * 1.35, center.z + 0.001);
    if (command.action === "left" || command.action === "right") {
      offset.applyAxisAngle(camera.up, command.action === "left" ? Math.PI / 6 : -Math.PI / 6);
      camera.position.copy(orbit.target).add(offset);
    }
    if (command.action === "in" || command.action === "out") {
      offset.multiplyScalar(command.action === "in" ? 0.8 : 1.25);
      camera.position.copy(orbit.target).add(offset);
    }
    orbit.target.set(center.x, center.y, center.z); orbit.update(); invalidate();
  }, [camera, center.x, center.y, center.z, command, distance, invalidate]);
  return <OrbitControls ref={controls} target={[center.x, center.y, center.z]} enablePan={false}
    enableDamping={!reducedMotion} minDistance={Math.max(1.5, distance * 0.25)} maxDistance={distance * 3}
    minPolarAngle={0.05} maxPolarAngle={Math.PI / 2.1} />;
}

export default function RemainingRoofScene({ geometry, placement, command, reducedMotion }: {
  geometry: DesignsResponse["geometry"]; placement?: DesignCandidate["placement"];
  command: ViewCommand; reducedMotion: boolean;
}) {
  const bounds = useMemo(() => {
    const points = geometry.segments.flatMap(segment => segment.corners);
    const min = { x: Math.min(...points.map(point => point.x)), y: Math.min(...points.map(point => point.y)),
      z: Math.min(...points.map(point => point.z)) };
    const max = { x: Math.max(...points.map(point => point.x)), y: Math.max(...points.map(point => point.y)),
      z: Math.max(...points.map(point => point.z)) };
    const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
    return { min, max, center, distance: Math.max(max.x - min.x, max.z - min.z, 6) * 1.7 };
  }, [geometry.segments]);
  const { center, distance } = bounds;
  return <Canvas camera={{ position: [center.x + distance * 0.7, center.y + distance * 0.85,
    center.z + distance * 0.8], fov: 44, near: 0.1, far: distance * 10 }}
    role="img" aria-label={`Interactive schematic 3D roof with ${geometry.panels.length} solar panels, ${geometry.freeZones.length} of ${geometry.totalFreeZoneCount} modeled free zones${placement ? " and a selected concept footprint" : ""}`}
    frameloop="demand" dpr={[1, 1.8]} gl={{ antialias: true, alpha: false }}
    fallback={<p role="status">3D graphics are unavailable. Use the plan view.</p>}>
    <color attach="background" args={["#102c28"]} />
    <ambientLight intensity={1.7} />
    <directionalLight position={[center.x - distance, center.y + distance * 1.5, center.z + distance]} intensity={1.7} />
    <gridHelper args={[Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z, 6) * 2.4,
      24, "#55766b", "#294d44"]} position={[center.x, bounds.min.y - 0.3, center.z]} />
    <Layer shapes={geometry.segments} color="#8eae91" sideColor="#53766a" border="#d7e8ce" thickness={0.22} />
    <Layer shapes={geometry.freeZones} color="#b9c986" border="#eddd83" lift={0.025} opacity={0.8} />
    <Layer shapes={geometry.panels} color="#183f57" sideColor="#0d2638" border="#dcb85e" lift={0.075} thickness={0.04} />
    {placement && <Layer shapes={[placement]} color="#dfa767" border="#fff0b2" lift={0.09} opacity={0.95} />}
    <CameraControls center={center} distance={distance} command={command} reducedMotion={reducedMotion} />
  </Canvas>;
}
