#!/usr/bin/env node

import { createRuntime } from "./cli"
import { executeCommand } from "./impl"
import { CommandError } from "./types"

function formatError(error: CommandError): string {
  if (typeof error === "string") {
    // String error codes like "noElmHome", "fileNotFound", etc.
    return error
  }

  if (typeof error === "object" && error !== null && "type" in error) {
    // GitIOError objects with type and additional context
    const gitError = error as any
    switch (gitError.type) {
      case "repoNotFound":
        return `Repository not found: ${gitError.url}`
      case "shaNotFound":
        return `SHA not found: ${gitError.sha}\nRecent commits:\n${gitError.recentCommits.join("\n")}`
      case "dirtyRepo":
        return `Repository has uncommitted changes:\n${gitError.status}`
      case "networkError":
        return `Network error: ${gitError.message}`
      case "cloneError":
        return `Failed to clone ${gitError.url}: ${gitError.message}`
      case "checkoutError":
        return `Failed to checkout ${gitError.sha}: ${gitError.message}`
      case "pullError":
        return `Failed to pull: ${gitError.message}`
      case "commandError":
        return `Git command failed (${gitError.command}): ${gitError.message}`
      default:
        return JSON.stringify(error, null, 2)
    }
  }

  // Fallback for unexpected error types
  return JSON.stringify(error, null, 2)
}

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
        console.error(`Error: ${formatError(error)}`)
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
