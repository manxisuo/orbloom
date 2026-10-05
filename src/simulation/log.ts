import type { GameWorldState, LogEntry, LogKind } from '../shared/types';
import { nextId } from '../shared/math';

export function pushLog(world: GameWorldState, text: string, kind: LogKind = 'life'): void {
  const day = Math.floor(world.time.gameTime / world.time.dayLength) + 1;
  const entry: LogEntry = {
    id: nextId('log'),
    gameTime: world.time.gameTime,
    day,
    text: `第 ${day} 天，${text}`,
    kind,
  };
  world.log.push(entry);
  trimLog(world);
}

function isReplayPin(entry: LogEntry): boolean {
  const { kind, text } = entry;
  return (
    kind === 'personality' ||
    (kind === 'plant' && text.includes('种下')) ||
    text.includes('兔子来到了') ||
    text.includes('小生命') ||
    text.includes('蜜蜂') ||
    (kind === 'event' && (text.includes('流星') || text.includes('机械'))) ||
    text.includes('候鸟如约')
  );
}

function trimLog(world: GameWorldState): void {
  if (world.log.length <= 200) return;
  let extra = world.log.length - 200;
  for (let i = 0; i < world.log.length && extra > 0; ) {
    if (isReplayPin(world.log[i])) {
      i += 1;
      continue;
    }
    world.log.splice(i, 1);
    extra -= 1;
  }
}
