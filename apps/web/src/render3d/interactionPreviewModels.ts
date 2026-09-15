import * as THREE from 'three'

import type { CharacterId } from '@game/shared'
import type { InteractionType } from '@/game/GameWorld'

type DisposableMaterial = {
  dispose: () => void
}

type DisposableGeometry = {
  dispose: () => void
}

type PreviewVector3 = {
  x: number
  y: number
  z: number
  set: (x: number, y: number, z: number) => void
}

export type PreviewObject3D = {
  position: PreviewVector3
  rotation: PreviewVector3
  traverse: (callback: (node: PreviewNode) => void) => void
}

type PreviewNode = Partial<PreviewObject3D> & {
  geometry?: DisposableGeometry
  material?: DisposableMaterial | DisposableMaterial[]
}

type PreviewGroup = PreviewObject3D & {
  add: (object: PreviewObject3D) => void
}

type PreviewMesh = PreviewObject3D

const WATER_COLOR = 0x1d7ec8
const WATER_HIGHLIGHT = 0x63c0ff
const SAND_COLOR = 0xe5d4a1
const GRASS_COLOR = 0x5f9c4f
const STONE_COLOR = 0x4a4a52
const STONE_HIGHLIGHT = 0x84848c
const WOOD_COLOR = 0x7b5130
const SAIL_COLOR = 0xf2eee3
const GOLD_COLOR = 0xe7bf57
const NPC_COLORS: Record<CharacterId, number> = {
  player: 0xd94f41,
  san: 0xe08a3c,
  shun: 0x4590d7,
  cyclone: 0x56aa5d,
  simon: 0x8f54c9,
}

function makeMaterial(color: number, roughness = 0.68, metalness = 0.08) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function addMesh(group: PreviewGroup, mesh: PreviewMesh, x = 0, y = 0, z = 0) {
  mesh.position.set(x, y, z)
  group.add(mesh)
  return mesh
}

function createStage(baseColor: number, ringColor: number) {
  const group = new THREE.Group()

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.5, 0.34, 32),
    makeMaterial(baseColor, 0.94, 0.02),
  )
  addMesh(group, base, 0, -0.2, 0)

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(1.18, 0.09, 12, 36),
    makeMaterial(ringColor, 0.52, 0.14),
  )
  rim.rotation.x = Math.PI / 2
  addMesh(group, rim, 0, -0.02, 0)

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1.1, 32),
    new THREE.MeshBasicMaterial({ color: 0x06101a, transparent: true, opacity: 0.22 }),
  )
  shadow.rotation.x = -Math.PI / 2
  addMesh(group, shadow, 0, -0.015, 0)

  return group
}

function addPalm(group: PreviewGroup, x: number, z: number, scale = 1) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05 * scale, 0.08 * scale, 0.8 * scale, 8),
    makeMaterial(0x8f6038, 0.85, 0.04),
  )
  trunk.rotation.z = 0.15
  addMesh(group, trunk, x, 0.3 * scale, z)

  for (let i = 0; i < 5; i += 1) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.24 * scale, 0.65 * scale, 6),
      makeMaterial(0x5ba950, 0.7, 0.03),
    )
    leaf.position.set(x, 0.75 * scale, z)
    leaf.rotation.z = Math.PI / 2
    leaf.rotation.y = (i / 5) * Math.PI * 2
    leaf.rotation.x = 0.3
    group.add(leaf)
  }
}

function addGrassCluster(group: PreviewGroup, x: number, z: number, scale = 1) {
  for (let i = 0; i < 4; i += 1) {
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(0.045 * scale, 0.26 * scale, 5),
      makeMaterial(0x72b65f, 0.8, 0.02),
    )
    blade.position.set(x + (i - 1.5) * 0.05 * scale, 0.1 * scale, z + (i % 2 === 0 ? -0.05 : 0.05) * scale)
    blade.rotation.z = (i - 1.5) * 0.12
    group.add(blade)
  }
}

function createDefaultPreview() {
  const group = createStage(WATER_COLOR, WATER_HIGHLIGHT)

  const island = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.95, 0.28, 20),
    makeMaterial(SAND_COLOR, 0.95, 0.01),
  )
  addMesh(group, island, 0, 0.03, 0)

  const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.54, 0.68, 0.15, 18),
    makeMaterial(GRASS_COLOR, 0.82, 0.04),
  )
  addMesh(group, grass, 0.08, 0.19, -0.05)

  addPalm(group, -0.28, 0.12, 0.9)
  addGrassCluster(group, 0.38, 0.12)
  addGrassCluster(group, 0.08, -0.28, 0.9)

  return group
}

/** 工场 — a stack of crates on a flagstone floor. Odd jobs move boxes, they don't catch fish. */
function createWorkPreview() {
  const group = createStage(STONE_COLOR, STONE_HIGHLIGHT)

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.16, 1.15),
    makeMaterial(0x6b6b73, 0.96, 0.02),
  )
  addMesh(group, floor, 0, 0.02, 0)

  // Crates stacked two wide and three high, the top one set askew so the pile
  // reads as "in use" rather than as a shop display.
  const crate = (x: number, y: number, z: number, size: number, tilt: number) => {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(size, size, size),
      makeMaterial(WOOD_COLOR, 0.88, 0.03),
    )
    box.rotation.y = tilt
    addMesh(group, box, x, y, z)
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(size * 1.02, size * 0.12, size * 1.02),
      makeMaterial(0x9a6b3f, 0.8, 0.04),
    )
    band.rotation.y = tilt
    addMesh(group, band, x, y, z)
  }

  crate(-0.34, 0.26, -0.1, 0.44, 0)
  crate(0.24, 0.26, 0.14, 0.4, 0.3)
  crate(-0.3, 0.68, -0.08, 0.4, 0.12)
  crate(0.2, 0.64, 0.12, 0.36, -0.22)
  crate(-0.08, 1.04, 0.02, 0.34, 0.42)

  return group
}

/** 武馆 — a wooden striking dummy on the hall's flagstones. */
function createTrainPreview() {
  const group = createStage(STONE_COLOR, STONE_HIGHLIGHT)

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.16, 1.15),
    makeMaterial(0x6b6b73, 0.96, 0.02),
  )
  addMesh(group, floor, 0, 0.02, 0)

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 1.15, 12),
    makeMaterial(WOOD_COLOR, 0.9, 0.02),
  )
  addMesh(group, post, 0, 0.68, 0)

  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.13, 0.13),
    makeMaterial(0x8a5a33, 0.88, 0.02),
  )
  addMesh(group, arm, 0, 0.94, 0)

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 16, 12),
    makeMaterial(0x9a6b3f, 0.86, 0.03),
  )
  addMesh(group, head, 0, 1.32, 0)

  // Wrapped rope around the post — cheap, but it is what makes the shape read
  // as a training dummy rather than a fence post.
  for (let i = 0; i < 3; i += 1) {
    const wrap = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.028, 8, 18),
      makeMaterial(SAIL_COLOR, 0.92, 0.01),
    )
    wrap.rotation.x = Math.PI / 2
    addMesh(group, wrap, 0, 0.36 + i * 0.2, 0)
  }

  return group
}

function createMerchantPreview() {
  const group = createStage(0x1b5b90, 0x88d1ff)

  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 0.42, 0.72),
    makeMaterial(WOOD_COLOR, 0.82, 0.05),
  )
  hull.position.y = 0.22
  hull.rotation.z = -0.04
  group.add(hull)

  const bow = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 0.36, 4),
    makeMaterial(0x6a4329, 0.82, 0.05),
  )
  bow.rotation.z = Math.PI / 2
  addMesh(group, bow, 0.78, 0.24, 0)

  const stern = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.52, 0.62),
    makeMaterial(0x6f4830, 0.84, 0.05),
  )
  addMesh(group, stern, -0.64, 0.3, 0)

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 1.38, 8),
    makeMaterial(0x5c3924, 0.9, 0.04),
  )
  addMesh(group, mast, 0.04, 0.95, 0)

  const sail = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.78, 0.03),
    makeMaterial(SAIL_COLOR, 0.7, 0.02),
  )
  sail.position.set(0.36, 1.02, 0.02)
  sail.rotation.y = -0.1
  group.add(sail)

  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.13, 0.02),
    makeMaterial(0xc94a42, 0.56, 0.02),
  )
  addMesh(group, flag, 0.18, 1.52, 0)

  for (let i = 0; i < 3; i += 1) {
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16),
      makeMaterial(GOLD_COLOR, 0.4, 0.32),
    )
    coin.rotation.x = Math.PI / 2
    addMesh(group, coin, -0.16 + i * 0.16, 0.48 + i * 0.05, i % 2 === 0 ? -0.12 : 0.12)
  }

  return group
}

function createNpcPreview(characterId: CharacterId) {
  const group = createStage(0x35543b, 0x89c56b)
  const shirtColor = NPC_COLORS[characterId]

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.76, 6, 10),
    makeMaterial(shirtColor, 0.7, 0.04),
  )
  addMesh(group, body, 0, 0.52, 0)

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 22, 18),
    makeMaterial(0xe8bc96, 0.58, 0.03),
  )
  addMesh(group, head, 0, 1.08, 0)

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 18, 14),
    makeMaterial(0x473223, 0.72, 0.02),
  )
  hair.scale.set(1.05, 0.72, 1.02)
  addMesh(group, hair, 0, 1.19, -0.02)

  const legA = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.08, 0.54, 8),
    makeMaterial(0x334252, 0.74, 0.04),
  )
  addMesh(group, legA, -0.14, 0.12, 0)

  const legB = legA.clone()
  legB.position.x = 0.14
  group.add(legB)

  const armA = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.52, 8),
    makeMaterial(shirtColor, 0.72, 0.04),
  )
  armA.rotation.z = 0.58
  addMesh(group, armA, -0.38, 0.64, 0)

  const armB = armA.clone()
  armB.rotation.z = -0.58
  armB.position.x = 0.38
  group.add(armB)

  return group
}

function createDungeonPreview() {
  const group = createStage(0x1a1622, 0x6f3a4a)
  const STONE = 0x4a4658
  const STONE_DARK = 0x2c2933
  const STONE_LIGHT = 0x6c6878
  const VOID = 0x05050a
  const TORCH = 0xff8a3c
  const BONE = 0xe6dfc8

  // Cave mouth backing (the dark void inside)
  const voidPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.0),
    new THREE.MeshBasicMaterial({ color: VOID }),
  )
  addMesh(group, voidPlate, 0, 0.62, -0.04)

  // Layered void glow for depth
  const innerGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.5),
    new THREE.MeshBasicMaterial({ color: 0x4a1a2a, transparent: true, opacity: 0.6 }),
  )
  addMesh(group, innerGlow, 0, 0.55, -0.035)

  // Arch left pillar
  const pillarL = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 1.05, 0.34),
    makeMaterial(STONE, 0.95, 0.04),
  )
  addMesh(group, pillarL, -0.55, 0.55, 0)

  // Arch right pillar
  const pillarR = pillarL.clone()
  pillarR.position.set(0.55, 0.55, 0)
  group.add(pillarR)

  // Arch keystone (top block)
  const keystone = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.28, 0.36),
    makeMaterial(STONE_LIGHT, 0.92, 0.05),
  )
  addMesh(group, keystone, 0, 1.18, 0)

  // Arch curve approximation: 3 stones forming a top arch
  for (let i = 0; i < 3; i += 1) {
    const t = (i - 1) * 0.42
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.22, 0.32),
      makeMaterial(STONE, 0.94, 0.04),
    )
    block.position.set(t, 1.04, 0)
    block.rotation.z = -t * 0.25
    group.add(block)
  }

  // Loose stones at the base
  for (let i = 0; i < 3; i += 1) {
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.1 + Math.random() * 0.04, 0),
      makeMaterial(STONE_DARK, 0.96, 0.02),
    )
    stone.position.set(-0.6 + i * 0.6, 0.08, 0.32 + (i % 2 === 0 ? 0.04 : -0.04))
    stone.rotation.y = Math.random() * Math.PI
    group.add(stone)
  }

  // Torches: socket + flame on each pillar
  for (const xOff of [-0.55, 0.55]) {
    const socket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.18, 8),
      makeMaterial(0x2a2230, 0.9, 0.05),
    )
    addMesh(group, socket, xOff, 0.92, 0.2)

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.2, 8),
      new THREE.MeshStandardMaterial({
        color: TORCH,
        emissive: TORCH,
        emissiveIntensity: 0.85,
        roughness: 0.4,
      }),
    )
    addMesh(group, flame, xOff, 1.08, 0.2)

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshBasicMaterial({ color: TORCH, transparent: true, opacity: 0.22 }),
    )
    addMesh(group, halo, xOff, 1.06, 0.2)
  }

  // Skull on the threshold
  const skull = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 14, 12),
    makeMaterial(BONE, 0.78, 0.02),
  )
  skull.scale.set(1, 0.92, 1.02)
  addMesh(group, skull, 0.18, 0.07, 0.36)

  const jaw = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.025, 0.06),
    makeMaterial(BONE, 0.78, 0.02),
  )
  addMesh(group, jaw, 0.18, 0.018, 0.4)

  const eyeL = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x080808 }),
  )
  addMesh(group, eyeL, 0.155, 0.085, 0.43)
  const eyeR = eyeL.clone()
  eyeR.position.x = 0.205
  group.add(eyeR)

  // Boss "menace" silhouette: red eyes deep in the cave
  const menaceEyeL = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xff3a3a }),
  )
  addMesh(group, menaceEyeL, -0.13, 0.7, -0.02)
  const menaceEyeR = menaceEyeL.clone()
  menaceEyeR.position.x = 0.13
  group.add(menaceEyeR)

  return group
}

export function createInteractionPreviewObject(interaction: InteractionType): PreviewGroup {
  if (!interaction) return createDefaultPreview()

  switch (interaction.kind) {
    case 'work':
      return createWorkPreview()
    case 'train':
      return createTrainPreview()
    case 'merchant':
      return createMerchantPreview()
    case 'dungeon':
      return createDungeonPreview()
    case 'npc':
      return createNpcPreview(interaction.characterId)
  }
}

export function disposeObject3D(root: PreviewObject3D) {
  root.traverse((node) => {
    if (node.geometry) {
      node.geometry.dispose()
    }

    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) {
      material?.dispose()
    }
  })
}
