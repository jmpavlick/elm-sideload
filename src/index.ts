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
        // Format error message based on error type
        let errorMessage: string
        
        if (typeof error === "string") {
          // String error codes like "noElmHome", "fileNotFound", etc.
          errorMessage = error
        } else if (typeof error === "object" && error !== null && "type" in error) {
          // GitIOError objects with type and additional context
          const gitError = error as any
          switch (gitError.type) {
            case "repoNotFound":
              errorMessage = `Repository not found: ${gitError.url}`
              break
            case "shaNotFound":
              errorMessage = `SHA not found: ${gitError.sha}\nRecent commits:\n${gitError.recentCommits.join("\n")}`
              break
            case "dirtyRepo":
              errorMessage = `Repository has uncommitted changes:\n${gitError.status}`
              break
            case "networkError":
              errorMessage = `Network error: ${gitError.message}`
              break
            case "cloneError":
              errorMessage = `Failed to clone ${gitError.url}: ${gitError.message}`
              break
            case "checkoutError":
              errorMessage = `Failed to checkout ${gitError.sha}: ${gitError.message}`
              break
            case "pullError":
              errorMessage = `Failed to pull: ${gitError.message}`
              break
            case "commandError":
              errorMessage = `Git command failed (${gitError.command}): ${gitError.message}`
              break
            default:
              errorMessage = JSON.stringify(error, null, 2)
          }
        } else {
          // Fallback for unexpected error types
          errorMessage = JSON.stringify(error, null, 2)
        }
        
        console.error(`Error: ${errorMessage}`)
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
