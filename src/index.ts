#!/usr/bin/env node

import { createRuntime } from "./cli"
import { executeCommand } from "./impl"

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  const runtimeResult = createRuntime(argv)

  if (runtimeResult.isErr()) {
    console.error(`Error: ${runtimeResult.error}`)
    process.exit(1)
  }

  const runtime = runtimeResult.value
  const executionResult = executeCommand(runtime)

  if (executionResult.isErr()) {
    console.error(`Error: ${executionResult.error}`)
    process.exit(1)
  }

  const result = executionResult.value
  console.log(result.message)

  if (result.changes && result.changes.length > 0) {
    console.log("\nChanges:")
    result.changes.forEach((change) => {
      console.log(`  ${change.packageName}: ${change.action} from ${change.source}`)
    })
  }

  process.exit(result.success ? 0 : 1)
}

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Unexpected error:", error)
    process.exit(1)
  })
}
