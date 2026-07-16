import * as THREE from 'three';

function luminousColor(hex, intensity) {
  const color = new THREE.Color(hex);
  color.multiplyScalar(intensity);
  return color;
}

function addCard(scene, {
  width,
  height,
  position,
  rotation = [0, 0, 0],
  color,
  intensity = 1,
}) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    color: luminousColor(color, intensity),
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const card = new THREE.Mesh(geometry, material);
  card.position.set(...position);
  card.rotation.set(...rotation);
  scene.add(card);
  return card;
}

// A deliberately abstract reflection world. None of this geometry is added to
// the visible scene: it only becomes a blurred PMREM sampled by physical glass.
export function createHiddenStadiumEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x555b60);

  const enclosure = new THREE.Mesh(
    new THREE.SphereGeometry(12, 32, 16),
    new THREE.MeshBasicMaterial({
      color: 0x4c5256,
      side: THREE.BackSide,
      toneMapped: false,
    })
  );
  environmentScene.add(enclosure);

  // Paired cool-white floodlights make two controlled crown/rim streaks.
  addCard(environmentScene, {
    width: 4.8,
    height: 1.05,
    position: [-3.2, 5.6, 2.1],
    rotation: [-0.72, -0.22, -0.08],
    color: 0xddeaff,
    intensity: 3.4,
  });
  addCard(environmentScene, {
    width: 3.6,
    height: 0.72,
    position: [3.6, 4.7, -1.8],
    rotation: [0.74, 0.2, 0.06],
    color: 0xf2f7ff,
    intensity: 2.8,
  });

  // Neutral structural cards articulate the curved side wall without adding
  // a new pigment family to the internal emotional field.
  addCard(environmentScene, {
    width: 1.15,
    height: 6.5,
    position: [-5.5, 1.35, -0.8],
    rotation: [0, Math.PI * 0.47, 0],
    color: 0xb9c0c4,
    intensity: 1.15,
  });
  addCard(environmentScene, {
    width: 0.72,
    height: 5.1,
    position: [5.2, 1.05, 1.2],
    rotation: [0, -Math.PI * 0.46, 0],
    color: 0xe2e5e2,
    intensity: 1.25,
  });

  // A broad, desaturated grass bounce stays below the object and deliberately
  // remains weaker than the neutral and cool cards.
  addCard(environmentScene, {
    width: 8.5,
    height: 4.8,
    position: [0, -3.2, 0.6],
    rotation: [-Math.PI / 2, 0, 0],
    color: 0x66856f,
    intensity: 0.78,
  });

  // One small scoreboard-like accent prevents the rig from feeling generic.
  // Its area and energy are intentionally minor.
  addCard(environmentScene, {
    width: 0.72,
    height: 0.24,
    position: [2.75, 1.5, -5.2],
    rotation: [0, 0, 0],
    color: 0xff9a68,
    intensity: 1.65,
  });

  const pmrem = new THREE.PMREMGenerator(renderer);
  const renderTarget = pmrem.fromScene(environmentScene, 0.04);
  pmrem.dispose();
  environmentScene.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose?.();
  });
  return renderTarget;
}
