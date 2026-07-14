---
name: R3F line rendering & resource disposal
description: How to render lines in React Three Fiber without leaking GPU objects, and the <line> TS typing conflict.
---

# R3F line rendering & resource disposal

**Rule:** Never construct `THREE.Line`/`THREE.Material`/`THREE.BufferGeometry` inside JSX via
`<primitive object={new THREE.Line(...)} />`. A new GPU object is created on every render
and the old one is never disposed — under polling-driven rerenders this leaks steadily.

**How to apply:** Use declarative intrinsics so R3F owns the lifecycle:
```tsx
<line>
  <bufferGeometry>
    <bufferAttribute attach="attributes-position" args={[positionsFloat32, 3]} />
  </bufferGeometry>
  <lineBasicMaterial ... />
</line>
```
Build the `Float32Array` in `useMemo`. R3F auto-disposes geometry/material attached this way.
If you keep a ref to imperative resources, dispose them in a `useEffect` cleanup.

**TS gotcha:** the JSX intrinsic `<line>` collides with the DOM/SVG `line` element typing in
this repo's setup, surfacing as a type error. Suppress with a single
`{/* @ts-expect-error R3F intrinsic <line> conflicts with SVG line typing */}` directly above
the `<line>` tag. `<bufferAttribute>` args are `[array, itemSize]`.

**Why:** A leak here was the one blocking finding in the Mission Control 3D HQ review — the scene
polls real backend data every 15s, so every poll-triggered rerender of inline `new THREE.Line`
accumulated GPU objects over a long session.
