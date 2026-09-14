import type { Vec3Like } from '../shared/types';
import { normalize, randomOnSphere, v3 } from '../shared/math';

export function ang(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(d);
}

export function mixNormals(a: Vec3Like, b: Vec3Like): Vec3Like {
  return normalize(v3(), v3(a.x + b.x, a.y + b.y, a.z + b.z));
}

export function jitterNormal(out: Vec3Like, base: Vec3Like, amt: number, rng: () => number): void {
  const j = randomOnSphere(v3(), rng);
  out.x = base.x + j.x * amt;
  out.y = base.y + j.y * amt;
  out.z = base.z + j.z * amt;
  normalize(out, out);
}

export function randomNear(rng: () => number, center: Vec3Like, maxAng: number): Vec3Like {
  // Sample a few candidates, keep closest-ish
  let best = randomOnSphere(v3(), rng);
  let bestAng = ang(best, center);
  for (let i = 0; i < 8; i++) {
    const c = randomOnSphere(v3(), rng);
    const a = ang(c, center);
    if (a < bestAng) {
      bestAng = a;
      best = c;
    }
  }
  if (bestAng > maxAng) {
    // Slerp toward center a bit
    const t = 0.5;
    normalize(
      best,
      v3(best.x + (center.x - best.x) * t, best.y + (center.y - best.y) * t, best.z + (center.z - best.z) * t),
    );
  }
  return best;
}

export function randomTangentSafe(out: Vec3Like, normal: Vec3Like): void {
  const ref = Math.abs(normal.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const cx = normal.y * ref.z - normal.z * ref.y;
  const cy = normal.z * ref.x - normal.x * ref.z;
  const cz = normal.x * ref.y - normal.y * ref.x;
  out.x = cx;
  out.y = cy;
  out.z = cz;
  normalize(out, out);
}
