import type { Vec3Like } from './types';

export function v3(x = 0, y = 0, z = 0): Vec3Like {
  return { x, y, z };
}

export function cloneV3(a: Vec3Like): Vec3Like {
  return { x: a.x, y: a.y, z: a.z };
}

export function setV3(out: Vec3Like, x: number, y: number, z: number): Vec3Like {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copyV3(out: Vec3Like, a: Vec3Like): Vec3Like {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function lengthSq(a: Vec3Like): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a: Vec3Like): number {
  return Math.sqrt(lengthSq(a));
}

export function normalize(out: Vec3Like, a: Vec3Like): Vec3Like {
  const len = length(a) || 1;
  out.x = a.x / len;
  out.y = a.y / len;
  out.z = a.z / len;
  return out;
}

export function addScaled(out: Vec3Like, a: Vec3Like, b: Vec3Like, s: number): Vec3Like {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  out.z = a.z + b.z * s;
  return out;
}

export function cross(out: Vec3Like, a: Vec3Like, b: Vec3Like): Vec3Like {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return setV3(out, x, y, z);
}

export function dot(a: Vec3Like, b: Vec3Like): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Project vector onto the plane defined by normal n (n should be unit). */
export function projectOnPlane(out: Vec3Like, v: Vec3Like, n: Vec3Like): Vec3Like {
  const d = dot(v, n);
  out.x = v.x - n.x * d;
  out.y = v.y - n.y * d;
  out.z = v.z - n.z * d;
  return out;
}

/** Rotate point around Y axis by angle. */
export function rotateY(out: Vec3Like, a: Vec3Like, angle: number): Vec3Like {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = a.x * c + a.z * s;
  const z = -a.x * s + a.z * c;
  return setV3(out, x, a.y, z);
}

/** Rotate point around X axis by angle. */
export function rotateX(out: Vec3Like, a: Vec3Like, angle: number): Vec3Like {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const y = a.y * c - a.z * s;
  const z = a.y * s + a.z * c;
  return setV3(out, a.x, y, z);
}

/** Apply planet rotation (X then Y) to a local surface normal → world direction. */
export function localToWorldNormal(out: Vec3Like, local: Vec3Like, rotX: number, rotY: number): Vec3Like {
  copyV3(out, local);
  rotateX(out, out, rotX);
  rotateY(out, out, rotY);
  return normalize(out, out);
}

export function worldToLocalNormal(out: Vec3Like, world: Vec3Like, rotX: number, rotY: number): Vec3Like {
  copyV3(out, world);
  rotateY(out, out, -rotY);
  rotateX(out, out, -rotX);
  return normalize(out, out);
}

/** Angular distance between two unit normals (radians). */
export function angularDistance(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, dot(a, b)));
  return Math.acos(d);
}

export function randomOnSphere(out: Vec3Like, rng: () => number): Vec3Like {
  // Uniform on sphere via gaussian-ish polar method
  const u = rng() * 2 - 1;
  const theta = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return setV3(out, s * Math.cos(theta), u, s * Math.sin(theta));
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

let idCounter = 1;
export function nextId(prefix: string): string {
  return `${prefix}_${idCounter++}`;
}

export function resetIdCounter(n = 1): void {
  idCounter = n;
}

export function getIdCounter(): number {
  return idCounter;
}

/** Derive next counter from existing entity/log ids so loaded games don't collide. */
export function syncIdCounterFromIds(ids: Iterable<string>): void {
  let max = 0;
  for (const id of ids) {
    const idx = id.lastIndexOf('_');
    if (idx < 0) continue;
    const n = Number(id.slice(idx + 1));
    if (Number.isFinite(n) && n > max) max = n;
  }
  idCounter = Math.max(idCounter, max + 1);
}

