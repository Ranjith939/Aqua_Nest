/* ==========================================================================
   AQUA NEST - reef3d.js

   The 3D half of the underwater scene:

     - `chaotic_marine_life.glb` becomes the coral seabed running along the
       bottom of the viewport.
     - two fish GLBs, each loaded ONCE and cloned into a mixed shoal across
       three depth layers.

   Models
     "Chaotic marine life" by Kanisto             - CC-BY-NC-4.0 (NonCommercial)
     "Cartoon Clownfish (animated)" by Jungle Jim - CC-BY-4.0
     "Tosakin goldfish" by somitsu               - CC-BY-4.0

   Notes on cost:
   - Each GLB is fetched ONCE. The reef is merged down to one mesh per
     material (792 meshes -> ~20 draw calls), and every reef tile after that
     shares those merged buffers. Every fish after the first is a
     skeleton-aware clone sharing geometry, textures and one AnimationClip.
   - Rendering pauses whenever the tab is hidden.
   - The whole layer opts out on small screens, low-core devices, reduced
     motion, or without WebGL; the CSS/SVG reef and shoal stand in.
   ========================================================================== */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const canvas = document.querySelector("[data-reef-canvas]");
const ocean = document.querySelector(".ocean");

function prefersLite() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { return true; }
  if (window.innerWidth < 900) { return true; }
  if ((navigator.hardwareConcurrency || 8) <= 4) { return true; }
  if (navigator.connection && navigator.connection.saveData) { return true; }
  return false;
}

function hasWebGL() {
  try {
    const probe = document.createElement("canvas");
    return !!(window.WebGLRenderingContext &&
      (probe.getContext("webgl2") || probe.getContext("webgl")));
  } catch (err) {
    return false;
  }
}

/** Water colour the whole scene is graded and fogged towards. */
const WATER = 0x0d6d94;

/**
 * The two fish models, and what each one needs to sit in the same water.
 *
 *   attr       - data-* attribute on the canvas holding the URL
 *   lengthAxis - which local axis the body runs along. The clownfish is
 *                modelled nose-to-tail along X; this one along Z. Nothing
 *                may assume a single convention.
 *   yaw        - extra Y rotation that turns lengthAxis to face -X, which is
 *                the heading the swim code works in
 *   hero       - whether this species also supplies the hero card fish
 */
const SPECIES = {
  clownfish: { attr: "modelFish", lengthAxis: "x", yaw: 0, hero: true },
  // Tosakin goldfish. Nose at +Z - its eye joints sit at z +0.03 while the
  // caudal (tail) joints run to z -0.13 - so the same -PI/2 that mapped the
  // previous Z-axis model onto -X still applies. +PI/2 would swim it
  // tail-first.
  //
  // alphaCutout: the fin texture is a real cutout with alpha 0..255, so the
  // author shipped body and fins as alphaMode BLEND. Left as blending, a
  // doubleSided body is readable through itself - the exact see-through
  // artifact reported before. See applyAlphaPolicy.
  reeffish: {
    attr: "modelFish2", lengthAxis: "z", yaw: -Math.PI / 2,
    hero: false, alphaCutout: true
  }
};

/**
 * One entry per fish, mixed across the two species.
 *   species  - key into SPECIES
 *   z        - depth; more negative is further away
 *   scale    - multiplier on the normalised body length
 *   speed    - world units per second
 *   dir      - 1 swims left-to-right, -1 right-to-left
 *   amp/freq - vertical sine of the swim path
 *   yaw      - how much the nose turns into the climb and dive
 *
 * Layered per the brief: faint background fish, readable midground fish,
 * and larger foreground fish kept low and to the side so they never cross
 * the panels' text.
 *
 * SPACING RULE: fish swim through each other's space as they pass, so no
 * two may share a lane. Every pair needs EITHER >=4 units of depth between
 * them, OR a height gap wide enough to clear both sine amplitudes plus two
 * body depths (~6.5 units). Two fish 2 apart in z and 1.7 in y - which is
 * what this list used to hold - visibly intersect.
 */
const FISH = [
  /* background */
  { species: "clownfish", z: -38, y: 7.0, scale: 0.5, speed: 0.7, dir: 1, amp: 1.3, freq: 0.15, phase: 0.0, yaw: 0.1 },
  { species: "reeffish", z: -34, y: -6.0, scale: 0.6, speed: 0.8, dir: -1, amp: 1.4, freq: 0.13, phase: 2.2, yaw: 0.11 },
  { species: "clownfish", z: -29, y: 2.5, scale: 0.58, speed: 0.85, dir: -1, amp: 1.6, freq: 0.12, phase: 1.7, yaw: 0.12 },
  { species: "reeffish", z: -25, y: 9.0, scale: 0.54, speed: 0.75, dir: 1, amp: 1.2, freq: 0.16, phase: 4.7, yaw: 0.1 },
  /* midground */
  { species: "reeffish", z: -20, y: -4.5, scale: 0.88, speed: 1.05, dir: 1, amp: 1.7, freq: 0.13, phase: 3.4, yaw: 0.15 },
  { species: "clownfish", z: -16, y: 4.5, scale: 0.82, speed: 1.1, dir: -1, amp: 1.9, freq: 0.14, phase: 0.8, yaw: 0.16 },
  { species: "clownfish", z: -12, y: -2.0, scale: 0.74, speed: 1.0, dir: 1, amp: 1.5, freq: 0.17, phase: 2.4, yaw: 0.14 },
  /* foreground - low and sparse */
  { species: "reeffish", z: -9, y: 6.0, scale: 1.05, speed: 1.35, dir: -1, amp: 1.1, freq: 0.12, phase: 5.5, yaw: 0.12 },
  { species: "clownfish", z: -6, y: -8.5, scale: 1.2, speed: 1.55, dir: 1, amp: 1.0, freq: 0.11, phase: 4.2, yaw: 0.1 }
];

/** World length one fish spans at scale 1, whichever species it is. */
const FISH_LENGTH = 5.4;

/**
 * The reef is one diorama repeated into a band along the bottom edge.
 *   count   - tiles in the band
 *   scale   - keeps individual corals small enough to read as distant seabed
 *   z       - depth of the band
 *   topY    - world Y the reef silhouette reaches
 *   overlap - <1 so neighbouring tiles interlock and leave no gaps
 */
const REEF = {
  count: 9,
  scale: 1.55,
  z: -15,
  overlap: 0.78,
  /**
   * How far up the viewport the reef silhouette reaches, as a fraction of
   * the visible height at each tile's own depth.
   *
   * Anchoring to the frustum rather than a fixed world Y matters: a tile
   * pushed further back projects its top *closer to the centre* of the
   * screen, so a shared world Y would make distant tiles look taller.
   */
  heightFraction: 0.15
};

/** Per-tile rotation and depth offsets, so the repeat is not readable. */
const REEF_JITTER = [
  { rotY: 0.0, dz: 0, ds: 1.0 },
  { rotY: 0.72, dz: -2.4, ds: 0.94 },
  { rotY: -0.45, dz: 1.6, ds: 1.06 },
  { rotY: 0.31, dz: -1.2, ds: 0.97 },
  { rotY: -0.86, dz: 2.2, ds: 1.03 },
  { rotY: 0.54, dz: -3.0, ds: 0.92 },
  { rotY: -0.22, dz: 0.8, ds: 1.05 },
  { rotY: 0.63, dz: -1.8, ds: 0.99 },
  { rotY: -0.37, dz: 1.1, ds: 1.02 }
];

function boot() {
  if (prefersLite() || !hasWebGL()) { return; }

  const scene = new THREE.Scene();
  // Fog does the depth work: distance fades everything into the water.
  // Fog is the *only* thing pushing distant fish back now, so the range is
  // tight enough to actually do that work: the foreground fish (~31 units
  // out) stays essentially unfogged and solid, while the far three (~49-58)
  // sit 40-60% blended into the water.
  scene.fog = new THREE.Fog(WATER, 30, 75);

  const camera = new THREE.PerspectiveCamera(
    46, window.innerWidth / window.innerHeight, 0.1, 160
  );
  camera.position.set(0, 0, 24);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      // Anti-aliased, and no longer capped low: this canvas covers the
      // whole viewport, so its internal resolution IS the resolution the
      // fish and reef get sampled at. A DPR cap of 1.5 meant the buffer had
      // fewer physical pixels than its CSS box on any 2x+ display, and the
      // browser had to upscale it to fill that box - a soft, slightly
      // smeared blur on top of whatever the textures themselves look like,
      // most visible on the large foreground fish. The scene already opts
      // out on low-core/mobile/reduced-motion devices via prefersLite(), so
      // the hardware actually running this is desktop-class.
      antialias: true,
      powerPreference: "low-power"
    });
  } catch (err) {
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // Light shaped like the CSS scene: bright cyan from the surface, deep
  // blue bounce from below, plus a soft key from above-front.
  scene.add(new THREE.HemisphereLight(0xd6fbff, 0x0a5878, 3.6));
  scene.add(new THREE.AmbientLight(0x9fe8ff, 0.55));

  const key = new THREE.DirectionalLight(0xf2ffff, 2.6);
  key.position.set(-4, 12, 8);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x7fe4f5, 1.2);
  rim.position.set(6, -4, -6);
  scene.add(rim);

  const mixers = [];
  const swimmers = [];
  const clock = new THREE.Clock();
  const loader = new GLTFLoader();
  const water = new THREE.Color(WATER);
  let running = true;
  let frame = 0;
  let started = false;
  let heroFish = null;

  /** Horizontal half-width of the view at a given depth. */
  function halfWidthAt(z) {
    const distance = camera.position.z - z;
    const halfHeight = Math.tan((camera.fov * Math.PI) / 360) * distance;
    return halfHeight * camera.aspect;
  }

  function placeAtEntry(swimmer) {
    const margin = halfWidthAt(swimmer.z) + swimmer.span;
    swimmer.group.position.x = -swimmer.dir * margin;
  }

  function start() {
    if (started) { return; }
    started = true;
    ocean.classList.add("has-reef3d");
    animate();
  }

  /**
   * Rendered size of a model, measured from geometry bounds times world
   * scale.
   *
   * Box3.setFromObject is wrong for this rig: on a skinned mesh it folds the
   * bind matrices in on top of the node scale, and reports a box 100x too
   * small - which normalised the fish to roughly forty metres of clownfish
   * across the viewport. Geometry bounds x world scale is what actually
   * gets drawn.
   */
  function measureRendered(root) {
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const scale = new THREE.Vector3();
    const piece = new THREE.Box3();

    root.traverse(function (node) {
      if (!node.isMesh || !node.geometry) { return; }
      if (!node.geometry.boundingBox) { node.geometry.computeBoundingBox(); }
      node.getWorldScale(scale);
      piece.copy(node.geometry.boundingBox);
      piece.min.multiply(scale);
      piece.max.multiply(scale);
      box.union(piece);
    });

    return box;
  }

  /* ----------------------------------------------------------------------
     Reef: the coral seabed
     ---------------------------------------------------------------------- */

  /**
   * Pulls the diorama's saturated palette into the dashboard's water so the
   * reef reads as atmosphere rather than a cartoon pasted on the page.
   * Materials are shared between meshes, so each one is graded once.
   */
  function gradeReefMaterial(material) {
    if (material.userData.aquaGraded) { return material; }
    material.userData.aquaGraded = true;

    const hsl = { h: 0, s: 0, l: 0 };
    material.color.getHSL(hsl);

    if (hsl.l < 0.16) {
      // The rock is very nearly black; lift it so it reads as stone in water.
      material.color.setHSL(hsl.h, Math.min(hsl.s, 0.3), 0.26);
    } else if (hsl.s > 0.55) {
      // Pure reds and magentas out of the diorama shout over the dashboard.
      // Capping saturation keeps the coral variety without the neon.
      material.color.setHSL(hsl.h, 0.48, Math.min(0.62, hsl.l + 0.05));
    }

    material.color.lerp(water, 0.2);
    material.roughness = 0.9;
    material.metalness = 0;
    // Kelp blades are flat planes - they must show from both sides.
    material.side = THREE.DoubleSide;
    return material;
  }

  /**
   * Flattens the 792-mesh diorama into one mesh per material.
   * Returns a Group whose geometry is shared by every tile that clones it.
   */
  function buildReefTile(root) {
    root.updateWorldMatrix(true, true);

    const groups = new Map();

    root.traverse(function (node) {
      if (!node.isMesh || !node.geometry) { return; }

      // The export includes a big translucent "Acqua" box around the scene.
      // Left in, it draws hard rectangular edges across the background.
      const chain = [
        node.name,
        node.parent ? node.parent.name : "",
        node.parent && node.parent.parent ? node.parent.parent.name : ""
      ].join(" ");
      if (/acqua/i.test(chain)) { return; }

      // Non-indexed with a uniform attribute set, so every geometry in a
      // group is mergeable.
      const geometry = node.geometry.index
        ? node.geometry.toNonIndexed()
        : node.geometry.clone();

      Object.keys(geometry.attributes).forEach(function (name) {
        if (name !== "position" && name !== "normal") {
          geometry.deleteAttribute(name);
        }
      });
      geometry.morphAttributes = {};
      if (!geometry.attributes.normal) { geometry.computeVertexNormals(); }
      geometry.applyMatrix4(node.matrixWorld);

      const material = Array.isArray(node.material) ? node.material[0] : node.material;
      const id = material.uuid;
      if (!groups.has(id)) { groups.set(id, { material: material, list: [] }); }
      groups.get(id).list.push(geometry);
    });

    const tile = new THREE.Group();

    groups.forEach(function (entry) {
      const merged = entry.list.length === 1
        ? entry.list[0]
        : mergeGeometries(entry.list, false);

      if (!merged) {
        // Incompatible set: keep them separate rather than losing the piece.
        entry.list.forEach(function (geometry) {
          tile.add(new THREE.Mesh(geometry, gradeReefMaterial(entry.material)));
        });
        return;
      }

      if (entry.list.length > 1) {
        entry.list.forEach(function (geometry) { geometry.dispose(); });
      }
      merged.computeBoundingSphere();
      tile.add(new THREE.Mesh(merged, gradeReefMaterial(entry.material)));
    });

    return tile;
  }

  loader.load(
    canvas.dataset.modelReef,
    function (gltf) {
      const tile = buildReefTile(gltf.scene);

      const box = new THREE.Box3().setFromObject(tile);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // Re-centre once so every tile can be positioned by its own centre.
      tile.children.forEach(function (mesh) {
        mesh.geometry.translate(-center.x, -center.y, -center.z);
        mesh.geometry.computeBoundingSphere();
      });

      const step = size.x * REEF.scale * REEF.overlap;

      for (let index = 0; index < REEF.count; index += 1) {
        // Tile 0 is the built group; the rest clone it, sharing geometry.
        const piece = index === 0 ? tile : tile.clone();
        const jitter = REEF_JITTER[index % REEF_JITTER.length];
        const scale = REEF.scale * jitter.ds;

        const z = REEF.z + jitter.dz;
        // Visible half-height at this tile's depth, so every tile in the
        // band breaks the same distance above the bottom edge.
        const halfHeight =
          Math.tan((camera.fov * Math.PI) / 360) * (camera.position.z - z);
        const topY = halfHeight * (REEF.heightFraction * 2 - 1);

        piece.scale.setScalar(scale);
        piece.rotation.y = jitter.rotY;
        piece.position.set(
          (index - (REEF.count - 1) / 2) * step,
          topY - (size.y / 2) * scale,
          z
        );
        scene.add(piece);
      }

      start();
    },
    undefined,
    function () {
      // Reef missing: the CSS reef stays visible, herring may still load.
    }
  );

  /* ----------------------------------------------------------------------
     Hero fish

     A small second view of the same clownfish, framed inside the orb in the
     greeting card. It needs its own renderer because the background canvas
     sits *behind* the glass panels - anything drawn there would be blurred
     and dimmed by the hero's own backdrop-filter. The GLB is not fetched
     again: this reuses the already-parsed scene.
     ---------------------------------------------------------------------- */

  function bootHeroFish(source, clip) {
    const heroCanvas = document.querySelector("[data-hero-fish]");
    if (!heroCanvas) { return; }

    const size = heroCanvas.clientWidth || 168;
    let heroRenderer;
    try {
      heroRenderer = new THREE.WebGLRenderer({
        canvas: heroCanvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power"
      });
    } catch (err) {
      return;
    }

    // The hero fish is a close-up in a small 168px canvas, where blur reads
    // as "low quality" far more than it would on a distant background fish.
    // Rendering at a higher internal resolution than the CSS size - and
    // letting the browser downscale it - is cheap supersampling: it sharpens
    // edges and quiets shimmer on the fin detail. 3x is a real devicePixelRatio
    // on some laptops/phones, so this is not exotic, just uncapped further
    // since the canvas itself is tiny and the layer already opts out on the
    // low-power devices that would feel this.
    const heroPixelRatio = Math.min((window.devicePixelRatio || 1) * 1.5, 3);
    heroRenderer.setPixelRatio(heroPixelRatio);
    heroRenderer.setSize(size, size, false);
    heroRenderer.outputColorSpace = THREE.SRGBColorSpace;

    const heroScene = new THREE.Scene();
    heroScene.add(new THREE.HemisphereLight(0xe4fdff, 0x11607f, 3.2));
    heroScene.add(new THREE.AmbientLight(0xffffff, 0.7));

    const heroKey = new THREE.DirectionalLight(0xffffff, 2.4);
    heroKey.position.set(-3, 5, 6);
    heroScene.add(heroKey);

    const heroRim = new THREE.DirectionalLight(0x8ee9ff, 1.1);
    heroRim.position.set(4, -2, -4);
    heroScene.add(heroRim);

    const model = cloneSkinned(source);

    // Size from the geometry, which is reliable for *extent*.
    const span = measureRendered(model).getSize(new THREE.Vector3());
    // Sized to sit inside the orb rather than break its edge.
    const fit = 2.85 / (span.x || 1);
    model.scale.setScalar(fit);

    // Three-quarter view: nose toward the reader, not a flat side-on cutout.
    // No roll - the fish has to read level inside the bubble.
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.rotation.set(0, -0.55, 0);
    heroScene.add(pivot);

    // Centre on where the rig actually IS.
    //
    // A skinned mesh is placed by its bones, not by mesh.matrixWorld, so a
    // geometry-space centre ignores the armature's own offset - which is what
    // left the fish sitting high and right of the orb. Bone world positions
    // follow the real pose, so their midpoint is the body's true centre.
    model.updateMatrixWorld(true);
    const rig = new THREE.Box3();
    const joint = new THREE.Vector3();
    let bones = 0;

    model.traverse(function (node) {
      if (node.isBone) {
        rig.expandByPoint(node.getWorldPosition(joint));
        bones += 1;
      }
    });

    if (bones > 1) {
      const middle = rig.getCenter(new THREE.Vector3());
      // getWorldPosition is in scene space; the pivot sits at the origin, so
      // subtracting here lands the body centre on the pivot.
      model.position.sub(middle);
    }

    const heroCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    heroCamera.position.set(0, 0.12, 6.4);
    heroCamera.lookAt(0, 0, 0);

    let heroMixer = null;
    let heroAction = null;
    if (clip) {
      heroMixer = new THREE.AnimationMixer(model);
      heroAction = heroMixer.clipAction(clip);
      heroAction.play();
    }

    heroFish = {
      renderer: heroRenderer,
      scene: heroScene,
      camera: heroCamera,
      mixer: heroMixer,
      action: heroAction,
      pivot: pivot,
      canvas: heroCanvas
    };

    document.body.classList.add("has-hero-fish");
  }

  /* ----------------------------------------------------------------------
     Fish: one GLB, cloned across the depth layers
     ---------------------------------------------------------------------- */

  /**
   * Alpha handling for a model whose fins are a real texture cutout.
   *
   * Blend, do not cut. The fin texture's alpha fades out along each ray, so
   * ANY hard threshold carves the gaps between rays into a sawtooth - which
   * is what made the fins look torn and shed loose fragments.
   *
   * The two things that keep blending safe here:
   *   - depthWrite stays on, so the near side of the fish still occludes its
   *     own far side. That is what prevents the see-through body.
   *   - a hair of alphaTest discards only the fully-clear texels, so empty
   *     fin canvas cannot write depth and punch holes in what is behind.
   *
   * Only touches materials carrying a base colour texture. The goldfish also
   * has a cornea authored as BLEND with a 0.25 alpha factor and no texture -
   * a genuinely glassy layer over the iris, left exactly as authored.
   */
  function applyAlphaPolicy(material) {
    if (!material.map) { return; }
    material.transparent = true;
    material.alphaTest = 0.02;
    material.depthWrite = true;
    material.needsUpdate = true;
  }

  /**
   * Builds every fish of one species from its loaded GLB.
   *
   * Each model is fetched once; each fish is a skeleton-aware clone sharing
   * that geometry, textures and AnimationClip.
   */
  function buildSpecies(name, species, gltf) {
    const source = gltf.scene;

    // Anisotropic filtering. The GLBs' own samplers only ask for trilinear
    // filtering, which blurs badly on the fins and tail - any surface seen
    // at a shallow angle to the camera - because mipmapping alone has to
    // pick one blur level for a texel stretched long and thin on screen.
    // Set once on the shared textures, so it covers every clone.
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const seenTextures = new Set();

    source.traverse(function (node) {
      if (!node.isMesh) { return; }
      node.castShadow = false;
      node.receiveShadow = false;
      // Skinned bounds go stale as the rig animates; culling on them makes
      // fish pop out of view mid-screen.
      node.frustumCulled = false;

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(function (material) {
        if (!material) { return; }
        if (species.alphaCutout) { applyAlphaPolicy(material); }
        ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"].forEach(function (slot) {
          const tex = material[slot];
          if (tex && !seenTextures.has(tex)) {
            tex.anisotropy = maxAniso;
            seenTextures.add(tex);
          }
        });
      });
    });

    const clip = gltf.animations && gltf.animations[0];

    // Normalise so the world numbers in FISH mean the same thing for both
    // models, whatever scale and axis each was exported along.
    const box = measureRendered(source);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const bodyLength = size[species.lengthAxis] || size.x || 1;
    const normalize = FISH_LENGTH / bodyLength;

    FISH.forEach(function (spec, index) {
      if (spec.species !== name) { return; }

      // Every fish is a clone, including the first: `source` has to stay a
      // pristine template. Reusing it for fish 0 meant its transform got
      // scaled in place, and anything that measured it afterwards (the
      // hero fish) sized itself against an already-scaled model.
      const model = cloneSkinned(source);
      const scale = normalize * spec.scale;

      model.scale.setScalar(scale);
      model.position.set(
        -center.x * scale,
        -center.y * scale,
        -center.z * scale
      );

      // Heading on its own wrapper so it cannot fight the centring.
      // species.yaw first turns the body onto the X axis, then the
      // direction flip aims it up- or down-stream.
      const heading = new THREE.Group();
      heading.add(model);
      heading.rotation.y = species.yaw + (spec.dir === 1 ? Math.PI : 0);

      const fish = new THREE.Group();
      fish.add(heading);
      fish.position.set(0, spec.y, spec.z);

      // No per-fish material work: both GLB materials are authored opaque
      // (no alphaMode, no alpha channel in their textures) and every fish of
      // a species shares one, which also keeps the draw calls batched.
      //
      // There used to be a per-fish `opacity` here as a "depth fade". That
      // was the wrong tool: material opacity makes the geometry itself
      // see-through, and because these meshes are doubleSided you could read
      // the far-side fins straight through the near-side body. Distance is
      // handled by fog instead - see scene.fog - which blends toward the
      // water colour without making anything translucent.
      scene.add(fish);

      let action = null;
      if (clip) {
        const mixer = new THREE.AnimationMixer(model);
        action = mixer.clipAction(clip);
        // Slightly different tail rhythm per fish, so they never sync up.
        action.timeScale = 0.8 + index * 0.07;
        action.play();
        mixers.push(mixer);
      }

      const swimmer = {
        group: fish,
        heading: heading,
        action: action,
        baseBeat: 0.8 + index * 0.07,
        headingYaw: species.yaw,
        z: spec.z,
        dir: spec.dir,
        speed: spec.speed,
        baseY: spec.y,
        amp: spec.amp,
        freq: spec.freq,
        phase: spec.phase,
        yaw: spec.yaw,
        span: Math.max(bodyLength * scale, 4),
        lastY: spec.y
      };

      placeAtEntry(swimmer);
      // Stagger entry so they do not arrive in a line.
      swimmer.group.position.x += spec.dir * index * 15;
      swimmers.push(swimmer);
    });

    if (species.hero) { bootHeroFish(source, clip); }
  }

  /* ----------------------------------------------------------------------
     Fish: two GLBs, each loaded once and cloned across the depth layers
     ---------------------------------------------------------------------- */

  Object.keys(SPECIES).forEach(function (name) {
    const species = SPECIES[name];
    const url = canvas.dataset[species.attr];
    if (!url) { return; }

    loader.load(
      url,
      function (gltf) {
        buildSpecies(name, species, gltf);
        // Either species is enough to start the scene; whichever arrives
        // second just adds its fish to a loop already running.
        start();
      },
      undefined,
      function () {
        // One species missing is survivable - the other still swims. Only
        // hide the canvas if nothing at all came through.
        if (!started) { canvas.style.display = "none"; }
      }
    );
  });

  /**
   * Idle motion for the hero fish.
   *
   * The previous version was one fixed sine per axis, which loops visibly and
   * - because the axes were independent - looked like a model being nudged
   * rather than a fish holding station. Three things fix that:
   *
   *   1. Each axis is a sum of two sines whose rates share no common
   *      multiple, so the pattern does not visibly repeat.
   *   2. Roll and pitch are DERIVED from how fast the fish is turning and
   *      rising, not driven independently. Banking into its own turn is the
   *      cue that reads as a live animal.
   *   3. A periodic flick - sharp attack, quick decay - with the tail beat
   *      speeding up to match. A hovering fish makes constant small
   *      corrections; perfectly smooth drift is what looks dead.
   */
  const HERO_BASE_YAW = -0.55;
  const HERO_DART_PERIOD = 7.3;

  function animateHeroFish(t) {
    const pivot = heroFish.pivot;

    // Sharp flick, then settle. Peaks just after each period rolls over.
    const dartPhase = (t % HERO_DART_PERIOD) / HERO_DART_PERIOD;
    const dart = Math.exp(-dartPhase * 16) * Math.sin(dartPhase * 46);

    // Turning: a slow look-around plus a faster small correction.
    const yaw = 0.17 * Math.sin(t * 0.29) + 0.06 * Math.sin(t * 0.77 + 2.2);
    const yawRate = 0.17 * 0.29 * Math.cos(t * 0.29) +
                    0.06 * 0.77 * Math.cos(t * 0.77 + 2.2);

    // Hovering: two vertical rates, so it never settles into a bounce.
    const bob = 0.065 * Math.sin(t * 0.63) + 0.028 * Math.sin(t * 1.19 + 1.7);
    const bobRate = 0.065 * 0.63 * Math.cos(t * 0.63) +
                    0.028 * 1.19 * Math.cos(t * 1.19 + 1.7);

    pivot.position.set(
      0.14 * Math.sin(t * 0.23 + 0.6) + dart * 0.1,
      bob,
      0.07 * Math.sin(t * 0.19 + 3.1)
    );

    pivot.rotation.y = HERO_BASE_YAW + yaw + dart * 0.18;
    // Bank into the turn, nose into the climb.
    pivot.rotation.z = THREE.MathUtils.clamp(-yawRate * 0.85, -0.2, 0.2);
    pivot.rotation.x = THREE.MathUtils.clamp(bobRate * 1.2, -0.14, 0.14);

    // Tail beats faster through a flick and drifts slowly the rest of the
    // time, rather than ticking at one fixed rate.
    if (heroFish.action) {
      heroFish.action.timeScale =
        0.85 + 0.22 * Math.sin(t * 0.41) + Math.abs(dart) * 1.4;
    }
  }

  /* ----------------------------------------------------------------------
     Loop
     ---------------------------------------------------------------------- */

  function animate() {
    if (!running) { return; }
    frame = requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;

    for (let i = 0; i < mixers.length; i += 1) {
      mixers[i].update(delta);
    }

    for (let i = 0; i < swimmers.length; i += 1) {
      const swimmer = swimmers[i];
      swimmer.group.position.x += swimmer.dir * swimmer.speed * delta;

      // Curved path: a slow sine through the water rather than a straight
      // line. The nose then pitches into whichever way the fish is heading,
      // which is what stops the motion reading as a sliding sprite.
      const y = swimmer.baseY +
        Math.sin(elapsed * swimmer.freq * Math.PI + swimmer.phase) * swimmer.amp;
      const climb = (y - swimmer.lastY) / Math.max(delta, 0.0001);

      swimmer.group.position.y = y;
      // Pitch and bank both go on the outer group, which is the frame where
      // every fish already has its body aligned to X. Putting the bank on
      // the heading group instead would rotate it about the model's own
      // pre-alignment axis - fine for a body modelled along X, but the wrong
      // axis entirely for one modelled along Z.
      swimmer.group.rotation.z =
        THREE.MathUtils.clamp(climb * 0.09, -0.26, 0.26) * swimmer.dir;
      swimmer.group.rotation.x =
        THREE.MathUtils.clamp(-climb * swimmer.yaw, -0.2, 0.2);
      swimmer.lastY = y;

      // A fixed tail rate is the tell that this is a looping clip. Easing it
      // up and down - each fish on its own phase - reads as a fish actually
      // working against the water.
      if (swimmer.action) {
        swimmer.action.timeScale =
          swimmer.baseBeat * (1 + 0.2 * Math.sin(elapsed * 0.47 + swimmer.phase));
      }

      // Slight wander off a dead-straight heading.
      swimmer.heading.rotation.y = swimmer.headingYaw +
        (swimmer.dir === 1 ? Math.PI : 0) +
        0.07 * Math.sin(elapsed * 0.31 + swimmer.phase);

      const margin = halfWidthAt(swimmer.z) + swimmer.span;
      if (swimmer.dir === 1 && swimmer.group.position.x > margin) {
        placeAtEntry(swimmer);
      } else if (swimmer.dir === -1 && swimmer.group.position.x < -margin) {
        placeAtEntry(swimmer);
      }
    }

    renderer.render(scene, camera);

    if (heroFish) {
      if (heroFish.mixer) { heroFish.mixer.update(delta); }
      animateHeroFish(elapsed);

      const box = heroFish.canvas.clientWidth;
      if (box && box !== heroFish.lastSize) {
        heroFish.renderer.setSize(box, box, false);
        heroFish.lastSize = box;
      }
      heroFish.renderer.render(heroFish.scene, heroFish.camera);
    }
  }

  /* Resize ---------------------------------------------------------------- */

  let resizeTimer = null;
  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }, 180);
  });

  /* A hidden tab renders nothing at all. ---------------------------------- */

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      running = false;
      cancelAnimationFrame(frame);
    } else if (!running && started) {
      running = true;
      clock.getDelta();
      animate();
    }
  });
}

if (canvas && ocean) {
  boot();
}
