import { CommandError } from "./types"

export function formatError(error: CommandError): string {
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
                try {
                    return JSON.stringify(error, null, 2)
                } catch {
                    return `Unknown error: ${String(error)}`
                }
        }
    }

    // Fallback for unexpected error types
    try {
        return JSON.stringify(error, null, 2)
    } catch {
        return `Unknown error: ${String(error)}`
    }
}