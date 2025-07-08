import { Result, ResultAsync, ok, err } from "neverthrow"
import { exec } from "child_process"
import { promisify } from "util"
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
  clone: (url: string, targetDir: string) => ResultAsync<void, Error>
  checkout: (repoDir: string, sha: string) => ResultAsync<void, Error>
  getCurrentSha: (repoDir: string) => ResultAsync<string, Error>
  getRecentCommits: (repoDir: string, count: number) => ResultAsync<string[], Error>
  isClean: (repoDir: string) => ResultAsync<boolean, Error>
  pull: (repoDir: string) => ResultAsync<void, Error>
  resolveBranchToSha: (repoDir: string, branch: string) => ResultAsync<string, Error>
  shaExists: (repoDir: string, sha: string) => ResultAsync<boolean, Error>
}

// =============================================================================
// Live Implementation
// =============================================================================

const execAsync = promisify(exec)

const runGitCommand = (command: string, cwd?: string): ResultAsync<string, Error> => {
  return ResultAsync.fromPromise(
    execAsync(command, { cwd, encoding: "utf-8" }).then(({ stdout }) => stdout.trim()),
    (error: any) => ({
      type: "commandError" as const,
      command,
      message: error.message || "Unknown git command error",
    })
  )
}

export const createGitIO = (): ResultAsync<GitIO, string> => {
  return ResultAsync.fromPromise(
    execAsync("git --version"),
    (_) => "Could not find the `git` executable; exiting."
  ).map(() => ({
    clone: (url: string, targetDir: string): ResultAsync<void, Error> => {
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
              return { type: "repoNotFound", url } as const
            }
            if (error.message.includes("network") || error.message.includes("connection")) {
              return { type: "networkError", message: error.message } as const
            }
            return { type: "cloneError", url, message: error.message } as const
          }
          return error
        })
    },

    checkout: (repoDir: string, sha: string): ResultAsync<void, Error> =>
      runGitCommand(`git checkout ${sha}`, repoDir)
        .map(() => void 0)
        .mapErr((error) => {
          if (error.type === "commandError") {
            return { type: "checkoutError", sha, message: error.message } as const
          }
          return error
        }),

    getCurrentSha: (repoDir: string): ResultAsync<string, Error> => runGitCommand("git rev-parse HEAD", repoDir),

    getRecentCommits: (repoDir: string, count: number): ResultAsync<string[], Error> =>
      runGitCommand(`git log --oneline -${count}`, repoDir).map((output) =>
        output.split("\n").filter((line) => line.trim() !== "")
      ),

    isClean: (repoDir: string): ResultAsync<boolean, Error> =>
      runGitCommand("git status --porcelain", repoDir).map((output) => output.trim() === ""),

    pull: (repoDir: string): ResultAsync<void, Error> =>
      // Check if we're in detached HEAD state
      runGitCommand("git symbolic-ref -q HEAD", repoDir)
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
            return { type: "pullError", message: error.message } as const
          }
          return error
        }),

    resolveBranchToSha: (repoDir: string, branch: string): ResultAsync<string, Error> =>
      runGitCommand(`git rev-parse origin/${branch}`, repoDir).orElse(() =>
        runGitCommand(`git rev-parse ${branch}`, repoDir)
      ),

    shaExists: (repoDir: string, sha: string): ResultAsync<boolean, Error> =>
      runGitCommand(`git cat-file -e ${sha}`, repoDir)
        .map(() => true)
        .orElse(() => ResultAsync.fromSafePromise(Promise.resolve(false))),
  }))
}
