import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { emotions, motion } from "./emotions";
import type { PetEmotion } from "./emotions";

export type PetRenderer = {
  setEmotion: (emotion: PetEmotion, replay?: boolean) => void;
  lookAt: (x: number, y: number) => void;
  setTravelVelocity: (speed: number) => void;
  setPaused: (paused: boolean) => void;
  dispose: () => void;
};

/** A real extruded character. The host can be a webview, canvas container, or React view. */
export function createPetRenderer(host: HTMLElement, onContextChange: (ready: boolean) => void): PetRenderer | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true });
  if (!context) return null;
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2.8, 2.8, 2.8, -2.8, .1, 30);
  camera.position.set(0, .1, 9);
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();

  const shape = new THREE.Shape();
  shape.moveTo(0, 2.05);
  shape.bezierCurveTo(.12, .75, .75, .12, 2.05, 0);
  shape.bezierCurveTo(.75, -.12, .12, -.75, 0, -2.05);
  shape.bezierCurveTo(-.12, -.75, -.75, -.12, -2.05, 0);
  shape.bezierCurveTo(-.75, .12, -.12, .75, 0, 2.05);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: .58, bevelEnabled: true, bevelSegments: 10, bevelSize: .14,
    bevelThickness: .2, curveSegments: 40, steps: 1,
  });
  geometry.center();
  const pearl = new THREE.MeshPhysicalMaterial({
    color: 0xe3eed4, metalness: .78, roughness: .23, clearcoat: 1,
    clearcoatRoughness: .12, iridescence: .14, iridescenceIOR: 1.3,
  });
  const edge = new THREE.MeshPhysicalMaterial({
    color: 0xb0c68b, metalness: .88, roughness: .2, clearcoat: .9,
  });
  const character = new THREE.Group();
  const body = new THREE.Group();
  body.add(new THREE.Mesh(geometry, [pearl, edge]));
  character.add(body);
  scene.add(character);

  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = faceCanvas.height = 512;
  const faceContext = faceCanvas.getContext("2d");
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  const faceMaterial = new THREE.MeshBasicMaterial({ map: faceTexture, transparent: true, depthWrite: false });
  const faceGeometry = new THREE.PlaneGeometry(4.1, 4.1);
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.position.z = .5;
  body.add(face);
  const eyeGeometry = new THREE.SphereGeometry(.09, 16, 12);
  const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: 0x10160c, roughness: .15, metalness: .2, clearcoat: 1 });
  const eyes = [-.328, .287].map((x) => {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(x, .102, .54);
    eye.scale.set(.85, 1.65, .6);
    body.add(eye);
    return eye;
  });

  const ringGeometry = new THREE.TorusGeometry(1.55, .027, 10, 100);
  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xd5f49d, metalness: .8, roughness: .22 });
  const orbit = new THREE.Group();
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  orbit.rotation.set(.6, -.4, -.35);
  orbit.add(ring);
  character.add(orbit);
  const moonGeometry = new THREE.SphereGeometry(.085, 12, 10);
  const moon = new THREE.Mesh(moonGeometry, ringMaterial);
  orbit.add(moon);
  const sparks = new THREE.Group();
  const sparkGeometry = geometry.clone();
  const sparkMaterial = new THREE.MeshStandardMaterial({ color: 0xf6d68c, metalness: .6, roughness: .25, emissive: 0xc2983d, emissiveIntensity: .15 });
  for (let index = 0; index < 3; index++) {
    const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
    spark.scale.setScalar(.065);
    sparks.add(spark);
  }
  character.add(sparks);

  scene.add(new THREE.AmbientLight(0xffffff, .8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 4.5);
  keyLight.position.set(-3, 5, 6);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xd5f49d, 3);
  rimLight.position.set(4, -1, -3);
  scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xe0e8ff, 1.8);
  fillLight.position.set(-4, -2, 3);
  scene.add(fillLight);

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let emotion: PetEmotion = "curious";
  let startedAt = performance.now();
  let gazeX = 0;
  let gazeY = 0;
  let travelSpeed = 0;
  let travelLean = 0;
  let faceGazeX = 0;
  let faceGazeY = 0;
  let lastBlink = -1;
  let dirtyFace = true;
  let paused = false;
  let visible = true;
  let lost = false;
  let disposed = false;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;

  function paintFace(blink: number) {
    if (!faceContext) return;
    const ctx = faceContext;
    const expression = emotions[emotion];
    ctx.clearRect(0, 0, 512, 512);
    ctx.save();
    ctx.scale(5.12, 5.12);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#11180c";
    ctx.fillStyle = "#11180c";
    ctx.lineWidth = 3.3;
    ctx.save();
    ctx.translate(faceGazeX, faceGazeY);
    ctx.translate(50, 47);
    ctx.scale(1, 1 - blink * .92);
    ctx.translate(-50, -47);
    if (emotion !== "curious") {
      for (const eyePath of [expression.leftEye, expression.rightEye]) {
        const path = new Path2D(eyePath);
        ctx.stroke(path);
        if (emotion === "love") ctx.fill(path);
      }
    }
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.fillStyle = "#11180c";
    const mouth = new Path2D(expression.mouth);
    ctx.stroke(mouth);
    if (emotion === "excited" || emotion === "zooming") {
      ctx.fill(mouth);
      ctx.fillStyle = "#efb3a3";
      ctx.beginPath(); ctx.ellipse(50, 59, 2.2, 1, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = emotion === "love" ? "#e79b9c" : "#cd9c8a";
    ctx.globalAlpha = emotion === "love" ? .7 : .35;
    for (const x of [35, 65]) { ctx.beginPath(); ctx.ellipse(x, 54, 3.2, 1.3, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    faceTexture.needsUpdate = true;
  }

  function requestRender() {
    if (!frame && !document.hidden && visible && !lost && !disposed) frame = requestAnimationFrame(render);
  }
  function render(now: number) {
    frame = 0;
    if (disposed || lost || !visible || document.hidden) return;
    const dt = Math.min(.05, Math.max(0, (now - (lastTime || now)) / 1000));
    lastTime = now;
    if (!paused && !reduced.matches) elapsed += dt;
    const moving = !paused && !reduced.matches;
    const t = elapsed;
    const reactionTime = (now - startedAt) / 1000;
    const activeBonk = emotion === "bonked" && reactionTime < motion.bonk.durationMs / 1000;
    let squash = 1;
    let roll = -.08;
    if (moving) {
      roll += Math.sin(t * 1.2) * .035;
      if (activeBonk) {
        const hit = Math.sin(reactionTime * 18) * Math.exp(-reactionTime * 5);
        squash = 1 - hit * .28;
        roll += hit * .65;
      } else if (emotion === "dizzy") roll += Math.sin(reactionTime * 8) * .3;
      else if (emotion === "excited" || emotion === "proud") squash = 1 + Math.sin(t * 9) * .035;
      else if (emotion === "zooming") { squash = 1.1; roll += Math.sin(t * 16) * .015; }
    }
    body.scale.set(1 / Math.sqrt(squash), squash, 1);
    travelLean += (Math.max(-.38, Math.min(.38, -travelSpeed * .12)) - travelLean) * (1 - Math.exp(-dt * 10));
    body.rotation.set(-.14 + gazeY * .16 + (moving ? Math.abs(travelLean) * .4 : 0), -.36 + gazeX * .3, roll + (moving ? travelLean : 0));
    body.position.y = moving ? Math.sin(t * (emotion === "sleepy" ? 1 : 1.7)) * .06 : 0;
    orbit.rotation.x = .6 + (moving ? Math.sin(t * .7) * .12 : 0);
    orbit.rotation.y = -.4 + (moving ? Math.cos(t * .5) * .12 : 0);
    const orbitAngle = t * .65;
    moon.position.set(Math.cos(orbitAngle) * 1.55, Math.sin(orbitAngle) * 1.55, 0);
    sparks.visible = emotion === "bonked" || emotion === "dizzy" || emotion === "proud";
    sparks.children.forEach((spark, index) => {
      const angle = t * 2.5 + index * Math.PI * 2 / 3;
      spark.position.set(Math.cos(angle) * 1.18, 1.2 + Math.sin(angle) * .35, Math.sin(angle) * .5);
      spark.rotation.z = angle;
    });
    const phase = (t * 1000) % motion.blink.intervalMs;
    const blink = moving && emotion === "curious" && phase < motion.blink.durationMs
      ? Math.sin(phase / motion.blink.durationMs * Math.PI) : 0;
    const quantizedBlink = Math.round(blink * 12) / 12;
    const smoothing = 1 - Math.exp(-dt * 9);
    faceGazeX += (gazeX * 1.3 - faceGazeX) * smoothing;
    faceGazeY += (-gazeY * .8 - faceGazeY) * smoothing;
    eyes.forEach((eye, index) => {
      eye.visible = emotion === "curious";
      eye.position.x = (index === 0 ? -.328 : .287) + faceGazeX * .041;
      eye.position.y = .102 - faceGazeY * .041;
      eye.scale.y = 1.65 * (1 - blink * .92);
    });
    if (dirtyFace || quantizedBlink !== lastBlink || moving &&
      (Math.abs(gazeX * 1.3 - faceGazeX) > .015 || Math.abs(-gazeY * .8 - faceGazeY) > .015)) {
      paintFace(quantizedBlink);
      dirtyFace = false;
      lastBlink = quantizedBlink;
    }
    renderer.render(scene, camera);
    if (moving) requestRender();
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (width && height) {
      const aspect = width / height;
      camera.left = -2.8 * Math.max(1, aspect);
      camera.right = -camera.left;
      camera.top = 2.8 * Math.max(1, 1 / aspect);
      camera.bottom = -camera.top;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      requestRender();
    }
  }
  function visibility() { lastTime = 0; if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else requestRender(); }
  function loseContext(event: Event) { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; onContextChange(false); }
  function restoreContext() { lost = false; dirtyFace = true; onContextChange(true); requestRender(); }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const observer = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (visible) { lastTime = 0; requestRender(); } else { cancelAnimationFrame(frame); frame = 0; }
  });
  observer.observe(host);
  canvas.addEventListener("webglcontextlost", loseContext);
  canvas.addEventListener("webglcontextrestored", restoreContext);
  document.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", requestRender);
  resize();
  return {
    setEmotion(next, replay = false) { if (emotion !== next || replay) { emotion = next; startedAt = performance.now(); dirtyFace = true; requestRender(); } },
    lookAt(x, y) {
      if (!reduced.matches && !paused && Number.isFinite(x) && Number.isFinite(y)) {
        gazeX = Math.max(-1, Math.min(1, x)); gazeY = Math.max(-1, Math.min(1, y)); requestRender();
      }
    },
    setTravelVelocity(speed) { travelSpeed = Number.isFinite(speed) ? speed : 0; requestRender(); },
    setPaused(next) { paused = next; lastTime = 0; dirtyFace = true; requestRender(); },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect(); observer.disconnect();
      canvas.removeEventListener("webglcontextlost", loseContext);
      canvas.removeEventListener("webglcontextrestored", restoreContext);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", requestRender);
      geometry.dispose(); sparkGeometry.dispose(); ringGeometry.dispose(); moonGeometry.dispose(); faceGeometry.dispose(); eyeGeometry.dispose(); eyeMaterial.dispose();
      pearl.dispose(); edge.dispose(); ringMaterial.dispose(); sparkMaterial.dispose(); faceMaterial.dispose(); faceTexture.dispose(); environment.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
