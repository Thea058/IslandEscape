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

// Keep the alley stage within reach of the workshop's stone: the preview panel is
// only ~300px wide, and a genuinely dark alley just reads as an empty panel.
const ALLEY_COLOR = 0x3d4149
const ALLEY_HIGHLIGHT = 0x7d8794
const FLAGSTONE_COLOR = 0x5a5f6b
const LAMP_COLOR = 0xffcc44
const STONE_COLOR = 0x4a4a52
const STONE_HIGHLIGHT = 0x84848c
const WOOD_COLOR = 0x7b5130
const ROPE_COLOR = 0xf2eee3
const GOLD_COLOR = 0xe7bf57
// Warm night tones for the market stall. The alley stage is deliberately cool, and
// the two panels sit side by side in the same corner of the screen — lit the same
// way, they would read as the same place.
const MARKET_COLOR = 0x3d3226
const MARKET_HIGHLIGHT = 0x8a7448
const PLANK_COLOR = 0x5e4a2e
const CLOTH_COLOR = 0xc2503f
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

/** A wooden crate with a lighter band. Shared by the workshop and the alley. */
function addCrate(group: PreviewGroup, x: number, y: number, z: number, size: number, tilt: number) {
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

/**
 * Idle state — nothing within reach to inspect.
 *
 * The panel heading here reads "Back Alleys", so this is a stretch of the walled
 * city at night: wet flagstones, a lamp standard, crates left for the next
 * odd-job shift. It used to be a sand island with a palm tree, which was the
 * last place the island theme still reached the screen.
 */
function createDefaultPreview() {
  const group = createStage(ALLEY_COLOR, ALLEY_HIGHLIGHT)

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.16, 1.15),
    makeMaterial(FLAGSTONE_COLOR, 0.72, 0.04),
  )
  addMesh(group, floor, 0, 0.02, 0)

  // A few slabs at different tones, so the floor does not read as one flat sheet
  // of grey in a preview only ~300px wide.
  const slab = (x: number, z: number, w: number, d: number, tone: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), makeMaterial(tone, 0.78, 0.03))
    addMesh(group, mesh, x, 0.105, z)
  }
  slab(-0.46, -0.32, 0.54, 0.42, 0x6b7280)
  slab(-0.38, 0.28, 0.5, 0.4, 0x51565f)
  slab(0.44, -0.34, 0.46, 0.36, 0x6b7280)

  // Puddle — a dark disc with a lighter rim. Cheapest way to say "it rained".
  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 24),
    new THREE.MeshBasicMaterial({ color: 0x2a5b85, transparent: true, opacity: 0.75 }),
  )
  puddle.rotation.x = -Math.PI / 2
  addMesh(group, puddle, -0.02, 0.101, 0.34)

  const puddleRim = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.34, 24),
    new THREE.MeshBasicMaterial({ color: 0xa8cbe8, transparent: true, opacity: 0.4 }),
  )
  puddleRim.rotation.x = -Math.PI / 2
  addMesh(group, puddleRim, -0.02, 0.102, 0.34)

  // Lamp standard, hung at the back. The warm glow is the same lit-window yellow
  // the title logo uses, so the panel belongs to the same city as the logo.
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.06, 1.15, 10),
    makeMaterial(0x2b2f38, 0.85, 0.12),
  )
  addMesh(group, post, -0.6, 0.675, -0.6)

  const bracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.05, 0.05),
    makeMaterial(0x2b2f38, 0.85, 0.12),
  )
  addMesh(group, bracket, -0.45, 1.22, -0.6)

  const lampHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.19, 0.16, 0.19),
    makeMaterial(0x3a3f4a, 0.7, 0.1),
  )
  addMesh(group, lampHead, -0.33, 1.13, -0.6)

  const bulb = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.1, 0.13),
    new THREE.MeshStandardMaterial({
      color: LAMP_COLOR,
      emissive: LAMP_COLOR,
      emissiveIntensity: 0.95,
      roughness: 0.4,
    }),
  )
  addMesh(group, bulb, -0.33, 1.12, -0.6)

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 14, 12),
    new THREE.MeshBasicMaterial({ color: LAMP_COLOR, transparent: true, opacity: 0.16 }),
  )
  addMesh(group, halo, -0.33, 1.12, -0.6)

  // Crates waiting for the next shift.
  addCrate(group, 0.46, 0.32, 0.3, 0.44, 0.24)
  addCrate(group, 0.4, 0.72, 0.26, 0.36, -0.16)

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
  addCrate(group, -0.34, 0.26, -0.1, 0.44, 0)
  addCrate(group, 0.24, 0.26, 0.14, 0.4, 0.3)
  addCrate(group, -0.3, 0.68, -0.08, 0.4, 0.12)
  addCrate(group, 0.2, 0.64, 0.12, 0.36, -0.22)
  addCrate(group, -0.08, 1.04, 0.02, 0.34, 0.42)

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
      makeMaterial(ROPE_COLOR, 0.92, 0.01),
    )
    wrap.rotation.x = Math.PI / 2
    addMesh(group, wrap, 0, 0.36 + i * 0.2, 0)
  }

  return group
}

/**
 * 夜市 — a stall under a cloth awning.
 *
 * The panel heading here reads "Night Market", and that heading is the contract:
 * the preview has to look like what the label already promises. It used to be a
 * sailboat on a blue stage, left over from the island build — the retheme renamed
 * the panel but never repainted the model, and no type can check whether a shape
 * looks like a boat.
 */
function createMerchantPreview() {
  const group = createStage(MARKET_COLOR, MARKET_HIGHLIGHT)

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.16, 1.15),
    makeMaterial(PLANK_COLOR, 0.78, 0.03),
  )
  addMesh(group, floor, 0, 0.02, 0)

  // Counter: a top slab over a solid front panel and two side panels. At ~300px a
  // solid body reads as a stall; four thin legs would read as a table.
  const counterTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.1, 0.66),
    makeMaterial(WOOD_COLOR, 0.8, 0.04),
  )
  addMesh(group, counterTop, 0, 0.86, 0)

  const counterFront = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.78, 0.08),
    makeMaterial(0x6a4329, 0.86, 0.03),
  )
  addMesh(group, counterFront, 0, 0.44, 0.29)

  for (const x of [-0.71, 0.71]) {
    const side = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.78, 0.6),
      makeMaterial(0x6a4329, 0.86, 0.03),
    )
    addMesh(group, side, x, 0.44, 0)
  }

  for (const x of [-0.74, 0.74]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.05, 1.9, 10),
      makeMaterial(0x5c3924, 0.9, 0.04),
    )
    addMesh(group, post, x, 0.95, -0.22)
  }

  // Tilted on purpose: a level awning reads as a lid on top of the panel.
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(1.72, 0.06, 0.95),
    makeMaterial(CLOTH_COLOR, 0.92, 0.01),
  )
  awning.rotation.x = -0.14
  addMesh(group, awning, 0, 1.88, 0.06)

  // Goods on the counter — crates left, jars centre, coins right.
  addCrate(group, -0.5, 1.02, 0.02, 0.22, 0.2)
  addCrate(group, -0.28, 1.0, 0.08, 0.18, -0.15)

  const jar = (x: number, z: number) => {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.085, 0.2, 12),
      makeMaterial(0x4f6b5a, 0.5, 0.08),
    )
    addMesh(group, body, x, 1.01, z)

    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.03, 12),
      makeMaterial(0x8a6a3a, 0.7, 0.05),
    )
    addMesh(group, lid, x, 1.125, z)
  }
  jar(0.08, -0.06)
  jar(0.3, 0.1)

  for (let i = 0; i < 3; i += 1) {
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16),
      makeMaterial(GOLD_COLOR, 0.4, 0.32),
    )
    coin.rotation.x = Math.PI / 2
    addMesh(group, coin, 0.42 + i * 0.13, 0.925, i % 2 === 0 ? -0.16 : -0.02)
  }

  // One lantern on a cord under the awning. Same lit-window yellow as the title
  // logo and the alley lamp, so the whole city stays on one palette.
  const lantern = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.2, 0.16),
    new THREE.MeshStandardMaterial({
      color: LAMP_COLOR,
      emissive: LAMP_COLOR,
      emissiveIntensity: 0.95,
      roughness: 0.4,
    }),
  )
  addMesh(group, lantern, 0.52, 1.6, 0.02)

  const lanternHalo = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 14, 12),
    new THREE.MeshBasicMaterial({ color: LAMP_COLOR, transparent: true, opacity: 0.16 }),
  )
  addMesh(group, lanternHalo, 0.52, 1.6, 0.02)

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6),
    makeMaterial(0x2b2f38, 0.9, 0.05),
  )
  addMesh(group, cord, 0.52, 1.78, 0.02)

  // Hanging board — how a stall announces itself when the panel cannot render text.
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.46, 0.05),
    makeMaterial(0xd8c49a, 0.78, 0.02),
  )
  addMesh(group, board, -0.52, 1.42, 0.05)

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
