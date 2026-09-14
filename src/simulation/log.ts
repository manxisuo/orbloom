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
  if (world.log.length > 200) world.log.splice(0, world.log.length - 200);
}
