import type { SystemBackup, SystemStorage } from "../../shared/system-status";
import { nodeBuiltin } from "./runtime";
import type { RuntimeEnv } from "./types";

/** The slice of `node:fs/promises` the adapter reads; tests pass a fake. */
export interface SystemFs {
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  statfs(path: string): Promise<{ bsize: number; blocks: number; bavail: number }>;
  readdir(path: string): Promise<string[]>;
}

export const DEFAULT_DB_PATH = "/data/db/rr.sqlite";
/** Nightly backup files written by deploy/nas/backup/backup.sh. */
const BACKUP_FILE = /^rr-\d{8}-\d{4}\.sqlite(\.gz)?$/;

/** Real file system on Node (rr-api), null on Cloudflare Pages. */
export function nodeSystemFs(): SystemFs | null {
  return nodeBuiltin<SystemFs>("node:fs/promises");
}

function parentDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "/";
}

async function sizeOf(fs: SystemFs, path: string): Promise<number | null> {
  try {
    return (await fs.stat(path)).size;
  } catch {
    return null;
  }
}

/** DB + WAL file size and free space on the DB volume. Null when there is no file system. */
export async function loadStorage(
  env: RuntimeEnv,
  fs: SystemFs | null,
): Promise<SystemStorage | null> {
  if (!fs) return null;
  const dbPath = env.DB_PATH?.trim() || DEFAULT_DB_PATH;
  const [databaseBytes, walBytes, disk] = await Promise.all([
    sizeOf(fs, dbPath),
    sizeOf(fs, `${dbPath}-wal`),
    fs.statfs(parentDir(dbPath)).catch(() => null),
  ]);
  if (databaseBytes === null && disk === null) return null;
  return {
    databaseBytes,
    walBytes,
    diskFreeBytes: disk ? disk.bavail * disk.bsize : null,
    diskTotalBytes: disk ? disk.blocks * disk.bsize : null,
  };
}

/**
 * Newest nightly backup in BACKUP_DIR (mounted read-only into rr-api). Null when the directory is
 * not configured or unreadable; a readable directory without a backup file reports nulls inside.
 */
export async function loadBackup(
  env: RuntimeEnv,
  fs: SystemFs | null,
  now: number,
): Promise<SystemBackup | null> {
  const dir = env.BACKUP_DIR?.trim();
  if (!fs || !dir) return null;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return null;
  }
  // File names carry a sortable YYYYMMDD-HHMM stamp, so the newest is the largest name.
  const newest = names
    .filter((name) => BACKUP_FILE.test(name))
    .sort()
    .at(-1);
  if (!newest) return { newestFile: null, newestAt: null, ageSeconds: null };
  try {
    const { mtimeMs } = await fs.stat(`${dir.replace(/\/$/, "")}/${newest}`);
    return {
      newestFile: newest,
      newestAt: new Date(mtimeMs).toISOString(),
      ageSeconds: Math.max(0, Math.round((now - mtimeMs) / 1000)),
    };
  } catch {
    return { newestFile: newest, newestAt: null, ageSeconds: null };
  }
}
