#!/usr/bin/env node

import { createRuntime } from "./cli"
import { executeCommand } from "./impl"

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  await createRuntime(argv)
    .andThen((runtime) => executeCommand(runtime))
    .match(
      (executionResult) => {
        console.log(executionResult.message)

        if (executionResult.changes && executionResult.changes.length > 0) {
          console.log("\nChanges:")
          executionResult.changes.forEach((change) => {
            console.log(`  ${change.packageName}: ${change.action} from ${change.source}`)
          })
        }

        process.exit(0)
      },
      (error) => {
        console.error(`Error: ${error}`)
        process.exit(1)
      }
    )
}

// Only run main if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Unexpected error:", error)
    process.exit(1)
  })
}
