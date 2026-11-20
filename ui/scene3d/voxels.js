// Parse the text-layer voxel format (see "about" in voxels/octo.json). Pure: node-testable.

export function parseModel(model) {
  const parts = {};
  for (const [name, part] of Object.entries(model.parts)) {
    const [x0, y0, z0] = part.at;
    const voxels = [];
    part.slices.forEach((rows, k) =>
      rows.forEach((row, r) =>
        [...row].forEach((ch, c) => {
          if (ch === '.') return;
          if (!(ch in model.palette)) throw new Error(`${name}: '${ch}' is not in the palette`);
          voxels.push({ x: x0 + c, y: y0 - r, z: z0 - k, color: model.palette[ch] });
        })));
    parts[name] = { voxels, thick: part.thick ?? 1, hidden: !!part.hidden };
  }
  return parts;
}

// Face order matches three.js BoxGeometry: +x, -x, +y, -y, +z, -z.
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// Only the faces with no voxel behind them. Buried faces are never drawn: they cost triangles
// and z-fight with the surface along shared edges (lit lines flickering on the back in Phase 1).
export function exposedFaces(voxels) {
  const filled = new Set(voxels.map(v => `${v.x},${v.y},${v.z}`));
  const faces = [];
  for (const v of voxels) {
    DIRS.forEach(([dx, dy, dz], f) => {
      if (!filled.has(`${v.x + dx},${v.y + dy},${v.z + dz}`)) faces.push({ v, f });
    });
  }
  return faces;
}

export function bounds(voxels) {
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const { x, y, z } of voxels) {
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
    b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
  }
  return { ...b, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, cz: (b.minZ + b.maxZ) / 2 };
}
