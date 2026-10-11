import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import type { Group, Mesh } from 'three';

function AuthorityVolume({ blocked, stage, tight, chapter, colors }: { blocked: boolean; stage: number; tight: boolean; chapter:number; colors: { ink: string; white: string; accent: string } }) {
  const packet = useRef<Mesh>(null); const boundary = useRef<Group>(null); const { invalidate } = useThree();
  const target = blocked ? (stage === 0 ? -1.8 : -0.25) : -1.8 + stage * 0.58;
  useEffect(() => { invalidate(); }, [target, tight, invalidate]);
  useFrame((_state, delta) => {
    if (!packet.current || !boundary.current) return;
    const blend = 1 - Math.exp(-8 * Math.min(delta, 0.05));
    packet.current.position.x += (target - packet.current.position.x) * blend;
    boundary.current.scale.y += ((tight ? 0.8 : 1.15) - boundary.current.scale.y) * blend;
    if (Math.abs(packet.current.position.x - target) > .002 || Math.abs(boundary.current.scale.y - (tight ? .8 : 1.15)) > .002) invalidate();
  });
  return <group rotation={[0.25,-0.34,0]}>
    {/* The rectangular plate is the agent identity; the enclosing wire volume is scope. */}
    <mesh position={[-1.8,0,0]}><boxGeometry args={[.38,.6,.16]} /><meshStandardMaterial color={colors.ink} roughness={.5} metalness={.6} /></mesh>
    <mesh position={[-1.8,0,.1]}><boxGeometry args={[.28,.36,.02]} /><meshBasicMaterial color={colors.white} wireframe /></mesh>
    <group ref={boundary} position={[-1.2,0,0]}><mesh><boxGeometry args={[2.1,1.7,1.2]} /><meshBasicMaterial color={colors.accent} wireframe transparent opacity={chapter>=1?.55:.16} /></mesh></group>
    {/* A constrained aperture, not an arbitrary decorative orbit. */}
    <mesh position={[0,0,0]}><boxGeometry args={[.04,1.45,.95]} /><meshBasicMaterial color={colors.accent} wireframe /></mesh>
    <mesh position={[1.1,-.57,0]}><boxGeometry args={[2.6,.012,.012]} /><meshBasicMaterial color={colors.white} transparent opacity={.18} /></mesh>
    <mesh ref={packet} position={[-1.8,-.57,0]}><boxGeometry args={[.1,.1,.1]} /><meshBasicMaterial color={colors.white} /></mesh>
    {[.65,1.25,1.85].map((x) => <mesh key={x} position={[x,0,0]}><boxGeometry args={[.24,.7,.14]} /><meshBasicMaterial color={colors.white} wireframe transparent opacity={chapter>=3?.45:.12} /></mesh>)}
  </group>;
}
export function VisualStage({ blocked = false, stage = 0, tight = true, chapter = 0 }: { blocked?: boolean; stage?: number; tight?: boolean; chapter?:number }) {
  const [colors, setColors] = useState({ ink: '#000000', white: '#FFFFFF', accent: '#FFFFFF' });
  useEffect(() => { const style = getComputedStyle(document.documentElement); setColors({ ink: style.getPropertyValue('--surface-2').trim() || '#000000', white: style.getPropertyValue('--text-primary').trim() || '#FFFFFF', accent: style.getPropertyValue('--accent-highlight').trim() || '#FFFFFF' }); }, []);
  return <div className="authority-webgl" aria-hidden="true"><Canvas frameloop="demand" dpr={[1,1.25]} camera={{ position:[0,1,6], fov:42 }} gl={{ alpha:true, antialias:true }}>
    <ambientLight intensity={.8} /><directionalLight position={[2,3,4]} intensity={1.1} />
    <AuthorityVolume blocked={blocked} stage={stage} tight={tight} chapter={chapter} colors={colors} />
  </Canvas></div>;
}
