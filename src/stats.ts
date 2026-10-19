import { existsSync, mkdirSync } from "fs"
import { join } from "path"

import type { ToolKind } from "./types.js"

export interface StatsHourlyRecord {
  year: number
  month: number
  day: number
  hour: number
  dayOfWeek: number
  searchCount: number
  fetchCount: number
  totalCount: number
}

export interface StatsQueryResult {
  records: StatsHourlyRecord[]
  totalCount: number
  searchCount: number
  fetchCount: number
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
  all(...params: (string | number | null)[]): Record<string, unknown>[]
}

export class SearchStatsRecorder {
  private enabled: boolean
  private configDir: string
  private db: SqliteDatabase | null = null
  private initialized = false
  private disableReason: string | null = null

  constructor(enabled: boolean, configDir: string) {
    this.enabled = enabled
    this.configDir = configDir
    this.disableReason = enabled
      ? null
      : "Search stats is disabled in configuration (searchStatsEnabled is false)"
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

      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true })
      }

      this.db = new DatabaseSync(join(this.configDir, "data.db"))

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tool_stats (
          year INTEGER NOT NULL,
          month INTEGER NOT NULL,
          day INTEGER NOT NULL,
          hour INTEGER NOT NULL,
          day_of_week INTEGER NOT NULL,
          tool TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (year, month, day, hour, tool)
        )
      `)

      this.migrateSearchStats()

      this.initialized = true
    } catch {
      this.enabled = false
      this.disableReason = "Search stats database could not be initialized"
    }
  }

  /**
   * Before 0.5.0 the only table was `search_stats`. Its rows are copied into `tool_stats` as
   * `tool='search'`, then the legacy table is dropped. A failed migration is not fatal: the new
   * table still works, and the old rows remain on disk for a later attempt.
   */
  private migrateSearchStats(): void {
    if (!this.db) return
    try {
      const legacy = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_stats'")
        .all()
      if (legacy.length === 0) return

      this.db.exec(`
        INSERT INTO tool_stats (year, month, day, hour, day_of_week, tool, count)
        SELECT year, month, day, hour, day_of_week, 'search', count FROM search_stats WHERE true
        ON CONFLICT (year, month, day, hour, tool)
        DO UPDATE SET count = count + excluded.count
      `)
      this.db.exec("DROP TABLE search_stats")
    } catch {
      // Keep the legacy table intact; the new table is still usable.
    }
  }

  record(kind: ToolKind): void {
    if (!this.enabled || !this.initialized || !this.db) return
    try {
      const now = new Date()
      this.db
        .prepare(
          `INSERT INTO tool_stats (year, month, day, hour, day_of_week, tool, count)
           VALUES (?, ?, ?, ?, ?, ?, 1)
           ON CONFLICT (year, month, day, hour, tool)
           DO UPDATE SET count = count + 1`,
        )
        .run(
          now.getFullYear(),
          now.getMonth() + 1,
          now.getDate(),
          now.getHours(),
          now.getDay(),
          kind,
        )
    } catch {
      // Statistics must never affect the main flow.
    }
  }

  queryStats(from: Date, to: Date): StatsQueryResult {
    const status = this.getStatus()
    if (!status.available) {
      return {
        records: [],
        totalCount: 0,
        searchCount: 0,
        fetchCount: 0,
        available: false,
        unavailableReason: status.reason,
      }
    }

    try {
      const fromKey = hourKey(from)
      const toKey = hourKey(to)

      const rows = this.db!.prepare(`
        SELECT year, month, day, hour, day_of_week, tool, count
        FROM tool_stats
        WHERE (year * 1000000 + month * 10000 + day * 100 + hour) >= ?
          AND (year * 1000000 + month * 10000 + day * 100 + hour) <= ?
        ORDER BY year, month, day, hour, tool
      `).all(fromKey, toKey)

      const byHour = new Map<string, StatsHourlyRecord>()
      for (const row of rows) {
        const year = Number(row.year)
        const month = Number(row.month)
        const day = Number(row.day)
        const hour = Number(row.hour)
        const key = `${year}-${month}-${day}-${hour}`
        let record = byHour.get(key)
        if (!record) {
          record = {
            year,
            month,
            day,
            hour,
            dayOfWeek: Number(row.day_of_week),
            searchCount: 0,
            fetchCount: 0,
            totalCount: 0,
          }
          byHour.set(key, record)
        }
        const count = Number(row.count)
        if (row.tool === "fetch") {
          record.fetchCount += count
        } else {
          record.searchCount += count
        }
        record.totalCount += count
      }

      const records = [...byHour.values()]
      return {
        records,
        totalCount: records.reduce((sum, record) => sum + record.totalCount, 0),
        searchCount: records.reduce((sum, record) => sum + record.searchCount, 0),
        fetchCount: records.reduce((sum, record) => sum + record.fetchCount, 0),
        available: true,
        unavailableReason: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        records: [],
        totalCount: 0,
        searchCount: 0,
        fetchCount: 0,
        available: false,
        unavailableReason: `Database query failed: ${message}`,
      }
    }
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // A close failure must not affect shutdown.
    }
    this.db = null
    this.initialized = false
  }
}

function hourKey(date: Date): number {
  return date.getFullYear() * 1_000_000 +
    (date.getMonth() + 1) * 10_000 +
    date.getDate() * 100 +
    date.getHours()
}
