// Rendering: tone mapping that keeps colours true while taming highlights, and by quality level ambient occlusion (the soft
// darkening where things meet: feet on the court, players in the stands), a gentle glow
// on the brightest highlights, smoothed edges, and sharper shadows.
//   low     straight to the screen, tone mapped (phones and older computers)
//   medium  glow and smoothed edges, finer shadows
//   high    everything, including ambient occlusion
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export const QUALITY = {
  low: { label: 'Low', pixelRatio: 1, shadow: 1024, ao: false, bloom: false, smaa: false },
  medium: { label: 'Medium', pixelRatio: 1.5, shadow: 2048, ao: false, bloom: true, smaa: true },
  high: { label: 'High', pixelRatio: 2, shadow: 4096, ao: true, bloom: true, smaa: true },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];

export function createGraphics(renderer, world) {
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps colours true, rolls off only the brightest highlights
  renderer.toneMappingExposure = 1.0;
  let level = 'high', composer = null, w = 1, h = 1;

  function build() {
    const Q = QUALITY[level];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
    // the sun's shadow map: finer on higher settings
    const sun = world.sun;
    if (sun.shadow.mapSize.x !== Q.shadow) {
      sun.shadow.mapSize.set(Q.shadow, Q.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    if (composer) { composer.dispose(); composer = null; }
    if (!Q.ao && !Q.bloom && !Q.smaa) return; // straight to the screen
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(world.scene, world.camera));
    if (Q.ao) {
      const ao = new GTAOPass(world.scene, world.camera, w, h);
      ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85;
      composer.addPass(ao);
    }
    if (Q.bloom) composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.16, 0.45, 0.93));
    composer.addPass(new OutputPass());
    if (Q.smaa) {
      const pr = renderer.getPixelRatio();
      composer.addPass(new SMAAPass(w * pr, h * pr));
    }
    composer.setSize(w, h);
  }

  return {
    setQuality(name) {
      level = QUALITY[name] ? name : 'high';
      build();
      renderer.setSize(w, h, false);
      if (composer) composer.setSize(w, h);
    },
    get quality() { return level; },
    setSize(width, height) {
      w = width; h = height;
      renderer.setSize(w, h, false);
      if (composer) composer.setSize(w, h);
    },
    render() {
      if (composer) composer.render();
      else renderer.render(world.scene, world.camera);
    },
  };
}
