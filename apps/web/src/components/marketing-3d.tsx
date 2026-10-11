"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";

const HouseScene = dynamic(() => import("./marketing-scenes").then(m => m.HouseScene), { ssr: false });
const PanelScene = dynamic(() => import("./marketing-scenes").then(m => m.PanelScene), { ssr: false });

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch { return false; }
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Fallback({ label }: { label: string }) {
  return (
    <p role="status" className="flex size-full items-center justify-center p-6 text-center font-mono text-xs text-[#444]">
      {label}
    </p>
  );
}

function Stage({ scene, label, unavailable }: { scene: "house" | "panel"; label: string; unavailable: string }) {
  const [webgl, setWebgl] = useState<boolean | undefined>();
  useEffect(() => setWebgl(supportsWebGl()), []);
  if (webgl === undefined) return <Fallback label="Loading 3D model…" />;
  if (!webgl) return <Fallback label={unavailable} />;
  return (
    <div role="group" aria-label={label} className="size-full">
      <SceneBoundary fallback={<Fallback label={unavailable} />}>
        {scene === "house" ? <HouseScene /> : <PanelScene />}
      </SceneBoundary>
    </div>
  );
}

export function HeroHouse() {
  return (
    <figure className="m-0">
      <div className="aspect-[5/4] w-full">
        <Stage
          scene="house"
          label="Interactive 3D model of a house with a rooftop solar array. Drag to rotate."
          unavailable="3D view unavailable on this device."
        />
      </div>
      <figcaption className="mt-2 font-mono text-xs text-[#444]">
        Illustrative concept, not a property assessment. Drag to rotate.
      </figcaption>
    </figure>
  );
}

export function PanelModel() {
  return (
    <figure className="m-0">
      <div className="aspect-square w-full">
        <Stage
          scene="panel"
          label="Interactive 3D model of a solar panel showing frame, glass, cells and back sheet layers."
          unavailable="3D view unavailable on this device."
        />
      </div>
      <figcaption className="mt-2 font-mono text-xs text-[#979797]">
        Generic panel construction for illustration. Not a product recommendation.
      </figcaption>
    </figure>
  );
}
