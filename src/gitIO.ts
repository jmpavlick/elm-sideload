import { Result, ok, err } from "neverthrow"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

// =============================================================================
// Git IO Error Types
// =============================================================================

export type Error =
  | { type: "repoNotFound"; url: string }
  | { type: "shaNotFound"; sha: string; recentCommits: string[] }
  | { type: "dirtyRepo"; status: string }
  | { type: "networkError"; message: string }
  | { type: "cloneError"; url: string; message: string }
  | { type: "checkoutError"; sha: string; message: string }
  | { type: "pullError"; message: string }
  | { type: "commandError"; command: string; message: string }

// =============================================================================
// Git IO Interface
// =============================================================================

export interface GitIO {
  clone: (url: string, targetDir: string) => Result<void, Error>
  checkout: (repoDir: string, sha: string) => Result<void, Error>
  getCurrentSha: (repoDir: string) => Result<string, Error>
  getRecentCommits: (repoDir: string, count: number) => Result<string[], Error>
  isClean: (repoDir: string) => Result<boolean, Error>
  pull: (repoDir: string) => Result<void, Error>
  resolveBranchToSha: (repoDir: string, branch: string) => Result<string, Error>
  shaExists: (repoDir: string, sha: string) => Result<boolean, Error>
}

// =============================================================================
// Live Implementation
// =============================================================================

const runGitCommand = (command: string, cwd?: string): Result<string, Error> => {
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    return ok(output.trim())
  } catch (error: any) {
    return err({
      type: "commandError",
      command,
      message: error.message || "Unknown git command error",
    })
  }
}

export const createGitIO = (): Result<GitIO, string> => {
  const gitExecutableAvailable = (() => {
    try {
      execSync("git --version", { stdio: "ignore" })
      return true
    } catch {
      return false
    }
  })()

  return !gitExecutableAvailable
    ? err("Could not find the `git` executable; exiting.")
    : ok({
        clone: (url: string, targetDir: string): Result<void, Error> => {
          // Ensure parent directory exists
          const parentDir = path.dirname(targetDir)
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true })
          }

          return runGitCommand(`git clone ${url} ${targetDir}`)
            .map(() => void 0)
            .mapErr((error) => {
              if (error.type === "commandError") {
                // Check if it's a network/repo not found error
                if (error.message.includes("not found") || error.message.includes("does not exist")) {
                  return { type: "repoNotFound", url }
                }
                if (error.message.includes("network") || error.message.includes("connection")) {
                  return { type: "networkError", message: error.message }
                }
                return { type: "cloneError", url, message: error.message }
              }
              return error
            })
        },

        checkout: (repoDir: string, sha: string): Result<void, Error> => {
          return runGitCommand(`git checkout ${sha}`, repoDir)
            .map(() => void 0)
            .mapErr((error) => {
              if (error.type === "commandError") {
                return { type: "checkoutError", sha, message: error.message }
              }
              return error
            })
        },

        getCurrentSha: (repoDir: string): Result<string, Error> => {
          return runGitCommand("git rev-parse HEAD", repoDir)
        },

        getRecentCommits: (repoDir: string, count: number): Result<string[], Error> => {
          return runGitCommand(`git log --oneline -${count}`, repoDir).map((output) =>
            output.split("\n").filter((line) => line.trim() !== "")
          )
        },

        isClean: (repoDir: string): Result<boolean, Error> => {
          return runGitCommand("git status --porcelain", repoDir).map((output) => output.trim() === "")
        },

        pull: (repoDir: string): Result<void, Error> => {
          // Check if we're in detached HEAD state
          return runGitCommand("git symbolic-ref -q HEAD", repoDir)
            .andThen(() => {
              // We're on a branch, safe to pull
              return runGitCommand("git pull", repoDir).map(() => void 0)
            })
            .orElse(() => {
              // We're in detached HEAD (common after checking out a SHA), just fetch
              return runGitCommand("git fetch", repoDir).map(() => void 0)
            })
            .mapErr((error) => {
              if (error.type === "commandError") {
                return { type: "pullError", message: error.message }
              }
              return error
            })
        },

        resolveBranchToSha: (repoDir: string, branch: string): Result<string, Error> => {
          return runGitCommand(`git rev-parse origin/${branch}`, repoDir).orElse(() =>
            runGitCommand(`git rev-parse ${branch}`, repoDir)
          )
        },

        shaExists: (repoDir: string, sha: string): Result<boolean, Error> => {
          return runGitCommand(`git cat-file -e ${sha}`, repoDir)
            .map(() => true)
            .orElse(() => ok(false))
        },
      })
}
