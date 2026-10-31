import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ControllerOutline } from "./controllerOutline";

function fixture() {
  const scene = new THREE.Scene();
  const model = new THREE.Group();
  const meshes = Array.from(
    { length: 3 },
    () =>
      new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
  );
  meshes[0].userData.binding = meshes[1].userData.binding = "LeftThumb";
  meshes[2].userData.outline = false;
  model.add(...meshes);
  scene.add(model);
  scene.background = new THREE.Color(0x1c1c1c);
  const outline = new ControllerOutline(model);
  const target = new THREE.WebGLRenderTarget();
  let currentTarget: THREE.WebGLRenderTarget | null = target;
  const renderer = {
    getRenderTarget: () => currentTarget,
    setRenderTarget: (value: THREE.WebGLRenderTarget | null) => {
      currentTarget = value;
    },
    render: vi.fn(),
  };
  return { scene, meshes, outline, target, renderer };
}

describe("controller contour rendering", () => {
  it.each([1, 2])(
    "preserves grouped controls and scene state at %i× pixel ratio",
    (pixelRatio) => {
      const { scene, meshes, outline, target, renderer } = fixture();
      const materials = meshes.map((mesh) => mesh.material);
      const background = scene.background;
      const passes: THREE.WebGLRenderTarget[] = [];
      meshes[1].visible = false;
      renderer.render.mockImplementationOnce(() => {
        passes.push(renderer.getRenderTarget()!);
      });
      renderer.render.mockImplementationOnce(() => {
        passes.push(renderer.getRenderTarget()!);
        expect(meshes[0].material.color.equals(meshes[1].material.color)).toBe(
          true,
        );
        expect(meshes[1].visible).toBe(false);
        expect(meshes[2].visible).toBe(false);
      });
      outline.setSize(400, 300, pixelRatio);
      outline.render(
        renderer as unknown as THREE.WebGLRenderer,
        scene,
        new THREE.Camera(),
      );
      expect(passes.map(({ width, height }) => [width, height])).toEqual([
        [800, 600],
        [800, 600],
      ]);
      expect(meshes.map((mesh) => mesh.material)).toEqual(materials);
      expect(meshes.map((mesh) => mesh.visible)).toEqual([true, false, true]);
      expect(scene.background).toBe(background);
      expect(renderer.getRenderTarget()).toBe(target);
      outline.dispose();
    },
  );

  it("restores the scene and render target if an offscreen render fails", () => {
    const { scene, meshes, outline, target, renderer } = fixture();
    const materials = meshes.map((mesh) => mesh.material);
    const background = scene.background;
    renderer.render.mockImplementationOnce(() => {});
    renderer.render.mockImplementationOnce(() => {
      throw new Error("render interrupted");
    });
    expect(() =>
      outline.render(
        renderer as unknown as THREE.WebGLRenderer,
        scene,
        new THREE.Camera(),
      ),
    ).toThrow("render interrupted");
    expect(meshes.map((mesh) => mesh.material)).toEqual(materials);
    expect(meshes.every((mesh) => mesh.visible)).toBe(true);
    expect(scene.background).toBe(background);
    expect(renderer.getRenderTarget()).toBe(target);
    outline.dispose();
  });
});
