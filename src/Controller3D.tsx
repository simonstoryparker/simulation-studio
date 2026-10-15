import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const background = 0x172131;
const ink = 0x8da8bc;
type Part = {
  shape: THREE.Shape;
  id?: string;
  name?: string;
  label?: string;
  x?: number;
  y?: number;
  outline?: boolean;
  depth?: number;
  z?: number;
};
function polygon(points: number[][]) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  return shape;
}
function circle(x: number, y: number, radius: number) {
  const shape = new THREE.Shape();
  shape.absarc(x, y, radius, 0, Math.PI * 2, false);
  return shape;
}
const shell = new THREE.Shape();
shell.moveTo(-1.82, 1.24);
shell.bezierCurveTo(-1.48, 1.39, -1.1, 1.36, -0.8, 1.2);
shell.lineTo(0.8, 1.2);
shell.bezierCurveTo(1.1, 1.36, 1.48, 1.39, 1.82, 1.24);
shell.bezierCurveTo(2.18, 1.12, 2.35, 0.58, 2.5, 0.05);
shell.bezierCurveTo(2.69, -0.6, 2.9, -1.53, 2.58, -1.72);
shell.bezierCurveTo(2.25, -1.98, 1.7, -1.37, 1.15, -1.01);
shell.bezierCurveTo(0.88, -0.82, 0.65, -0.83, 0, -0.83);
shell.bezierCurveTo(-0.65, -0.83, -0.88, -0.82, -1.15, -1.01);
shell.bezierCurveTo(-1.7, -1.37, -2.25, -1.98, -2.58, -1.72);
shell.bezierCurveTo(-2.9, -1.53, -2.69, -0.6, -2.5, 0.05);
shell.bezierCurveTo(-2.35, 0.58, -2.18, 1.12, -1.82, 1.24);
shell.closePath();
const parts: Part[] = [];
for (const side of [-1, 1]) {
  const left = side === -1;
  const reflect = (points: number[][]) =>
    polygon(points.map(([x, y]) => [x * side, y]));
  parts.push({
    shape: reflect([
      [0.96, 1.29],
      [1.13, 1.62],
      [1.56, 1.66],
      [1.95, 1.48],
      [2.08, 1.14],
    ]),
    id: left ? "LeftZ:positive" : "RightZ:positive",
    name: left ? "Left trigger" : "Right trigger",
    depth: 0.68,
    z: -0.58,
  });
  parts.push({
    shape: reflect([
      [0.85, 1.17],
      [1.0, 1.34],
      [1.55, 1.42],
      [1.95, 1.24],
      [2.06, 1.06],
      [1.55, 1.22],
    ]),
    id: left ? "LeftTrigger" : "RightTrigger",
    name: left ? "Left bumper" : "Right bumper",
    depth: 0.22,
    z: -0.02,
  });
}
parts.push({ shape: shell, depth: 0.48, z: -0.36 });
for (const [id, label, x, y] of [
  ["South", "A", 1.64, 0.02],
  ["East", "B", 2.02, 0.4],
  ["West", "X", 1.26, 0.4],
  ["North", "Y", 1.64, 0.78],
] as const)
  parts.push({ shape: circle(x, y, 0.18), id, name: label, label, x, y });
parts.push({ shape: circle(-0.39, 0.39, 0.12), id: "Select", name: "View" });
parts.push({ shape: circle(0.39, 0.39, 0.12), id: "Start", name: "Menu" });
parts.push({ shape: circle(0, 0.91, 0.17) });
// Invisible annular sectors allow axis binding without extra arrow buttons.
for (const [prefix, x, y] of [
  ["Left", -1.58, 0.43],
  ["Right", 0.78, -0.48],
] as const) {
  parts.push({ shape: circle(x, y, 0.4) });
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2,
      shape = new THREE.Shape();
    shape.absarc(x, y, 0.39, angle - Math.PI / 4, angle + Math.PI / 4, false);
    shape.absarc(x, y, 0.25, angle + Math.PI / 4, angle - Math.PI / 4, true);
    shape.closePath();
    parts.push({
      shape,
      outline: false,
      id: `${prefix}Stick${i % 2 ? "Y" : "X"}:${i < 2 ? "positive" : "negative"}`,
      name: `${prefix} stick ${["right", "up", "left", "down"][i]}`,
      z: 0.145,
    });
  }
  parts.push({
    shape: circle(x, y, 0.25),
    id: `${prefix}Thumb`,
    name: `${prefix} stick click`,
    z: 0.15,
  });
}
const dx = -0.84,
  dy = -0.48;
for (let i = 0; i < 4; i++) {
  const angle = (-i * Math.PI) / 2;
  parts.push({
    shape: polygon(
      [
        [-0.14, 0],
        [-0.14, 0.37],
        [0.14, 0.37],
        [0.14, 0],
      ].map(([x, y]) => [
        dx + x * Math.cos(angle) - y * Math.sin(angle),
        dy + x * Math.sin(angle) + y * Math.cos(angle),
      ]),
    ),
    id: `DPad:${i}`,
    name: `D-pad ${["up", "right", "down", "left"][i]}`,
    outline: false,
    z: 0.145,
  });
}
const cross = polygon(
  [
    [-0.14, 0.37],
    [0.14, 0.37],
    [0.14, 0.14],
    [0.37, 0.14],
    [0.37, -0.14],
    [0.14, -0.14],
    [0.14, -0.37],
    [-0.14, -0.37],
    [-0.14, -0.14],
    [-0.37, -0.14],
    [-0.37, 0.14],
    [-0.14, 0.14],
  ].map(([x, y]) => [x + dx, y + dy]),
);
type Props = {
  active: string | null;
  view: "front" | "top";
  onSelect: (id: string) => void;
};
export default function Controller3D({ active, view, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null),
    selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const updateRef = useRef<(active: string | null) => void>(() => {});
  const viewRef = useRef<(view: Props["view"]) => void>(() => {});
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFallback(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const canvas = renderer.domElement;
    host.current.appendChild(canvas);
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.minDistance = 7;
    controls.maxDistance = 20;
    const draw = () => renderer.render(scene, camera);
    controls.addEventListener("change", draw);
    const hits: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] =
      [];
    const surfaces: THREE.Object3D[] = [];
    const outline = (shape: THREE.Shape, z: number) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(
        shape.getPoints(48).map((p) => new THREE.Vector3(p.x, p.y, z)),
      );
      scene.add(
        new THREE.LineLoop(
          geometry,
          new THREE.LineBasicMaterial({ color: ink }),
        ),
      );
    };
    for (const part of parts) {
      const z = part.z ?? 0.14;
      const geometry = part.depth
        ? new THREE.ExtrudeGeometry(part.shape, {
            depth: part.depth,
            bevelEnabled: false,
            curveSegments: 48,
          })
        : new THREE.ShapeGeometry(part.shape, 48);
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: background,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
      );
      mesh.position.z = z;
      mesh.userData.binding = part.id;
      mesh.userData.name = part.name;
      scene.add(mesh);
      surfaces.push(mesh);
      if (part.id) hits.push(mesh);
      if (part.outline !== false) {
        outline(part.shape, z + (part.depth ?? 0) + 0.002);
        if (part.depth) outline(part.shape, z - 0.002);
      }
      if (part.label) {
        const labelCanvas = document.createElement("canvas");
        labelCanvas.width = labelCanvas.height = 128;
        const ctx = labelCanvas.getContext("2d")!;
        ctx.fillStyle = "#b6cbd9";
        ctx.font = "500 72px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(part.label, 64, 67);
        const texture = new THREE.CanvasTexture(labelCanvas);
        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(0.23, 0.23),
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
          }),
        );
        label.position.set(part.x!, part.y!, 0.16);
        scene.add(label);
      }
    }
    outline(cross, 0.15);
    let selected: string | null = null,
      hovered: string | null = null;
    const highlight = () => {
      hits.forEach((mesh) =>
        mesh.material.color.setHex(
          mesh.userData.binding === selected
            ? 0x427b80
            : mesh.userData.binding === hovered
              ? 0x365d68
              : background,
        ),
      );
      draw();
    };
    updateRef.current = (value) => {
      selected = value;
      highlight();
    };
    let currentView: Props["view"] = "front";
    const positionCamera = () => {
      const distance = Math.max(
        8.8,
        6.8 / (2 * Math.tan(THREE.MathUtils.degToRad(17)) * camera.aspect),
      );
      camera.up.set(0, 1, 0);
      camera.position.set(
        0,
        currentView === "front" ? 0 : distance * 0.93,
        currentView === "front" ? distance : distance * 0.37,
      );
      controls.target.set(0, -0.05, 0);
      controls.update();
      draw();
    };
    viewRef.current = (value) => {
      currentView = value;
      positionCamera();
    };
    const resize = () => {
      if (!host.current) return;
      const { clientWidth: width, clientHeight: height } = host.current;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      positionCamera();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    const ray = new THREE.Raycaster(),
      point = new THREE.Vector2();
    const pick = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      point.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(point, camera);
      // The opaque shell also participates, preventing picks through the body.
      return ray.intersectObjects(surfaces)[0]?.object;
    };
    let down: { x: number; y: number } | null = null;
    const move = (event: PointerEvent) => {
      const object = event.buttons ? undefined : pick(event);
      hovered = object?.userData.binding ?? null;
      canvas.style.cursor = event.buttons
        ? "grabbing"
        : hovered
          ? "pointer"
          : "grab";
      canvas.title = object?.userData.name ?? "Drag to rotate";
      highlight();
    };
    const leave = () => {
      hovered = null;
      down = null;
      highlight();
    };
    const press = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const release = (event: PointerEvent) => {
      if (
        down &&
        Math.hypot(event.clientX - down.x, event.clientY - down.y) <= 5
      ) {
        const id = pick(event)?.userData.binding;
        if (id) selectRef.current(id);
      }
      down = null;
      move(event);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("pointerdown", press);
    canvas.addEventListener("pointerup", release);
    return () => {
      observer.disconnect();
      controls.dispose();
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("pointerdown", press);
      canvas.removeEventListener("pointerup", release);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => {
            if ("map" in material && material.map instanceof THREE.Texture)
              material.map.dispose();
            material.dispose();
          });
        }
      });
      renderer.dispose();
      canvas.remove();
      updateRef.current = () => {};
      viewRef.current = () => {};
    };
  }, []);
  useEffect(() => updateRef.current(active), [active]);
  useEffect(() => viewRef.current(view), [view]);
  return fallback ? (
    <svg
      className="gamepad-fallback"
      viewBox="-3.4 -2.15 6.8 4.3"
      aria-label="Xbox controller mapping"
    >
      {parts.map((part, index) => (
        <g
          key={part.id ?? index}
          role={part.id ? "button" : undefined}
          tabIndex={part.id ? 0 : undefined}
          aria-label={part.name}
          className={
            part.id
              ? `fallback-control${active === part.id ? " selected" : ""}`
              : undefined
          }
          onClick={() => part.id && onSelect(part.id)}
          onKeyDown={(event) => {
            if (part.id && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onSelect(part.id);
            }
          }}
        >
          <path
            d={svgPath(part.shape)}
            fill="#172131"
            stroke={part.outline === false ? "none" : "#8da8bc"}
            strokeWidth="0.018"
          />
          {part.label && (
            <text x={part.x} y={-part.y! + 0.07}>
              {part.label}
            </text>
          )}
        </g>
      ))}
      <path
        d={svgPath(cross)}
        fill="none"
        stroke="#8da8bc"
        strokeWidth="0.018"
        pointerEvents="none"
      />
    </svg>
  ) : (
    <div
      className="controller-canvas"
      ref={host}
      aria-label="Rotatable Xbox controller. Drag to rotate; select a control to bind a key."
    />
  );
}
function svgPath(shape: THREE.Shape) {
  return (
    shape
      .getPoints(48)
      .map((point, index) => `${index ? "L" : "M"}${point.x},${-point.y}`)
      .join(" ") + " Z"
  );
}
