import * as THREE from "three";

/** Draw contours between visible parts, including smooth and open surfaces. */
export class ControllerOutline {
  private colorTarget = new THREE.WebGLRenderTarget(1, 1);
  private partTarget = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  private compositeTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: false,
  });
  private parts: {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    visible: boolean;
  }[] = [];
  private material = new THREE.ShaderMaterial({
    uniforms: {
      image: { value: this.colorTarget.texture },
      parts: { value: this.partTarget.texture },
      texel: { value: new THREE.Vector2(1, 1) },
      ink: { value: new THREE.Color(0xababab) },
    },
    vertexShader: `
      varying vec2 uvScreen;
      void main() {
        uvScreen = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D image;
      uniform sampler2D parts;
      uniform vec2 texel;
      uniform vec3 ink;
      varying vec2 uvScreen;
      void main() {
        vec3 center = texture2D(parts, uvScreen).rgb;
        float edge = 0.0;
        for (int x = -1; x <= 1; x++) {
          for (int y = -1; y <= 1; y++) {
            vec3 neighbor = texture2D(parts, uvScreen + vec2(x, y) * texel).rgb;
            edge = max(edge, step(0.01, distance(center, neighbor)));
          }
        }
        gl_FragColor = vec4(mix(texture2D(image, uvScreen).rgb, ink, edge), 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private screen = new THREE.Scene();
  private output = new THREE.Scene();
  private outputMaterial = new THREE.MeshBasicMaterial({
    map: this.compositeTarget.texture,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private camera = new THREE.Camera();
  private background = new THREE.Color(0);

  constructor(model: THREE.Object3D) {
    this.screen.add(this.quad);
    this.output.add(new THREE.Mesh(this.quad.geometry, this.outputMaterial));
    const ids = new Map<string, THREE.Color>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const key = object.userData.binding ?? object.uuid;
      if (!ids.has(key)) {
        const id = ids.size + 1;
        // Spread adjacent IDs across channels so small parts remain distinct.
        ids.set(
          key,
          new THREE.Color().setRGB(
            ((id * 73) % 255) / 255,
            ((id * 151) % 255) / 255,
            ((id * 199) % 255) / 255,
          ),
        );
      }
      this.parts.push({
        mesh: object,
        material: new THREE.MeshBasicMaterial({
          color: ids.get(key),
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
        visible: object.userData.outline !== false,
      });
    });
  }

  setSize(width: number, height: number, pixelRatio: number) {
    width = Math.max(width, 1);
    height = Math.max(height, 1);
    // Downsample the completed contours as well as the model. Antialiasing the
    // color pass alone leaves jagged edges in the final screen-space lines.
    const scale = Math.max(2, pixelRatio);
    this.colorTarget.setSize(width * scale, height * scale);
    this.partTarget.setSize(width * scale, height * scale);
    this.compositeTarget.setSize(width * scale, height * scale);
    // The line stays the same visual weight on Retina displays and on resize.
    this.material.uniforms.texel.value.set(0.65 / width, 0.65 / height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const target = renderer.getRenderTarget();
    const background = scene.background;
    const original = this.parts.map(({ mesh }) => ({
      material: mesh.material,
      visible: mesh.visible,
    }));
    try {
      renderer.setRenderTarget(this.colorTarget);
      renderer.render(scene, camera);
      scene.background = this.background;
      for (const { mesh, material, visible } of this.parts) {
        mesh.material = material;
        mesh.visible = mesh.visible && visible;
      }
      renderer.setRenderTarget(this.partTarget);
      renderer.render(scene, camera);
    } finally {
      scene.background = background;
      this.parts.forEach(({ mesh }, i) => {
        mesh.material = original[i].material;
        mesh.visible = original[i].visible;
      });
      renderer.setRenderTarget(target);
    }
    try {
      renderer.setRenderTarget(this.compositeTarget);
      renderer.render(this.screen, this.camera);
      renderer.setRenderTarget(target);
      renderer.render(this.output, this.camera);
    } finally {
      renderer.setRenderTarget(target);
    }
  }

  dispose() {
    this.colorTarget.dispose();
    this.partTarget.dispose();
    this.compositeTarget.dispose();
    this.parts.forEach(({ material }) => material.dispose());
    this.quad.geometry.dispose();
    this.material.dispose();
    this.outputMaterial.dispose();
  }
}
