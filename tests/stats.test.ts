import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { SearchStatsRecorder } from "../src/stats.js"

test("the legacy search_stats table is migrated into tool_stats and fetch counts are recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fsl-stats-test-"))

  try {
    const sqlite = await import("node:sqlite")
    const db = new sqlite.DatabaseSync(join(dir, "data.db"))
    db.exec(`
      CREATE TABLE search_stats (
        year INTEGER NOT NULL,
        month INTEGER NOT NULL,
        day INTEGER NOT NULL,
        hour INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (year, month, day, hour)
      )
    `)
    db.prepare("INSERT INTO search_stats VALUES (?, ?, ?, ?, ?, ?)").run(2026, 10, 19, 9, 1, 3)
    db.close()

    const stats = new SearchStatsRecorder(true, dir)
    await stats.init()
    stats.record("fetch")

    const result = stats.queryStats(
      new Date(2026, 9, 19, 0, 0, 0),
      new Date(2026, 9, 19, 23, 59, 59),
    )

    assert.equal(result.available, true)
    assert.equal(result.searchCount, 3, "legacy rows must survive as search counts")
    assert.equal(result.fetchCount, 1, "new fetch counts must be recorded separately")
    assert.equal(result.totalCount, 4)
    assert.equal(result.records.length, 2, "the migrated hour and the fetched hour must both appear")

    stats.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
