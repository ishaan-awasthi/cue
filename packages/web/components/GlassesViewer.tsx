"use client";

import { Suspense, useRef, useEffect } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";

function Model() {
  const gltf = useLoader(GLTFLoader, "/bans.glb");
  const ref = useRef<THREE.Group>(null);
  const intro = useRef({ done: false, t: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const box = new THREE.Box3().setFromObject(ref.current);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 4.2 / maxDim;
    ref.current.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    ref.current.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

    ref.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => applyMaterial(m));
        } else {
          applyMaterial(mesh.material);
        }
      }
    });
  }, [gltf]);

  function applyMaterial(m: THREE.Material) {
    if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhongMaterial) {
      m.envMapIntensity = 1.2;
    }
  }

  useFrame((_, delta) => {
    if (!ref.current) return;
    const state = intro.current;

    if (!state.done) {
      state.t = Math.min(1, state.t + delta * 0.8);
      const ease = 1 - Math.pow(1 - state.t, 3);
      ref.current.position.y = -2 + 2 * ease;
      ref.current.rotation.x = Math.PI * 0.5 * (1 - ease) + (0.22 * ease);
      if (state.t >= 1) {
        state.done = true;
      }
    } else {
      ref.current.rotation.x = 0.22;
      ref.current.rotation.y -= delta * 0.25;
    }
  });

  return <primitive ref={ref} object={gltf.scene} />;
}


interface Props {
  ready: boolean;
}

export default function GlassesViewer({ ready }: Props) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      {ready && (
        <Canvas
          camera={{ position: [0, 1.1, 5.5], fov: 45 }}
          gl={{ antialias: true, alpha: true }}
          style={{ width: "100%", height: "100%", background: "transparent" }}
        >
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 8, 5]} intensity={1.2} />
          <directionalLight position={[-5, -2, -5]} intensity={0.4} />
          <pointLight position={[0, 0, 4]} intensity={0.5} color="#2DFFC0" />

          <Suspense fallback={null}>
            <Model />
          </Suspense>

          <OrbitControls
            enablePan={false}
            enableZoom={false}
            minDistance={2}
            maxDistance={10}
            autoRotate={false}
          />
        </Canvas>
      )}
    </div>
  );
}
