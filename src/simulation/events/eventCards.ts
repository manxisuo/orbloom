import type { EventId, GameWorldState, PendingEvent, Vec3Like } from '../../shared/types';
import { nextId, randomOnSphere, v3 } from '../../shared/math';
import { makePlantForEvent } from '../WorldSimulation';

export interface EventApplyResult {
  message: string;
  /** Local surface normal for VFX anchoring (planet space). */
  impact?: Vec3Like;
}

export interface EventDef {
  id: EventId;
  title: string;
  body: string;
  acceptLabel: string;
  declineLabel: string;
  weight: number;
  apply: (world: GameWorldState, rng: () => number) => EventApplyResult;
  decline?: (world: GameWorldState) => string;
}

export const EVENT_DEFS: EventDef[] = [
  {
    id: 'meteor',
    title: '流星坠落',
    body: '一颗流星划过夜空。接受它可能留下矿石星尘，也可能砸坏附近植被。',
    acceptLabel: '迎接流星',
    declineLabel: '避开',
    weight: 1,
    apply(world, rng) {
      const n = randomOnSphere(v3(), rng);
      world.resources.stardust += 12;
      let scorched: string | null = null;
      for (const p of world.plants) {
        const d = ang(p.position.normal, n);
        if (d < 0.35) {
          p.health = Math.max(0, p.health - 0.45);
          p.growth = Math.max(0, p.growth - 0.3);
          scorched = p.id;
          break;
        }
      }
      return {
        message: scorched ? '流星带来了星尘，也留下一片焦痕。' : '流星带来了闪亮的星尘。',
        impact: n,
      };
    },
    decline() {
      return '流星擦过大气层，什么也没留下。';
    },
  },
  {
    id: 'coldNight',
    title: '漫长寒夜',
    body: '一股寒流逼近。接下来几个昼夜，植物会更难熬。',
    acceptLabel: '硬扛过去',
    declineLabel: '谢绝',
    weight: 1,
    apply(world) {
      world.modifiers.coldDays = Math.max(world.modifiers.coldDays, 2.5);
      return { message: '寒夜降临，植物生长放缓。' };
    },
    decline() {
      return '寒流改道，星球躲过一劫。';
    },
  },
  {
    id: 'drought',
    title: '干旱季节',
    body: '空气变得干燥，湖水会蒸发得更快。多给树木遮阴，或降一场雨吧。',
    acceptLabel: '接受干旱',
    declineLabel: '设法避开',
    weight: 1,
    apply(world) {
      world.modifiers.droughtDays = Math.max(world.modifiers.droughtDays, 3);
      return { message: '干旱季节开始，湖泊水位承压。' };
    },
    decline() {
      return '一场意外的湿气缓解了干旱征兆。';
    },
  },
  {
    id: 'strangeSeed',
    title: '奇怪的种子',
    body: '风里带来一包陌生的种子。也许能长出新的花草？',
    acceptLabel: '种下试试',
    declineLabel: '丢掉',
    weight: 1.2,
    apply(world, rng) {
      const n = randomOnSphere(v3(), rng);
      const species = rng() < 0.45 ? 'flower' : 'grass';
      for (let i = 0; i < 3; i++) {
        const jitter = randomOnSphere(v3(), rng);
        const p = makePlantForEvent(species, mix(n, jitter, 0.15));
        world.plants.push(p);
      }
      return {
        message: species === 'flower' ? '奇怪的种子开出了花。' : '奇怪的种子长成了一片草。',
        impact: n,
      };
    },
    decline() {
      return '种子被风吹走了。';
    },
  },
  {
    id: 'migratingBirds',
    title: '迁徙旅客',
    body: '一群候鸟请求在此短暂停留。若收留它们，离开时会留下星尘与谢意。',
    acceptLabel: '收留候鸟',
    declineLabel: '婉拒',
    weight: 1,
    apply(world) {
      world.resources.stardust += 6;
      // Birds return with gifts a few game-days later
      world.delayedEvents.push({
        kind: 'birdGift',
        fireAt: world.time.gameTime + world.time.dayLength * 2.5,
      });
      return { message: '候鸟落脚又启程，留下几枚闪亮的羽尘。' };
    },
    decline() {
      return '候鸟转向远方。';
    },
  },
];

export function toPending(def: EventDef): PendingEvent {
  return {
    id: def.id,
    title: def.title,
    body: def.body,
    acceptLabel: def.acceptLabel,
    declineLabel: def.declineLabel,
  };
}

export function pickEvent(rng: () => number): EventDef {
  const total = EVENT_DEFS.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of EVENT_DEFS) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return EVENT_DEFS[0];
}

export function findEventDef(id: EventId): EventDef {
  return EVENT_DEFS.find((e) => e.id === id) ?? EVENT_DEFS[0];
}

function ang(a: Vec3Like, b: Vec3Like): number {
  const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
  return Math.acos(d);
}

function mix(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  const z = a.z + (b.z - a.z) * t;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

// silence unused in case tree-shaken
void nextId;
