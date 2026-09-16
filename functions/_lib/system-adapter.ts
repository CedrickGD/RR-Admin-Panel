import type { SystemBackup, SystemStorage } from "../../shared/system-status";
import { nodeBuiltin } from "./runtime";
import type { RuntimeEnv } from "./types";

/** The slice of `node:fs/promises` the adapter reads; tests pass a fake. */
export interface SystemFs {
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  statfs(path: string): Promise<{ bsize: number; blocks: number; bavail: number }>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

export const DEFAULT_DB_PATH = "/data/db/rr.sqlite";
/** Nightly backup files written by deploy/nas/backup/backup.sh. */
const BACKUP_FILE = /^rr-\d{8}-\d{4}\.sqlite(\.gz)?$/;
/**
 * Success marker next to the backups, written by backup.sh only after the copy passed PRAGMA
 * integrity_check and gzip -t: one line, "<ISO-8601 UTC> <file name>". A dotfile, so BACKUP_FILE
 * never matches it and the script's retention `find` never deletes it. The compose healthcheck
 * on the backup service reads the same file's mtime (deploy/nas/compose.yml).
 */
export const BACKUP_MARKER = ".last-success";

export interface BackupMarker {
  /** When the verified backup was written, as an ISO timestamp. */
  at: string;
  /** The archive it verified, e.g. "rr-20260916-0315.sqlite.gz". */
  file: string;
}

/**
 * The marker's line, or null for anything that is not exactly "<ISO date> <backup file name>".
 * Strict on purpose: a marker in any other shape is ignored, and the page then falls back to
 * the newest file with `verified: false` rather than trusting a line it cannot read.
 */
export function parseBackupMarker(text: string): BackupMarker | null {
  const [at, file, ...rest] = text.trim().split(/\s+/);
  if (!at || !file || rest.length > 0) return null;
  const time = Date.parse(at);
  if (!Number.isFinite(time) || !BACKUP_FILE.test(file)) return null;
  return { at: new Date(time).toISOString(), file };
}

async function readBackupMarker(fs: SystemFs, path: string): Promise<BackupMarker | null> {
  try {
    return parseBackupMarker(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

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
 * The last verified backup in BACKUP_DIR (mounted read-only into rr-api), read from the success
 * marker backup.sh writes. Without a marker: the newest nightly backup file by name and its
 * mtime, flagged `verified: false` — a file was written, whether it is intact is not known. Null
 * when the directory is not configured or unreadable; a readable directory without a marker or a
 * backup file reports nulls inside.
 */
export async function loadBackup(
  env: RuntimeEnv,
  fs: SystemFs | null,
  now: number,
): Promise<SystemBackup | null> {
  const dir = env.BACKUP_DIR?.trim();
  if (!fs || !dir) return null;
  const base = dir.replace(/\/$/, "");
  const marker = await readBackupMarker(fs, `${base}/${BACKUP_MARKER}`);
  if (marker)
    return {
      newestFile: marker.file,
      newestAt: marker.at,
      ageSeconds: Math.max(0, Math.round((now - Date.parse(marker.at)) / 1000)),
      verified: true,
    };
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
  if (!newest) return { newestFile: null, newestAt: null, ageSeconds: null, verified: false };
  try {
    const { mtimeMs } = await fs.stat(`${base}/${newest}`);
    return {
      newestFile: newest,
      newestAt: new Date(mtimeMs).toISOString(),
      ageSeconds: Math.max(0, Math.round((now - mtimeMs) / 1000)),
      verified: false,
    };
  } catch {
    return { newestFile: newest, newestAt: null, ageSeconds: null, verified: false };
  }
}
