import { describe, it, expect } from "vitest"
import { ok, err } from "neverthrow"
import { executeCommand } from "./impl"
import { createTestRuntime } from "./cli"
import { Command, SideloadConfig } from "./types"

describe("executeCommand", () => {
  it("should execute help command", () => {
    const command: Command = { type: "help" }
    const runtime = createTestRuntime(command)

    const result = executeCommand(runtime)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.success).toBe(true)
      expect(result.value.message).toContain("elm-sideload: congratulations")
    }
  })

  it("should execute init command successfully", () => {
    const command: Command = { type: "init" }
    const runtime = createTestRuntime(command, {
      hasElmJson: true,
      hasSideloadConfig: false,
    })

    const result = executeCommand(runtime)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.success).toBe(true)
      expect(result.value.message).toContain("Created elm.sideload.json")
    }
  })

  it("should fail init command when elm.json is missing", () => {
    const command: Command = { type: "init" }
    const runtime = createTestRuntime(command, {
      hasElmJson: false,
      hasSideloadConfig: false,
    })

    const result = executeCommand(runtime)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toBe("noElmJsonFound")
    }
  })

  it("should fail init command when sideload config already exists", () => {
    const command: Command = { type: "init" }
    const runtime = createTestRuntime(command, {
      hasElmJson: true,
      hasSideloadConfig: true,
    })

    const result = executeCommand(runtime)

    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error).toBe("invalidSideloadConfig")
    }
  })

  it("should execute configure command successfully", () => {
    const command: Command = {
      type: "configure",
      packageName: "elm/html",
      source: { type: "github", url: "https://github.com/lydell/html", pinTo: { sha: "abc123def456" } },
    }

    const mockElmJson = {
      type: "application",
      "source-directories": ["src"],
      "elm-version": "0.19.1",
      dependencies: {
        direct: { "elm/html": "1.0.0" },
        indirect: {},
        "test-dependencies": {
          direct: {},
          indirect: {},
        },
      },
    }

    // Track GitIO calls
    const gitIOCalls: string[] = []
    const mockGitIO = {
      clone: (url: string, targetDir: string) => {
        gitIOCalls.push(`clone:${url}:${targetDir}`)
        return ok(undefined)
      },
      checkout: (repoDir: string, sha: string) => {
        gitIOCalls.push(`checkout:${repoDir}:${sha}`)
        return ok(undefined)
      },
      getCurrentSha: () => ok("abc123def456"),
      getRecentCommits: () => ok([]),
      isClean: () => ok(true),
      pull: () => ok(undefined),
      resolveBranchToSha: () => ok("abc123def456"),
      shaExists: () => ok(true),
    }

    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: true,
        hasSideloadConfig: false,
        cwd: "/test/project",
      },
      {
        readFile: (path) => {
          if (path.endsWith("elm.json")) {
            return ok(JSON.stringify(mockElmJson))
          }
          return err("fileNotFound")
        },
      }
    )

    // Override the mock GitIO
    runtime.gitIO = mockGitIO

    const result = executeCommand(runtime)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.success).toBe(true)
      expect(result.value.message).toContain("Configured sideload for elm/html")
    }

    // Verify GitIO operations were called for caching
    expect(gitIOCalls).toContain("clone:https://github.com/lydell/html:/test/project/.elm.sideload.cache/lydell/html")
    expect(gitIOCalls).toContain("checkout:/test/project/.elm.sideload.cache/lydell/html:abc123def456")
  })

  it("should execute configure command with branch resolution", () => {
    const command: Command = {
      type: "configure",
      packageName: "elm/virtual-dom",
      source: { type: "github", url: "https://github.com/lydell/virtual-dom", pinTo: { branch: "safe" } },
    }

    const mockElmJson = {
      type: "application",
      "source-directories": ["src"],
      "elm-version": "0.19.1",
      dependencies: {
        direct: { "elm/virtual-dom": "1.0.4" },
        indirect: {},
        "test-dependencies": {
          direct: {},
          indirect: {},
        },
      },
    }

    // Track GitIO calls
    const gitIOCalls: string[] = []
    const mockGitIO = {
      clone: (url: string, targetDir: string) => {
        gitIOCalls.push(`clone:${url}:${targetDir}`)
        return ok(undefined)
      },
      checkout: (repoDir: string, sha: string) => {
        gitIOCalls.push(`checkout:${repoDir}:${sha}`)
        return ok(undefined)
      },
      getCurrentSha: () => ok("resolved123sha"),
      getRecentCommits: () => ok([]),
      isClean: () => ok(true),
      pull: () => ok(undefined),
      resolveBranchToSha: (repoDir: string, branch: string) => {
        gitIOCalls.push(`resolveBranchToSha:${repoDir}:${branch}`)
        return ok("resolved123sha")
      },
      shaExists: () => ok(true),
    }

    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: true,
        hasSideloadConfig: false,
        cwd: "/test/project",
      },
      {
        readFile: (path) => {
          if (path.endsWith("elm.json")) {
            return ok(JSON.stringify(mockElmJson))
          }
          return err("fileNotFound")
        },
      }
    )

    // Override the mock GitIO
    runtime.gitIO = mockGitIO

    const result = executeCommand(runtime)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.success).toBe(true)
      expect(result.value.message).toContain("Configured sideload for elm/virtual-dom")
    }

    // Verify GitIO operations were called for caching with branch resolution
    expect(gitIOCalls).toContain(
      "clone:https://github.com/lydell/virtual-dom:/test/project/.elm.sideload.cache/lydell/virtual-dom"
    )
    expect(gitIOCalls).toContain("resolveBranchToSha:/test/project/.elm.sideload.cache/lydell/virtual-dom:safe")
    expect(gitIOCalls).toContain("checkout:/test/project/.elm.sideload.cache/lydell/virtual-dom:resolved123sha")
  })

  it("should execute install command in dry-run mode", () => {
    const command: Command = {
      type: "install",
      mode: "dry-run",
    }

    const mockConfig: SideloadConfig = {
      elmJsonPath: "elm.json",
      requireElmHome: false,
      sideloads: [
        {
          originalPackageName: "elm/html",
          originalPackageVersion: "1.0.0",
          sideloadedPackage: { type: "github", url: "https://github.com/lydell/html", pinTo: { sha: "abc123def456" } },
        },
      ],
    }

    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: true,
        hasSideloadConfig: true,
      },
      {
        readFile: (path) => {
          if (path.endsWith("elm.sideload.json")) {
            return ok(JSON.stringify(mockConfig))
          }
          return err("fileNotFound")
        },
      }
    )

    const result = executeCommand(runtime)

    if (result.isErr()) {
      console.error("Install command failed:", result.error)
    }

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.success).toBe(true)
      expect(result.value.message).toContain("Would install 1 sideloads (dry-run mode)")
      expect(result.value.changes).toHaveLength(1)
    }
  })

  it("should execute unload command", () => {
    const command: Command = { type: "unload" }

    const mockConfig: SideloadConfig = {
      elmJsonPath: "elm.json",
      requireElmHome: false,
      sideloads: [
        {
          originalPackageName: "elm/html",
          originalPackageVersion: "1.0.0",
          sideloadedPackage: { type: "github", url: "https://github.com/lydell/html", pinTo: { sha: "abc123def456" } },
        },
      ],
    }

    const runtime = createTestRuntime(
      command,
      {},
      {
        readFile: (path) => {
          if (path.endsWith("elm.sideload.json")) {
            return ok(JSON.stringify(mockConfig))
          }
          return err("fileNotFound")
        },
      }
    )

    const result = executeCommand(runtime)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.success).toBe(true)
      expect(result.value.message).toContain("Successfully unloaded 1 sideloads")
      expect(result.value.changes).toHaveLength(1)
    }
  })
})
