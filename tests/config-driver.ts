// Subprocess driver for the configuration tests.
//
// This file is deliberately NOT named `*.test.ts`: it is never collected by the test runner, it is
// only ever executed as a child process by `config.test.ts`. `tsx` resolves `../src/config.js` to the
// TypeScript source, so the tests exercise the real module rather than a copy of its logic.
//
// Contract with the parent process:
//   * exactly one line on stdout, the resolved configuration as JSON;
//   * nothing else may ever reach stdout, because a real MCP server uses stdout for the stdio
//     protocol and anything printed there would corrupt the session;
//   * diagnostics go to stderr only;
//   * the exit code is 0 on success and 1 if resolution itself throws.
import { loadConfig } from "../src/config.js"

try {
  const result = loadConfig(process.argv.slice(2))
  process.stdout.write(JSON.stringify(result.config) + "\n")
} catch (error) {
  process.stderr.write("[config-driver] loadConfig threw: " + error + "\n")
  process.exit(1)
}
