// End-to-end protocol tests: the real server process is spawned over stdio and exercised with the
// official v2 client. These tests prove that the server actually serves the 2026-07-28 era (not just
// that the package version changed) and that the legacy era still connects.
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"

const testsDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(testsDir)
const entryPoint = join(projectRoot, "src", "index.ts")

function childEnvironment(home: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith("WEBSEARCH_") || key.startsWith("DEEPSEEK_")) continue
    env[key] = value
  }
  env.USERPROFILE = home
  env.HOME = home
  env.DEEPSEEK_API_KEY = "sk-test-key"
  return env
}

async function connectWith(
  home: string,
  options: { versionNegotiation?: { mode: "auto" | "legacy" } },
): Promise<{ client: Client; era: string | undefined }> {
  const client = new Client(
    { name: "fsl-protocol-test", version: "1.0.0" },
    options.versionNegotiation ? { versionNegotiation: options.versionNegotiation } : {},
  )
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", entryPoint],
    cwd: projectRoot,
    env: childEnvironment(home),
    stderr: "pipe",
  })
  await client.connect(transport)
  return { client, era: client.getProtocolEra() }
}

test("the server negotiates the 2026-07-28 era and lists three tools", { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "fsl-protocol-modern-"))
  let client: Client | undefined

  try {
    const connected = await connectWith(home, { versionNegotiation: { mode: "auto" } })
    client = connected.client

    assert.equal(connected.era, "modern", "serveStdio must actually serve the modern era")

    const tools = await client.listTools()
    const names = tools.tools.map((tool) => tool.name).sort()
    assert.deepEqual(names, ["web_fetch", "web_search", "web_search_stats"])

    const searchTool = tools.tools.find((tool) => tool.name === "web_search")
    assert.ok(searchTool, "web_search must be listed")
    assert.ok(searchTool.inputSchema, "web_search must advertise an input schema")
    assert.equal(
      (searchTool.inputSchema as { type?: string }).type,
      "object",
      "the advertised input schema must be a JSON object schema",
    )
  } finally {
    await client?.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test("the same server still serves a legacy-era client", { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "fsl-protocol-legacy-"))
  let client: Client | undefined

  try {
    const connected = await connectWith(home, { versionNegotiation: { mode: "legacy" } })
    client = connected.client

    assert.equal(connected.era, "legacy", "the default legacy handshake must still connect")
    const tools = await client.listTools()
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["web_fetch", "web_search", "web_search_stats"],
    )
  } finally {
    await client?.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test("web_fetch returns a structured error for an invalid URL without touching the network", { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "fsl-protocol-error-"))
  let client: Client | undefined

  try {
    const connected = await connectWith(home, { versionNegotiation: { mode: "auto" } })
    client = connected.client

    const result = await client.callTool({
      name: "web_fetch",
      arguments: { url: "file:///etc/passwd" },
    })

    assert.equal(result.isError, true)
    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
    assert.match(text, /invalid_request/)
    assert.match(text, /http or https/)
  } finally {
    await client?.close()
    rmSync(home, { recursive: true, force: true })
  }
})
