"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import type { RoofLayout } from "@solarsaathi/calculations";

export type ViewCommand = { action: "left" | "right" | "in" | "out" | "top" | "reset"; sequence: number };
type Point = { x: number; y: number; z: number };

/**
 * Renders the building walls, foundation plinth, and roof fascia beneath the modeled roof
 * so the house appears as a realistic architectural structure instead of a floating flat polygon.
 */
function BuildingStructure({
  segments,
  bounds,
}: {
  segments: RoofLayout["segments"];
  bounds: RoofLayout["bounds"];
}) {
  const groundY = (bounds?.min.y ?? 0) - 3.8;
  const plinthHeight = 0.45;
  const fasciaHeight = 0.18;

  const { wallFaces, plinthFaces, fasciaFaces, wallEdges } = useMemo(() => {
    const wallPos: number[] = [];
    const plinthPos: number[] = [];
    const fasciaPos: number[] = [];
    const edgePos: number[] = [];

    for (const segment of segments) {
      const corners = segment.corners;
      for (let i = 0; i < 4; i++) {
        const c1 = corners[i];
        const c2 = corners[(i + 1) % 4];

        // 1. Main wall quad (from below fascia down to plinth)
        const topY1 = c1.y - fasciaHeight;
        const topY2 = c2.y - fasciaHeight;
        const botY = groundY + plinthHeight;

        // Tri 1
        wallPos.push(c1.x, topY1, c1.z, c2.x, topY2, c2.z, c2.x, botY, c2.z);
        // Tri 2
        wallPos.push(c1.x, topY1, c1.z, c2.x, botY, c2.z, c1.x, botY, c1.z);

        // 2. Foundation plinth quad (from botY down to groundY)
        plinthPos.push(c1.x, botY, c1.z, c2.x, botY, c2.z, c2.x, groundY, c2.z);
        plinthPos.push(c1.x, botY, c1.z, c2.x, groundY, c2.z, c1.x, groundY, c1.z);

        // 3. Roof fascia / eave trim quad (from roof surface down by fasciaHeight)
        fasciaPos.push(c1.x, c1.y, c1.z, c2.x, c2.y, c2.z, c2.x, topY2, c2.z);
        fasciaPos.push(c1.x, c1.y, c1.z, c2.x, topY2, c2.z, c1.x, topY1, c1.z);

        // Wall corner accent lines
        edgePos.push(c1.x, c1.y, c1.z, c1.x, groundY, c1.z);
        edgePos.push(c1.x, topY1, c1.z, c2.x, topY2, c2.z);
        edgePos.push(c1.x, botY, c1.z, c2.x, botY, c2.z);
      }
    }

    const wallsGeo = new BufferGeometry();
    wallsGeo.setAttribute("position", new Float32BufferAttribute(wallPos, 3));
    wallsGeo.computeVertexNormals();

    const plinthGeo = new BufferGeometry();
    plinthGeo.setAttribute("position", new Float32BufferAttribute(plinthPos, 3));
    plinthGeo.computeVertexNormals();

    const fasciaGeo = new BufferGeometry();
    fasciaGeo.setAttribute("position", new Float32BufferAttribute(fasciaPos, 3));
    fasciaGeo.computeVertexNormals();

    const edgesGeo = new BufferGeometry();
    edgesGeo.setAttribute("position", new Float32BufferAttribute(edgePos, 3));

    return { wallFaces: wallsGeo, plinthFaces: plinthGeo, fasciaFaces: fasciaGeo, wallEdges: edgesGeo };
  }, [segments, groundY]);

  useEffect(() => () => {
    wallFaces.dispose();
    plinthFaces.dispose();
    fasciaFaces.dispose();
    wallEdges.dispose();
  }, [wallFaces, plinthFaces, fasciaFaces, wallEdges]);

  return (
    <>
      {/* Exterior masonry / render wall */}
      <mesh geometry={wallFaces}>
        <meshStandardMaterial color="#ded7ca" roughness={0.88} metalness={0.04} side={DoubleSide} />
      </mesh>
      {/* Foundation plinth */}
      <mesh geometry={plinthFaces}>
        <meshStandardMaterial color="#475569" roughness={0.92} metalness={0.08} side={DoubleSide} />
      </mesh>
      {/* Roof edge fascia */}
      <mesh geometry={fasciaFaces}>
        <meshStandardMaterial color="#334155" roughness={0.65} metalness={0.2} side={DoubleSide} />
      </mesh>
      {/* Architectural corner lines */}
      <lineSegments geometry={wallEdges}>
        <lineBasicMaterial color="#94a3b8" transparent opacity={0.4} />
      </lineSegments>
    </>
  );
}

/**
 * Realistic Solar PV Panels:
 * Renders aluminum metallic frames, dark reflective monocrystalline cell faces with cell grid lines,
 * and mounting bracket stanchions connecting panels to the roof plane.
 */
function RealisticPanelsBatch({ panels }: { panels: RoofLayout["panels"] }) {
  const { frameFaces, cellFaces, bracketFaces, gridEdges } = useMemo(() => {
    const framePos: number[] = [];
    const cellPos: number[] = [];
    const bracketPos: number[] = [];
    const gridPos: number[] = [];

    const frameThickness = 0.04; // 40mm solar module frame height
    const frameBorder = 0.035; // 35mm frame lip width
    const mountElevation = 0.06; // 60mm mounting rail offset above roof surface

    for (const panel of panels) {
      const c = panel.corners;
      if (c.length < 4) continue;

      // Vectors across module width and length
      const ux = c[1].x - c[0].x, uy = c[1].y - c[0].y, uz = c[1].z - c[0].z;
      const vx = c[3].x - c[0].x, vy = c[3].y - c[0].y, vz = c[3].z - c[0].z;
      const lenU = Math.hypot(ux, uy, uz) || 1;
      const lenV = Math.hypot(vx, vy, vz) || 1;
      const uDir = { x: ux / lenU, y: uy / lenU, z: uz / lenU };
      const vDir = { x: vx / lenV, y: vy / lenV, z: vz / lenV };

      // Normal to the panel plane
      const nx = uDir.y * vDir.z - uDir.z * vDir.y;
      const ny = uDir.z * vDir.x - uDir.x * vDir.z;
      const nz = uDir.x * vDir.y - uDir.y * vDir.x;
      const lenN = Math.hypot(nx, ny, nz) || 1;
      let norm = { x: nx / lenN, y: ny / lenN, z: nz / lenN };
      if (norm.y < 0) {
        norm = { x: -norm.x, y: -norm.y, z: -norm.z };
      }

      // Base elevated corners
      const elevated = c.map(pt => ({
        x: pt.x + norm.x * mountElevation,
        y: pt.y + norm.y * mountElevation,
        z: pt.z + norm.z * mountElevation,
      }));

      // Top of the frame
      const topCorners = elevated.map(pt => ({
        x: pt.x + norm.x * frameThickness,
        y: pt.y + norm.y * frameThickness,
        z: pt.z + norm.z * frameThickness,
      }));

      // Inner cell surface (inset from frame edges)
      const insetU = frameBorder;
      const insetV = frameBorder;
      const cellSurfaceCorners = [
        {
          x: topCorners[0].x + uDir.x * insetU + vDir.x * insetV,
          y: topCorners[0].y + uDir.y * insetU + vDir.y * insetV,
          z: topCorners[0].z + uDir.z * insetU + vDir.z * insetV,
        },
        {
          x: topCorners[1].x - uDir.x * insetU + vDir.x * insetV,
          y: topCorners[1].y - uDir.y * insetU + vDir.y * insetV,
          z: topCorners[1].z - uDir.z * insetU + vDir.z * insetV,
        },
        {
          x: topCorners[2].x - uDir.x * insetU - vDir.x * insetV,
          y: topCorners[2].y - uDir.y * insetU - vDir.y * insetV,
          z: topCorners[2].z - uDir.z * insetU - vDir.z * insetV,
        },
        {
          x: topCorners[3].x + uDir.x * insetU - vDir.x * insetV,
          y: topCorners[3].y + uDir.y * insetU - vDir.y * insetV,
          z: topCorners[3].z + uDir.z * insetU - vDir.z * insetV,
        },
      ];

      // 1. Cell Face (photovoltaic glass surface)
      cellPos.push(
        cellSurfaceCorners[0].x, cellSurfaceCorners[0].y, cellSurfaceCorners[0].z,
        cellSurfaceCorners[1].x, cellSurfaceCorners[1].y, cellSurfaceCorners[1].z,
        cellSurfaceCorners[2].x, cellSurfaceCorners[2].y, cellSurfaceCorners[2].z,
        cellSurfaceCorners[0].x, cellSurfaceCorners[0].y, cellSurfaceCorners[0].z,
        cellSurfaceCorners[2].x, cellSurfaceCorners[2].y, cellSurfaceCorners[2].z,
        cellSurfaceCorners[3].x, cellSurfaceCorners[3].y, cellSurfaceCorners[3].z
      );

      // 2. Aluminum Frame Sides (4 outer vertical faces)
      for (let i = 0; i < 4; i++) {
        const b1 = elevated[i];
        const b2 = elevated[(i + 1) % 4];
        const t1 = topCorners[i];
        const t2 = topCorners[(i + 1) % 4];

        framePos.push(b1.x, b1.y, b1.z, b2.x, b2.y, b2.z, t2.x, t2.y, t2.z);
        framePos.push(b1.x, b1.y, b1.z, t2.x, t2.y, t2.z, t1.x, t1.y, t1.z);
      }

      // 3. Top Frame Bevel Rim (between outer topCorners and cellSurfaceCorners)
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        framePos.push(
          topCorners[i].x, topCorners[i].y, topCorners[i].z,
          topCorners[next].x, topCorners[next].y, topCorners[next].z,
          cellSurfaceCorners[next].x, cellSurfaceCorners[next].y, cellSurfaceCorners[next].z,
          topCorners[i].x, topCorners[i].y, topCorners[i].z,
          cellSurfaceCorners[next].x, cellSurfaceCorners[next].y, cellSurfaceCorners[next].z,
          cellSurfaceCorners[i].x, cellSurfaceCorners[i].y, cellSurfaceCorners[i].z
        );
      }

      // 4. Mounting Bracket Struts under the panel corners
      for (let i = 0; i < 4; i++) {
        const roofPt = c[i];
        const mountPt = elevated[i];
        const w = 0.04;
        bracketPos.push(
          roofPt.x - w, roofPt.y, roofPt.z - w,
          roofPt.x + w, roofPt.y, roofPt.z + w,
          mountPt.x, mountPt.y, mountPt.z
        );
      }

      // 5. Silicon cell grid division lines across the cell surface
      const cellCols = 6;
      const cellRows = 10;
      for (let col = 1; col < cellCols; col++) {
        const frac = col / cellCols;
        const p1x = cellSurfaceCorners[0].x + (cellSurfaceCorners[1].x - cellSurfaceCorners[0].x) * frac;
        const p1y = cellSurfaceCorners[0].y + (cellSurfaceCorners[1].y - cellSurfaceCorners[0].y) * frac + norm.y * 0.002;
        const p1z = cellSurfaceCorners[0].z + (cellSurfaceCorners[1].z - cellSurfaceCorners[0].z) * frac;

        const p2x = cellSurfaceCorners[3].x + (cellSurfaceCorners[2].x - cellSurfaceCorners[3].x) * frac;
        const p2y = cellSurfaceCorners[3].y + (cellSurfaceCorners[2].y - cellSurfaceCorners[3].y) * frac + norm.y * 0.002;
        const p2z = cellSurfaceCorners[3].z + (cellSurfaceCorners[2].z - cellSurfaceCorners[3].z) * frac;

        gridPos.push(p1x, p1y, p1z, p2x, p2y, p2z);
      }
      for (let row = 1; row < cellRows; row++) {
        const frac = row / cellRows;
        const p1x = cellSurfaceCorners[0].x + (cellSurfaceCorners[3].x - cellSurfaceCorners[0].x) * frac;
        const p1y = cellSurfaceCorners[0].y + (cellSurfaceCorners[3].y - cellSurfaceCorners[0].y) * frac + norm.y * 0.002;
        const p1z = cellSurfaceCorners[0].z + (cellSurfaceCorners[3].z - cellSurfaceCorners[0].z) * frac;

        const p2x = cellSurfaceCorners[1].x + (cellSurfaceCorners[2].x - cellSurfaceCorners[1].x) * frac;
        const p2y = cellSurfaceCorners[1].y + (cellSurfaceCorners[2].y - cellSurfaceCorners[1].y) * frac + norm.y * 0.002;
        const p2z = cellSurfaceCorners[1].z + (cellSurfaceCorners[2].z - cellSurfaceCorners[1].z) * frac;

        gridPos.push(p1x, p1y, p1z, p2x, p2y, p2z);
      }
    }

    const frameGeo = new BufferGeometry();
    frameGeo.setAttribute("position", new Float32BufferAttribute(framePos, 3));
    frameGeo.computeVertexNormals();

    const cellGeo = new BufferGeometry();
    cellGeo.setAttribute("position", new Float32BufferAttribute(cellPos, 3));
    cellGeo.computeVertexNormals();

    const bracketGeo = new BufferGeometry();
    bracketGeo.setAttribute("position", new Float32BufferAttribute(bracketPos, 3));
    bracketGeo.computeVertexNormals();

    const gridGeo = new BufferGeometry();
    gridGeo.setAttribute("position", new Float32BufferAttribute(gridPos, 3));

    return { frameFaces: frameGeo, cellFaces: cellGeo, bracketFaces: bracketGeo, gridEdges: gridGeo };
  }, [panels]);

  useEffect(() => () => {
    frameFaces.dispose();
    cellFaces.dispose();
    bracketFaces.dispose();
    gridEdges.dispose();
  }, [frameFaces, cellFaces, bracketFaces, gridEdges]);

  return (
    <>
      {/* Dark reflective monocrystalline silicon cell face */}
      <mesh geometry={cellFaces}>
        <meshStandardMaterial
          color="#0a192f"
          roughness={0.16}
          metalness={0.86}
          side={DoubleSide}
        />
      </mesh>
      {/* Anodized aluminum metallic module frame */}
      <mesh geometry={frameFaces}>
        <meshStandardMaterial
          color="#cbd5e1"
          roughness={0.35}
          metalness={0.75}
          side={DoubleSide}
        />
      </mesh>
      {/* Mounting brackets */}
      <mesh geometry={bracketFaces}>
        <meshStandardMaterial
          color="#475569"
          roughness={0.6}
          metalness={0.5}
          side={DoubleSide}
        />
      </mesh>
      {/* Cell busbars and grid pattern */}
      <lineSegments geometry={gridEdges}>
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.25} />
      </lineSegments>
    </>
  );
}

/**
 * Renders the roof deck plane with architectural tile/slab texture.
 */
function RoofDeckBatch({ shapes, color, border }: { shapes: readonly { corners: readonly Point[] }[]; color: string; border: string }) {
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
        edgePositions.push(start.x, start.y + 0.012, start.z, end.x, end.y + 0.012, end.z);
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

  return (
    <>
      <mesh geometry={faces}>
        <meshStandardMaterial color={color} side={DoubleSide} roughness={0.82} metalness={0.08} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={border} />
      </lineSegments>
    </>
  );
}

function CameraControls({ layout, command, reducedMotion }: { layout: RoofLayout; command: ViewCommand; reducedMotion: boolean }) {
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  const bounds = layout.bounds;
  const center = bounds ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 } : { x: 0, y: 0, z: 0 };
  const width = bounds ? bounds.max.x - bounds.min.x : 8;
  const depth = bounds ? bounds.max.z - bounds.min.z : 8;
  const distance = Math.max(width, depth, 6) * 1.75;

  useEffect(() => {
    const orbit = controls.current;
    if (!orbit || command.sequence === 0) return;
    const offset = camera.position.clone().sub(orbit.target);
    if (command.action === "reset") camera.position.set(center.x + distance * 0.7, center.y + distance * 0.85, center.z + distance * 0.8);
    if (command.action === "top") camera.position.set(center.x, center.y + distance * 1.4, center.z + 0.001);
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
    orbit.target.set(center.x, center.y - 0.5, center.z);
    orbit.update();
    invalidate();
  }, [camera, center.x, center.y, center.z, command, distance, invalidate]);

  return (
    <OrbitControls
      ref={controls}
      target={[center.x, center.y - 0.5, center.z]}
      enablePan={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      minDistance={Math.max(2, distance * 0.25)}
      maxDistance={distance * 3}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2.05}
    />
  );
}

export default function RoofLayoutScene({ layout, command, reducedMotion }: { layout: RoofLayout; command: ViewCommand; reducedMotion: boolean }) {
  const bounds = layout.bounds;
  const center = bounds ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 } : { x: 0, y: 0, z: 0 };
  const width = bounds ? bounds.max.x - bounds.min.x : 8;
  const depth = bounds ? bounds.max.z - bounds.min.z : 8;
  const distance = Math.max(width, depth, 6) * 1.75;
  const groundY = (bounds?.min.y ?? 0) - 3.8;
  const groundRadius = Math.max(width, depth, 8) * 1.6;

  const measuredSegments = useMemo(() => layout.segments.filter(segment => segment.geometryKind !== "AREA_ONLY_ILLUSTRATION"), [layout.segments]);
  const symbolicSegments = useMemo(() => layout.segments.filter(segment => segment.geometryKind === "AREA_ONLY_ILLUSTRATION"), [layout.segments]);

  return (
    <Canvas
      camera={{ position: [center.x + distance * 0.75, center.y + distance * 0.9, center.z + distance * 0.85], fov: 42, near: 0.1, far: distance * 12 }}
      role="img"
      aria-label={`Interactive 3D building and rooftop solar model with ${layout.segments.length} modeled roof segments and ${layout.panels.length} realistic solar modules`}
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      fallback={<p role="status">3D graphics are unavailable. Use the plan view.</p>}
    >
      {/* Modern architectural deep sky background */}
      <color attach="background" args={["#0f172a"]} />

      {/* Sun directional light simulating Indian sunlight (from South-South-West) */}
      <directionalLight
        position={[center.x - distance * 0.8, center.y + distance * 1.8, center.z - distance * 0.6]}
        intensity={2.4}
        color="#fffbeb"
      />
      {/* Skylight ambient fill */}
      <ambientLight intensity={1.4} color="#e0f2fe" />
      {/* Subtle warm ground bounce */}
      <directionalLight
        position={[center.x + distance, center.y - distance, center.z + distance]}
        intensity={0.4}
        color="#fed7aa"
      />

      {/* Landscaping / courtyard ground disc */}
      <mesh position={[center.x, groundY, center.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[groundRadius, 48]} />
        <meshStandardMaterial color="#1e293b" roughness={0.95} metalness={0.02} />
      </mesh>

      {/* Ground compass grid and coordinate guides */}
      <gridHelper
        args={[groundRadius * 2, 24, "#475569", "#334155"]}
        position={[center.x, groundY + 0.01, center.z]}
      />

      {/* Architectural building walls, plinth, and eave fascia underneath the roof */}
      {layout.segments.length > 0 && (
        <BuildingStructure segments={layout.segments} bounds={bounds} />
      )}

      {/* Modeled roof surfaces */}
      {measuredSegments.length > 0 && (
        <RoofDeckBatch shapes={measuredSegments} color="#52605b" border="#cbd5e1" />
      )}
      {symbolicSegments.length > 0 && (
        <RoofDeckBatch shapes={symbolicSegments} color="#475569" border="#94a3b8" />
      )}

      {/* Realistic 3D Solar PV Modules */}
      {layout.panels.length > 0 && (
        <RealisticPanelsBatch panels={layout.panels} />
      )}

      <CameraControls layout={layout} command={command} reducedMotion={reducedMotion} />
    </Canvas>
  );
}
