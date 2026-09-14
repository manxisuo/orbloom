import type { EventId, GameWorldState, PendingEvent, Vec3Like } from '../../shared/types';
import { nextId, normalize, randomOnSphere, v3 } from '../../shared/math';
import { makePlantForEvent } from '../actions';

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
  decline?: (world: GameWorldState, rng: () => number) => EventApplyResult | string;
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
      return { message: '寒夜降临，植物生长放缓；寒冷也让湖水蒸发变慢。' };
    },
    decline(world) {
      if (world.resources.stardust < 6) {
        world.modifiers.coldDays = Math.max(world.modifiers.coldDays, 2.5);
        return { message: '星尘不足，无法保温，寒夜照旧到来。' };
      }
      world.resources.stardust -= 6;
      return { message: '你耗星尘维持了温度，寒夜绕过了星球。' };
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
      world.resources.stardust += 12;
      world.modifiers.droughtDays = Math.max(world.modifiers.droughtDays, 3);
      return { message: '干旱开始，湖水蒸发加快；晴空也送来了星尘。' };
    },
    decline(world) {
      if (world.resources.stardust < 8) {
        world.modifiers.droughtDays = Math.max(world.modifiers.droughtDays, 3);
        return { message: '星尘不足，无法遮云，干旱还是来了。' };
      }
      world.resources.stardust -= 8;
      world.delayedEvents.push({
        kind: 'droughtReturn',
        fireAt: world.time.gameTime + world.time.dayLength * 1.5,
      });
      return { message: '你耗星尘推迟了干旱，但它似乎还会回来。' };
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
    apply(world, rng) {
      world.resources.stardust += 6;
      // Visiting birds graze nearby grass while they stay
      let grazed = 0;
      const grass = world.plants.filter((p) => p.species === 'grass' && p.growth > 0.1);
      for (let i = 0; i < 6 && grass.length; i++) {
        const idx = Math.floor(rng() * grass.length);
        const p = grass.splice(idx, 1)[0];
        p.growth = Math.max(0, p.growth - 0.1);
        grazed++;
      }
      // Birds return with gifts a few game-days later
      world.delayedEvents.push({
        kind: 'birdGift',
        fireAt: world.time.gameTime + world.time.dayLength * 2.5,
      });
      return {
        message: grazed
          ? `候鸟落脚并啃食了 ${grazed} 丛草，留下几枚羽尘。`
          : '候鸟落脚又启程，留下几枚闪亮的羽尘。',
      };
    },
    decline() {
      return '候鸟转向远方，草地安然无恙。';
    },
  },
  {
    id: 'mechanicalVisitor',
    title: '机械访客',
    body: '一台小小的维修机器人路过。它可帮忙巡查设施，并留下一些可用的星尘零件。',
    acceptLabel: '欢迎停靠',
    declineLabel: '不必了',
    weight: 0.9,
    apply(world, rng) {
      world.resources.stardust += 9;
      world.modifiers.machineScore = (world.modifiers.machineScore ?? 0) + 1;
      // Repair a weak plant
      const weak = world.plants.filter((p) => p.health < 0.7);
      if (weak.length) {
        const p = weak[Math.floor(rng() * weak.length)];
        p.health = Math.min(1, p.health + 0.35);
        return {
          message: '机器人修好了附近一株植物，留下零件离去。',
          impact: p.position.normal,
        };
      }
      const n = randomOnSphere(v3(), rng);
      return { message: '机器人转了一圈，卸下几枚零件星尘。', impact: n };
    },
    decline() {
      return '机器人礼貌地驶向远方。';
    },
  },
  {
    id: 'planetWhisper',
    title: '星球低语',
    body: '星球似乎在请求一片更浓的绿意。种下几棵树，也许会得到回报。',
    acceptLabel: '为它种树',
    declineLabel: '下次吧',
    weight: 1.1,
    apply(world, rng) {
      const n = randomOnSphere(v3(), rng);
      for (let i = 0; i < 3; i++) {
        const jitter = randomOnSphere(v3(), rng);
        const mixed = normalize(
          v3(),
          v3(
            n.x + (jitter.x - n.x) * 0.18,
            n.y + (jitter.y - n.y) * 0.18,
            n.z + (jitter.z - n.z) * 0.18,
          ),
        );
        world.plants.push(makePlantForEvent('tree', mixed, 0.15 + rng() * 0.1));
      }
      world.resources.stardust += 5;
      world.delayedEvents.push({
        kind: 'whisperGift',
        fireAt: world.time.gameTime + world.time.dayLength * 1.8,
      });
      return { message: '三株新树扎根了。星球发出满足的轻响。', impact: n };
    },
    decline() {
      return '低语渐渐散去。';
    },
  },
  {
    id: 'gentleRain',
    title: '温柔的雨',
    body: '云层聚拢，一场及时雨即将落下。湖泊会丰盈一些。',
    acceptLabel: '迎接雨水',
    declineLabel: '避开云层',
    weight: 1,
    apply(world) {
      for (const lake of world.planet.lakes) {
        lake.water = Math.min(1, lake.water + 0.22);
      }
      return { message: '细雨落下，湖面微微上涨。' };
    },
    decline() {
      return '云从旁边飘走了。';
    },
  },
  {
    id: 'wildHarvest',
    title: '丰饶时刻',
    body: '生态稳定，动物与植物都在繁荣。收下这份自然的馈赠？',
    acceptLabel: '接受馈赠',
    declineLabel: '留给星球',
    weight: 0.85,
    apply(world, rng) {
      const gain = 6 + Math.floor(world.stats.stability * 10);
      world.resources.stardust += gain;
      // Slight heal on a few plants
      for (let i = 0; i < 4 && i < world.plants.length; i++) {
        const p = world.plants[Math.floor(rng() * world.plants.length)];
        p.health = Math.min(1, p.health + 0.12);
        p.growth = Math.min(1, p.growth + 0.06);
      }
      return { message: `自然回赠了 ${gain} 枚星尘。` };
    },
    decline() {
      return '你选择把丰饶留给星球本身。';
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
