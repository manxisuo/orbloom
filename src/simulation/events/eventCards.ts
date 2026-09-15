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
    body: '一颗流星划过夜空。矿石星尘就在眼前，但坠落点附近的植被一定会被灼伤。',
    acceptLabel: '迎接流星',
    declineLabel: '避开',
    weight: 1,
    apply(world, rng) {
      const n = randomOnSphere(v3(), rng);
      world.resources.stardust += 12;
      const scorched = world.plants
        .map((p) => ({ p, d: ang(p.position.normal, n) }))
        .filter((x) => x.d < 0.35)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      for (const { p } of scorched) {
        p.health = Math.max(0, p.health - 0.45);
        p.growth = Math.max(0, p.growth - 0.3);
      }
      return {
        message: scorched.length
          ? `流星带来 12 枚星尘，也灼伤了 ${scorched.length} 株植被。`
          : '流星落在荒地上，只留下闪亮的星尘。',
        impact: n,
      };
    },
    decline() {
      return '流星擦过大气层，矿石星尘随之散失。';
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
    body: '风里带来一包陌生的种子。它们长得快，也会抢走邻近植物的养分。',
    acceptLabel: '种下试试',
    declineLabel: '丢掉',
    weight: 1.2,
    apply(world, rng) {
      if (world.plants.length >= 400) {
        return { message: '星球太挤了，种子无处落脚。' };
      }
      const cost = 2;
      if (world.resources.stardust < cost) {
        return { message: '星尘不足，无法培育这批种子。' };
      }
      world.resources.stardust -= cost;
      const n = randomOnSphere(v3(), rng);
      const species = rng() < 0.45 ? 'flower' : 'grass';
      // Established neighbours lose nutrients to the fast-growing stranger
      const crowded = world.plants
        .map((p) => ({ p, d: ang(p.position.normal, n) }))
        .filter((x) => x.d < 0.3 && x.p.growth > 0.1)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      for (let i = 0; i < 3; i++) {
        const jitter = randomOnSphere(v3(), rng);
        const p = makePlantForEvent(species, mix(n, jitter, 0.15));
        world.plants.push(p);
      }
      for (const { p } of crowded) {
        p.growth = Math.max(0, p.growth - 0.12);
        p.health = Math.max(0, p.health - 0.05);
      }
      return {
        message: crowded.length
          ? `种子长成${species === 'flower' ? '一片花' : '一片草'}，也吸走了邻近植物的养分。`
          : `奇怪的种子长成了${species === 'flower' ? '一片花' : '一片草'}。`,
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
    body: '一台小小的维修机器人路过。它愿意修好虚弱的植株，但铺设零件会压坏一些草，也会让星球更偏机械。',
    acceptLabel: '欢迎停靠',
    declineLabel: '不必了',
    weight: 0.9,
    apply(world, rng) {
      world.resources.stardust += 4;
      world.modifiers.machineScore = (world.modifiers.machineScore ?? 0) + 1;
      // Machinery claims ground from the grass it rolls over
      const grass = world.plants.filter((p) => p.species === 'grass' && p.growth > 0.1);
      let cleared = 0;
      for (let i = 0; i < 3 && grass.length; i++) {
        const idx = Math.floor(rng() * grass.length);
        const p = grass.splice(idx, 1)[0];
        p.growth = Math.max(0, p.growth - 0.12);
        p.health = Math.max(0, p.health - 0.05);
        cleared++;
      }
      // Repair weak plants while it is here
      const weak = world.plants.filter((p) => p.health < 0.7).slice(0, 2);
      for (const p of weak) p.health = Math.min(1, p.health + 0.3);
      const impact = weak[0]?.position.normal ?? randomOnSphere(v3(), rng);
      const parts = cleared ? `，也压坏了 ${cleared} 丛草` : '';
      return {
        message: weak.length
          ? `机器人修好了 ${weak.length} 株植物，留下 4 枚零件星尘${parts}。`
          : `机器人转了一圈，卸下 4 枚零件星尘${parts}。`,
        impact,
      };
    },
    decline() {
      return '机器人礼貌地驶向远方，草地与植株保持原样。';
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
      const cost = 4;
      if (world.resources.stardust < cost) {
        return { message: '星尘不足，无法为它种下树苗。' };
      }
      world.resources.stardust -= cost;
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
    body: '云层聚拢，一场及时雨即将落下。湖泊会丰盈，但连日阴云也会让植物受一段凉。',
    acceptLabel: '迎接雨水',
    declineLabel: '避开云层',
    weight: 1,
    apply(world) {
      for (const lake of world.planet.lakes) {
        lake.water = Math.min(1, lake.water + 0.22);
      }
      world.modifiers.coldDays = Math.max(world.modifiers.coldDays, 1.5);
      return { message: '细雨落下，湖面微涨；连日阴云让植物受凉，生长放缓。' };
    },
    decline(world) {
      if (world.modifiers.droughtDays > 0) {
        world.modifiers.droughtDays += 1;
        return { message: '你避开了云层，干旱少了缓解，继续蔓延。' };
      }
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
      // Harvesting takes a little back from the ecosystem
      for (let i = 0; i < 4 && i < world.plants.length; i++) {
        const p = world.plants[Math.floor(rng() * world.plants.length)];
        p.health = Math.max(0, p.health - 0.08);
        p.growth = Math.max(0, p.growth - 0.06);
      }
      return { message: `自然回赠了 ${gain} 枚星尘，收获也让植被付出了一点代价。` };
    },
    decline(world, rng) {
      // Leaving the bounty to the planet strengthens it instead
      let healed = 0;
      for (let i = 0; i < 4 && i < world.plants.length; i++) {
        const p = world.plants[Math.floor(rng() * world.plants.length)];
        p.health = Math.min(1, p.health + 0.1);
        p.growth = Math.min(1, p.growth + 0.06);
        healed++;
      }
      return { message: healed ? '你把丰饶留给星球，植被更健康了。' : '你选择把丰饶留给星球本身。' };
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
