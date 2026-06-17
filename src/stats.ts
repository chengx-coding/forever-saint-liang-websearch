import { existsSync, mkdirSync } from "fs"
import { join } from "path"

function isNodeVersionSufficient(): boolean {
  const major = Number.parseInt(process.versions.node.split(".")[0])
  return major >= 22
}

export interface StatsHourlyRecord {
  year: number
  month: number
  day: number
  hour: number
  dayOfWeek: number
  count: number
}

export interface StatsQueryResult {
  records: StatsHourlyRecord[]
  totalCount: number
  available: boolean
  unavailableReason: string | null
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface SqliteStatement {
  run(...params: (string | number | null)[]): void
  all(...params: (string | number | null)[]): Record<string, number>[]
}

export class SearchStatsRecorder {
  private enabled: boolean
  private configDir: string
  private db: SqliteDatabase | null = null
  private initialized = false
  private disableReason: string | null = null

  constructor(enabled: boolean, configDir: string) {
    if (!enabled) {
      this.enabled = false
      this.configDir = configDir
      this.disableReason = "Search stats is disabled in configuration (searchStatsEnabled is false)"
      return
    }
    if (!isNodeVersionSufficient()) {
      this.enabled = false
      this.configDir = configDir
      this.disableReason = `Node.js version ${process.versions.node} is too old (requires >= 22.0.0 for built-in sqlite)`
      return
    }
    this.enabled = true
    this.configDir = configDir
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  getStatus(): { available: boolean; reason: string | null } {
    if (this.enabled && this.initialized) {
      return { available: true, reason: null }
    }
    if (this.enabled && !this.initialized) {
      return { available: false, reason: "Search stats is enabled but database has not been initialized yet" }
    }
    return { available: false, reason: this.disableReason }
  }

  async init(): Promise<void> {
    if (!this.enabled || this.initialized) return
    try {
      const sqlite = await import("node:sqlite")
      const DatabaseSync = (
        sqlite as { DatabaseSync: new (path: string) => SqliteDatabase }
      ).DatabaseSync

      const dir = this.configDir
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const dbPath = join(dir, "data.db")
      this.db = new DatabaseSync(dbPath)

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS search_stats (
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          day INTEGER NOT NULL,
          hour INTEGER NOT NULL,
          day_of_week INTEGER NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (year, month, day, hour)
        )
      `)

      this.initialized = true
    } catch {
      this.enabled = false
    }
  }

  recordSearch(): void {
    if (!this.enabled || !this.initialized || !this.db) return
    try {
      const now = new Date()
      this.db
        .prepare(
          `INSERT INTO search_stats (year, month, day, hour, day_of_week, count)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT (year, month, day, hour)
           DO UPDATE SET count = count + 1`,
        )
        .run(
          now.getFullYear(),
          now.getMonth() + 1,
          now.getDate(),
          now.getHours(),
          now.getDay(),
        )
    } catch {
      // silently ignore — must never affect main flow
    }
  }

  queryStats(from: Date, to: Date): StatsQueryResult {
    const status = this.getStatus()
    if (!status.available) {
      return { records: [], totalCount: 0, available: false, unavailableReason: status.reason }
    }

    try {
      const fromKey = from.getFullYear() * 1_000_000 + (from.getMonth() + 1) * 10_000 + from.getDate() * 100 + from.getHours()
      const toKey = to.getFullYear() * 1_000_000 + (to.getMonth() + 1) * 10_000 + to.getDate() * 100 + to.getHours()

      const rows = this.db!.prepare(`
        SELECT year, month, day, hour, day_of_week, count
        FROM search_stats
        WHERE (year * 1000000 + month * 10000 + day * 100 + hour) >= ?
          AND (year * 1000000 + month * 10000 + day * 100 + hour) <= ?
        ORDER BY year, month, day, hour
      `).all(fromKey, toKey)

      const records: StatsHourlyRecord[] = rows.map(r => ({
        year: r.year,
        month: r.month,
        day: r.day,
        hour: r.hour,
        dayOfWeek: r.day_of_week,
        count: r.count,
      }))
      const totalCount = records.reduce((sum, r) => sum + r.count, 0)

      return { records, totalCount, available: true, unavailableReason: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { records: [], totalCount: 0, available: false, unavailableReason: `Database query failed: ${message}` }
    }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // silently ignore
    }
    this.db = null
  }
}
