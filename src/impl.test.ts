import { describe, it, expect } from "vitest"
import { okAsync, errAsync } from "neverthrow"
import path from "path"
import { executeCommand } from "./impl"
import { createTestRuntime } from "./cli"
import { Command, SideloadConfig, UserIOAdapter } from "./types"

const mockUserIO: UserIOAdapter = {
  prompt: (message: string) => okAsync("n"),
}

describe("executeCommand", () => {
  it("should execute help command", async () => {
    const command: Command = { type: "help" }
    const runtime = createTestRuntime(command, {}, {}, mockUserIO)

    const result = (await executeCommand(runtime))._unsafeUnwrap()

    expect(result.message).toContain("elm-sideload: congratulations")
  })

  it("should execute init command successfully", async () => {
    const command: Command = { type: "init" }
    const fileSystemWrites: Record<string, string> = {}
    const cwd = "/test/project"

    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: true,
        hasSideloadConfig: false,
        cwd,
      },
      {
        readFile: () => okAsync(""), // Mock reading .gitignore
        writeFile: (filePath: string, content: string) => {
          fileSystemWrites[filePath] = content
          return okAsync(undefined)
        },
      },
      {
        prompt: (message: string) => okAsync("n"),
      }
    )

    const result = (await executeCommand(runtime))._unsafeUnwrap()

    const expectedSideloadPath = path.join(cwd, "elm.sideload.json")
    const expectedGitignorePath = path.join(cwd, ".gitignore")

    expect(result.message).toContain("Created elm.sideload.json")
    expect(fileSystemWrites[expectedSideloadPath]).toBeDefined()
    const config = JSON.parse(fileSystemWrites[expectedSideloadPath])
    expect(config.requireElmHome).toBe(false)
    expect(fileSystemWrites[expectedGitignorePath]).toContain(".elm.sideload.cache")
  })

  it("should fail init command when elm.json is missing", async () => {
    const command: Command = { type: "init" }
    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: false,
        hasSideloadConfig: false,
      },
      {},
      mockUserIO
    )

    const error = (await executeCommand(runtime))._unsafeUnwrapErr()
    expect(error).toBe("noElmJsonFound")
  })

  it("should fail init command when sideload config already exists", async () => {
    const command: Command = { type: "init" }
    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: true,
        hasSideloadConfig: true,
      },
      {},
      mockUserIO
    )

    const error = (await executeCommand(runtime))._unsafeUnwrapErr()
    expect(error).toBe("invalidSideloadConfig")
  })

  it("should execute configure command successfully", async () => {
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

    const mockSideloadConfig: SideloadConfig = {
      elmJsonPath: "elm.json",
      requireElmHome: false,
      sideloads: [],
    }

    // Track GitIO calls
    const gitIOCalls: string[] = []
    const mockGitIO = {
      clone: (url: string, targetDir: string) => {
        gitIOCalls.push(`clone:${url}:${targetDir}`)
        return okAsync(undefined)
      },
      checkout: (repoDir: string, sha: string) => {
        gitIOCalls.push(`checkout:${repoDir}:${sha}`)
        return okAsync(undefined)
      },
      getCurrentSha: () => okAsync("abc123def456"),
      getRecentCommits: () => okAsync([]),
      isClean: () => okAsync(true),
      pull: () => okAsync(undefined),
      resolveBranchToSha: () => okAsync("abc123def456"),
      shaExists: () => okAsync(true),
    }

    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: true,
        hasSideloadConfig: true,
        cwd: "/test/project",
      },
      {
        readFile: (path: string) => {
          if (path.endsWith("elm.json")) {
            return okAsync(JSON.stringify(mockElmJson))
          }
          if (path.endsWith("elm.sideload.json")) {
            return okAsync(JSON.stringify(mockSideloadConfig))
          }
          return errAsync("fileNotFound" as const)
        },
      },
      mockUserIO
    )

    // Override the mock GitIO
    runtime.gitIO = mockGitIO as any // cast because the mock is not complete

    const result = (await executeCommand(runtime))._unsafeUnwrap()

    expect(result.message).toContain("Configured sideload for elm/html")

    // Verify GitIO operations were called for caching
    expect(gitIOCalls).toContain("clone:https://github.com/lydell/html:/test/project/.elm.sideload.cache/lydell/html")
    expect(gitIOCalls).toContain("checkout:/test/project/.elm.sideload.cache/lydell/html:abc123def456")
  })

  it("should execute configure command with branch resolution", async () => {
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

    const mockSideloadConfig: SideloadConfig = {
      elmJsonPath: "elm.json",
      requireElmHome: false,
      sideloads: [],
    }

    // Track GitIO calls
    const gitIOCalls: string[] = []
    const mockGitIO = {
      clone: (url: string, targetDir: string) => {
        gitIOCalls.push(`clone:${url}:${targetDir}`)
        return okAsync(undefined)
      },
      checkout: (repoDir: string, sha: string) => {
        gitIOCalls.push(`checkout:${repoDir}:${sha}`)
        return okAsync(undefined)
      },
      getCurrentSha: () => okAsync("resolved123sha"),
      getRecentCommits: () => okAsync([]),
      isClean: () => okAsync(true),
      pull: () => okAsync(undefined),
      resolveBranchToSha: (repoDir: string, branch: string) => {
        gitIOCalls.push(`resolveBranchToSha:${repoDir}:${branch}`)
        return okAsync("resolved123sha")
      },
      shaExists: () => okAsync(true),
    }

    const runtime = createTestRuntime(
      command,
      {
        hasElmJson: true,
        hasSideloadConfig: true,
        cwd: "/test/project",
      },
      {
        readFile: (path: string) => {
          if (path.endsWith("elm.json")) {
            return okAsync(JSON.stringify(mockElmJson))
          }
          if (path.endsWith("elm.sideload.json")) {
            return okAsync(JSON.stringify(mockSideloadConfig))
          }
          return errAsync("fileNotFound" as const)
        },
      },
      mockUserIO
    )

    // Override the mock GitIO
    runtime.gitIO = mockGitIO as any

    const result = (await executeCommand(runtime))._unsafeUnwrap()

    expect(result.message).toContain("Configured sideload for elm/virtual-dom")

    // Verify GitIO operations were called for caching with branch resolution
    expect(gitIOCalls).toContain(
      "clone:https://github.com/lydell/virtual-dom:/test/project/.elm.sideload.cache/lydell/virtual-dom"
    )
    expect(gitIOCalls).toContain("resolveBranchToSha:/test/project/.elm.sideload.cache/lydell/virtual-dom:safe")
    expect(gitIOCalls).toContain("checkout:/test/project/.elm.sideload.cache/lydell/virtual-dom:resolved123sha")
  })

  it("should execute install command in dry-run mode", async () => {
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
        readFile: (path: string) => {
          if (path.endsWith("elm.sideload.json")) {
            return okAsync(JSON.stringify(mockConfig))
          }
          return errAsync("fileNotFound" as const)
        },
      },
      mockUserIO
    )

    const result = (await executeCommand(runtime))._unsafeUnwrap()

    expect(result.message).toContain("Would install 1 sideloads (dry-run mode)")
    expect(result.changes).toHaveLength(1)
  })

  it("should execute unload command", async () => {
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
        readFile: (path: string) => {
          if (path.endsWith("elm.sideload.json")) {
            return okAsync(JSON.stringify(mockConfig))
          }
          return errAsync("fileNotFound" as const)
        },
      },
      mockUserIO
    )

    const result = (await executeCommand(runtime))._unsafeUnwrap()

    expect(result.message).toContain("Successfully unloaded 1 sideloads")
    expect(result.changes).toHaveLength(1)
  })
})
