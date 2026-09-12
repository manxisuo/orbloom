import type { SaveGame } from './types';
import { SCHEMA_VERSION } from './types';

type AnyRecord = Record<string, unknown>;

/**
 * Migrate raw stored payloads to the current schema.
 * Add steps here when SCHEMA_VERSION increases.
 */
export function migrateSave(raw: unknown): SaveGame {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Save data is not an object');
  }
  let data = { ...(raw as AnyRecord) };
  let version = Number(data.schemaVersion ?? 0);
  if (!Number.isFinite(version) || version < 1) {
    throw new Error(`Unsupported save schemaVersion: ${String(data.schemaVersion)}`);
  }

  // Example for future v1 → v2:
  // if (version === 1) { data = migrateV1ToV2(data); version = 2; }

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Save schemaVersion ${version} is newer than supported ${SCHEMA_VERSION}. Please update the game.`,
    );
  }

  if (version !== SCHEMA_VERSION) {
    throw new Error(`No migration path from schemaVersion ${version} to ${SCHEMA_VERSION}`);
  }

  return data as unknown as SaveGame;
}
