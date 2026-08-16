/**
 * Rebuild lightweight session-list projections from the shared JSONL store.
 *
 * The cache is derived state: session logs remain authoritative, and this
 * command only writes the title and session-list metadata rows needed by cold
 * Web listings. It preserves every unrelated cache row and writes the result
 * through an atomic rename.
 *
 * Run with `--apply` to write; without it the command reports the changes it
 * would make. `DSH_HOME` selects the Harness home, defaulting to `~/.dsh`.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

interface SessionHeader {
  type: 'session'
  version: number
  id: string
  createdAt: number
  cwd?: string
}

interface SessionEvent {
  type: string
  seq: number
  time: number
  data?: {
    title?: unknown
    source?: { kind?: unknown }
  }
}

interface CacheRow {
  ver: number
  seq: number
  val: unknown
}

interface CacheRecord {
  identity: { createdAt: number; cwd?: string }
  rows: Record<string, CacheRow>
}

interface CacheDocument {
  unit: { name: string; version: number }
  global: null
  tables: { sessions: Record<string, CacheRecord> }
}

const ZSTD_MAGIC = 0xfd2fb528
const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const sessionsRoot = process.env.DSH_SESSION_ROOT?.trim() || join(dshHome, 'sessions')
const cachePath = process.env.DSH_PROJECTION_CACHE?.trim() || join(dshHome, 'storages', 'session_projcache.json')
const apply = process.argv.includes('--apply')

function frameOffsets(bytes: Buffer): number[] {
  const offsets: number[] = []
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    if (bytes.readUInt32LE(offset) === ZSTD_MAGIC) offsets.push(offset)
  }
  return offsets
}

function readLog(path: string): { header: SessionHeader; events: SessionEvent[] } {
  const bytes = readFileSync(path)
  const offsets = frameOffsets(bytes)
  if (offsets.length === 0) throw new Error(`no zstd frame in ${path}`)
  const lines: string[] = []
  offsets.forEach((start, index) => {
    const end = offsets[index + 1] ?? bytes.length
    lines.push(...zstdDecompressSync(bytes.subarray(start, end)).toString('utf8').split('\n').filter(Boolean))
  })
  const [headerLine, ...eventLines] = lines
  if (headerLine === undefined) throw new Error(`empty session log ${path}`)
  const header = JSON.parse(headerLine) as SessionHeader
  if (header.type !== 'session' || typeof header.id !== 'string') throw new Error(`invalid session header ${path}`)
  const events = eventLines.map(line => JSON.parse(line) as SessionEvent)
  return { header, events }
}

function sessionLogs(): string[] {
  if (!existsSync(sessionsRoot)) return []
  const paths: string[] = []
  for (const workspace of readdirSync(sessionsRoot)) {
    const workspacePath = join(sessionsRoot, workspace)
    if (!statSync(workspacePath).isDirectory()) continue
    for (const session of readdirSync(workspacePath)) {
      const path = join(workspacePath, session, 'session.jsonl.zstd')
      if (existsSync(path) && statSync(path).isFile()) paths.push(path)
    }
  }
  return paths
}

function loadCache(): CacheDocument {
  if (!existsSync(cachePath)) {
    return { unit: { name: 'session_projcache', version: 3 }, global: null, tables: { sessions: {} } }
  }
  const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as CacheDocument
  if (parsed.unit?.name !== 'session_projcache' || parsed.tables?.sessions === undefined) {
    throw new Error(`unexpected projection cache format: ${cachePath}`)
  }
  return parsed
}

function projectionFor(header: SessionHeader, events: readonly SessionEvent[]): CacheRecord {
  const title = [...events].reverse().find(event => event.type === 'session/title')?.data?.title
  const userPrompts = events
    .filter(event => event.type === 'user/message' && event.data?.source?.kind === 'user')
    .map(event => event.time)
    .filter((time): time is number => Number.isFinite(time))
  const seqs = events
    .map(event => event.seq)
    .filter((value): value is number => Number.isSafeInteger(value) && value >= 0)
  const seq = seqs.length === 0 ? -1 : Math.max(...seqs)
  return {
    identity: { createdAt: header.createdAt, ...header.cwd === undefined ? {} : { cwd: header.cwd } },
    rows: {
      title: { ver: 1, seq, val: typeof title === 'string' && title.length > 0 ? title : null },
      sessionListMetadata: {
        ver: 1,
        seq,
        val: {
          blank: !events.some(event => event.type === 'turn/start'),
          lastPromptAt: userPrompts.length === 0 ? null : Math.max(...userPrompts),
        },
      },
    },
  }
}

const cache = loadCache()
let changed = 0
let skipped = 0
for (const path of sessionLogs()) {
  try {
    const { header, events } = readLog(path)
    const next = projectionFor(header, events)
    const prior = cache.tables.sessions[header.id]
    const rows = { ...(prior?.rows ?? {}), ...next.rows }
    const replacement: CacheRecord = { identity: next.identity, rows }
    if (JSON.stringify(prior) !== JSON.stringify(replacement)) {
      cache.tables.sessions[header.id] = replacement
      changed += 1
    }
  } catch (error) {
    skipped += 1
    console.warn(`skip ${path}: ${String(error)}`)
  }
}

console.log(`session projection cache: ${changed} session(s) ${apply ? 'updated' : 'would update'}, ${skipped} skipped`)
if (!apply || changed === 0) process.exit(0)

mkdirSync(join(cachePath, '..'), { recursive: true })
const tempPath = `${cachePath}.migration-${randomUUID()}.tmp`
writeFileSync(tempPath, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
renameSync(tempPath, cachePath)
console.log(`wrote ${cachePath}`)
