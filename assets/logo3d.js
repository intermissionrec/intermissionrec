import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Absolute URL - this module is loaded from a different relative
// depth on each page (./ vs ../), so there's no single relative path
// that would work everywhere.
const MODEL_URL = 'https://intermissionrec.com/assets/models/intermission_logo.glb';

// Loaded once and cached - both the header logo and the transition
// logo need the same model, and this avoids fetching the 252KB file
// twice on every single page load.
let modelPromise = null;
function loadModel() {
  if (!modelPromise) {
    const loader = new GLTFLoader();
    modelPromise = new Promise((resolve, reject) => {
      loader.load(MODEL_URL, (gltf) => resolve(gltf.scene), undefined, reject);
    });
  }
  return modelPromise;
}

// Exposed globally so script.js's entrance-transition timing can wait
// for this before hiding the overlay - otherwise, on a slow
// connection, the overlay could disappear before the model has
// actually appeared in it.
window.__logoModelReady = loadModel();

// The exported mesh isn't centered at its own local origin, so
// rotating it directly would make it visibly wobble/orbit rather than
// spin cleanly in place. Wrapping a fresh clone in a pivot group
// offset by its own bounding-box center fixes this - the pivot is
// what gets rotated, never the model itself.
function createCenteredInstance(sourceScene) {
  const instance = sourceScene.clone(true);

  // Backface culling (Three.js's default) only renders triangles whose
  // normal points toward the camera - if the camera ends up on the
  // side the mesh's winding order treats as "behind," the whole thing
  // would render invisible even with correct positioning. Forcing
  // double-sided materials removes this failure mode entirely.
  instance.traverse((child) => {
    if (child.isMesh && child.material) {
      child.material.side = THREE.DoubleSide;
    }
  });

  const box = new THREE.Box3().setFromObject(instance);
  const center = box.getCenter(new THREE.Vector3());
  instance.position.sub(center);

  const pivot = new THREE.Group();
  pivot.add(instance);

  // Auto-detects the model's own depth (extrusion) and up (rotation)
  // axes from its actual geometry, rather than assuming a fixed
  // convention - the exported model's thinnest bounding-box dimension
  // is almost certainly the extrusion/depth axis for a flat logo (the
  // camera needs to look down this to see the flat face rather than
  // an edge-on sliver), and the middle dimension is the model's own
  // vertical direction (the axis to spin around so the camera sees
  // front, then edge, then back, then edge again as it turns).
  const size = box.getSize(new THREE.Vector3());
  const dims = [
    { axis: 'x', value: size.x },
    { axis: 'y', value: size.y },
    { axis: 'z', value: size.z },
  ].sort((a, b) => a.value - b.value);

  return { pivot, depthAxis: dims[0].axis, upAxis: dims[1].axis };
}

function createScene(canvas) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  return { scene, camera, renderer };
}

// Called once the model's depth axis is known (detected from its
// geometry, since it isn't assumed) - the key light needs to come
// from roughly the same direction as the camera to actually work as
// front-lighting; positioning it before that axis is known would put
// it in the wrong place entirely.
function addLighting(scene, depthAxis) {
  // Front-facing key light - as the logo turns, faces angling away
  // from this fall into shadow, which is what actually sells the
  // depth as it rotates.
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  const lightPos = new THREE.Vector3(0.3, 0.3, 0.3);
  lightPos[depthAxis] = 3;
  keyLight.position.copy(lightPos);
  scene.add(keyLight);

  // Dim ambient fill so the shadowed sides read as dark grey rather
  // than dropping to pure black.
  const fillLight = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(fillLight);
}


function fitCameraToObject(camera, pivot, depthAxis, upAxis) {
  const box = new THREE.Box3().setFromObject(pivot);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  // 1.067 instead of 1.6 - moving the camera closer makes the model
  // appear ~50% larger on screen (apparent size scales inversely with
  // distance for a perspective camera: 1.6 / 1.5 = 1.067).
  const fitDist = ((maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360)) * 1.067;

  const position = new THREE.Vector3();
  position[depthAxis] = fitDist;
  camera.position.copy(position);

  // Negative, not positive - confirmed by direct visual feedback that
  // positive rendered upside down for this model's orientation.
  const up = new THREE.Vector3();
  up[upAxis] = -1;
  camera.up.copy(up);

  camera.lookAt(0, 0, 0);
}

function resizeRendererToCanvas(renderer, camera, canvasEl) {
  const rect = canvasEl.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function easeOutQuad(t) {
  return 1 - Math.pow(1 - t, 2);
}

// --- Header logo: hover-triggered, one-shot 360deg rotation ---
function waitForHeaderReady() {
  if (document.querySelector('.hero-logo-link')) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('header-ready', resolve, { once: true });
  });
}

async function setupHeaderLogo3D() {
  // Desktop-only - some mobile browsers simulate mouseenter/hover on
  // tap for compatibility with desktop-oriented sites, which could
  // trigger this unintentionally when someone just taps the logo to
  // navigate home.
  if (window.matchMedia('(max-width: 919.98px)').matches) return;

  // The header is inserted into the DOM by script.js's async fragment
  // fetch, which runs independently of this module - without waiting
  // here, these queries could easily run before that fetch completes,
  // silently finding nothing and never attaching the hover listener.
  await waitForHeaderReady();

  const link = document.querySelector('.hero-logo-link');
  const canvas = document.querySelector('.hero-logo-canvas');
  const img = document.querySelector('.hero-logo-wrap .hero-logo');
  if (!link || !canvas || !img) return;

  const { scene, camera, renderer } = createScene(canvas);
  const sourceScene = await loadModel();
  const { pivot, depthAxis, upAxis } = createCenteredInstance(sourceScene);
  scene.add(pivot);
  addLighting(scene, depthAxis);

  fitCameraToObject(camera, pivot, depthAxis, upAxis);
  resizeRendererToCanvas(renderer, camera, canvas);
  renderer.render(scene, camera);

  new ResizeObserver(() => {
    resizeRendererToCanvas(renderer, camera, canvas);
    renderer.render(scene, camera);
  }).observe(canvas);

  let spinning = false;
  let startAngle = 0;
  let animElapsed = 0;
  let lastFrameTime = 0;
  // Caps how far any single frame can advance the rotation. Verified
  // via direct testing that requestAnimationFrame itself can stall for
  // multiple seconds between calls. Without this cap, a single delayed
  // frame would jump the rotation straight to its final angle,
  // skipping every intermediate frame in between.
  const MAX_FRAME_DELTA_MS = 50;

  const ROTATION_MS = 1500;       // how long the spin itself takes
  // easeOutQuad's deceleration means the last ~112ms of rotation is
  // already visually imperceptible before it mathematically reaches
  // 360deg. Starting the fade during that already-invisible window
  // (rather than waiting for it to finish, then pausing, then fading)
  // lets the transition complete before the viewer would ever notice
  // anything was still moving.
  const FADE_LEAD_MS = 166;       // fade starts this many ms before rotation's mathematical end
  const CROSSFADE_MS = 400;       // TEMP: bumped way up to test whether the fade mechanism itself works at all, separate from whether the duration is long enough to perceive
  const INITIAL_FADE_MS = 120;    // 2D -> 3D fade-in duration at hover start
  const FADE_OUT_START_MS = ROTATION_MS - FADE_LEAD_MS;

  // The opacity crossfade is handled entirely by the CSS transition
  // declared on these elements, not by per-frame JS - this is the key
  // fix over the previous approach. Setting per-frame opacity values
  // in the rAF loop made the fade entirely dependent on
  // requestAnimationFrame firing reliably and often; we verified rAF
  // itself can stall for multiple seconds, which made the fade skip
  // straight to its end state regardless of CROSSFADE_MS. A CSS
  // transition is handled natively by the browser's own compositor
  // once triggered - JS only needs to set the target value once, and
  // the interpolation continues correctly even if the JS thread is
  // busy or rAF is delayed.
  function setOpacity(canvasTarget, durationMs) {
    canvas.style.transitionDuration = `${durationMs}ms`;
    img.style.transitionDuration = `${durationMs}ms`;
    canvas.style.opacity = canvasTarget;
    img.style.opacity = 1 - canvasTarget;
  }

  function frame(now) {
    const delta = Math.min(now - lastFrameTime, MAX_FRAME_DELTA_MS);
    lastFrameTime = now;
    animElapsed += delta;
    const elapsed = animElapsed;

    // Rotation runs for its own fixed window, then stays pinned at
    // exactly 360deg/0deg for the remainder of the sequence - it
    // never resumes or continues once settled.
    const rotationT = Math.min(elapsed / ROTATION_MS, 1);
    pivot.rotation[upAxis] = startAngle - easeOutQuad(rotationT) * Math.PI * 2;
    renderer.render(scene, camera);

    if (elapsed < ROTATION_MS) {
      requestAnimationFrame(frame);
    } else {
      rotationDone = true;
      maybeFinishSpin();
    }
  }

  let rotationDone = false;
  let fadeDone = false;
  function maybeFinishSpin() {
    if (rotationDone && fadeDone) spinning = false;
  }

  img.addEventListener('transitionend', (e) => {
    if (e.propertyName !== 'opacity') return;
    fadeDone = true;
    maybeFinishSpin();
  });

  // Deliberately no mouseleave handler at all - once started, the
  // spin always plays out in full via requestAnimationFrame,
  // regardless of where the mouse goes in the meantime.
  link.addEventListener('mouseenter', () => {
    if (spinning) return;
    spinning = true;
    rotationDone = false;
    fadeDone = false;
    startAngle = pivot.rotation[upAxis];
    animElapsed = 0;
    lastFrameTime = performance.now();

    setOpacity(1, INITIAL_FADE_MS);
    setTimeout(() => setOpacity(0, CROSSFADE_MS), FADE_OUT_START_MS);

    requestAnimationFrame(frame);
  });
}

// --- Transition overlay logo: continuous spin, position persisted
// across page loads via sessionStorage. Since a page transition is a
// genuine browser navigation between two entirely separate page
// loads, with no JS state naturally surviving that boundary, a single
// fixed "virtual start timestamp" is stored once and reused on every
// subsequent page - each page just calculates how far into the
// infinite loop that timestamp implies right now using real
// wall-clock time, so the rotation continues seamlessly across
// navigations rather than resetting. ---
const TRANSITION_SPIN_LOOP_MS = 2000;

async function setupTransitionLogo3D() {
  const overlay = document.getElementById('pageTransitionOverlay');
  if (!overlay) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'page-transition-logo-canvas';
  overlay.appendChild(canvas);

  const { scene, camera, renderer } = createScene(canvas);
  const sourceScene = await loadModel();
  const { pivot, depthAxis, upAxis } = createCenteredInstance(sourceScene);
  scene.add(pivot);
  addLighting(scene, depthAxis);

  fitCameraToObject(camera, pivot, depthAxis, upAxis);
  resizeRendererToCanvas(renderer, camera, canvas);

  new ResizeObserver(() => {
    resizeRendererToCanvas(renderer, camera, canvas);
  }).observe(canvas);

  let startTs = parseInt(sessionStorage.getItem('logoSpinStart') || '', 10);
  if (!startTs) {
    startTs = Date.now();
    sessionStorage.setItem('logoSpinStart', String(startTs));
  }

  // Stops rendering once the overlay is hidden, rather than
  // continuing to render an invisible canvas indefinitely.
  let visible = true;
  new MutationObserver(() => {
    visible = !overlay.classList.contains('is-hidden');
  }).observe(overlay, { attributes: true, attributeFilter: ['class'] });

  function frame() {
    if (visible) {
      const elapsed = Date.now() - startTs;
      const t = (elapsed % TRANSITION_SPIN_LOOP_MS) / TRANSITION_SPIN_LOOP_MS;
      pivot.rotation[upAxis] = -t * Math.PI * 2;
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

setupTransitionLogo3D().catch((e) => console.error('[logo3d] Transition logo setup failed:', e));
setupHeaderLogo3D().catch((e) => console.error('[logo3d] Header logo setup failed:', e));