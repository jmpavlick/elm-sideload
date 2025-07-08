import { describe, it, expect } from "vitest"
import { parseArgs, createTestRuntime } from "./cli"
import { Command, ConfigureCommand, InstallCommand, UserIOAdapter } from "./types"
import { okAsync } from "neverthrow"

const mockUserIO: UserIOAdapter = {
  prompt: (message: string) => okAsync(""),
}

describe("parseArgs", () => {
  it("should parse help command when no args provided", () => {
    const result = parseArgs([])
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.type).toBe("help")
    }
  })

  it("should parse init command", () => {
    const result = parseArgs(["init"])
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.type).toBe("init")
    }
  })

  it("should parse configure command with github and branch", () => {
    const result = parseArgs([
      "configure",
      "elm/html",
      "--github",
      "https://github.com/lydell/html",
      "--branch",
      "safe",
    ])

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const command = result.value as ConfigureCommand
      expect(command.type).toBe("configure")
      expect(command.packageName).toBe("elm/html")
      expect(command.source.type).toBe("github")

      if (command.source.type === "github") {
        expect(command.source.url).toBe("https://github.com/lydell/html")
        expect("branch" in command.source.pinTo).toBe(true)
        if ("branch" in command.source.pinTo) {
          expect(command.source.pinTo.branch).toBe("safe")
        }
      }
    }
  })

  it("should parse configure command with github and sha", () => {
    const result = parseArgs([
      "configure",
      "elm/virtual-dom",
      "--github",
      "https://github.com/lydell/virtual-dom",
      "--sha",
      "abc123",
    ])

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const command = result.value as ConfigureCommand
      expect(command.type).toBe("configure")
      expect(command.packageName).toBe("elm/virtual-dom")
      expect(command.source.type).toBe("github")

      if (command.source.type === "github") {
        expect(command.source.url).toBe("https://github.com/lydell/virtual-dom")
        expect("sha" in command.source.pinTo).toBe(true)
        if ("sha" in command.source.pinTo) {
          expect(command.source.pinTo.sha).toBe("abc123")
        }
      }
    }
  })

  it("should parse configure command with relative path", () => {
    const result = parseArgs(["configure", "elm/browser", "--relative", "../my-elm-browser"])

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const command = result.value as ConfigureCommand
      expect(command.type).toBe("configure")
      expect(command.packageName).toBe("elm/browser")
      expect(command.source.type).toBe("relative")

      if (command.source.type === "relative") {
        expect(command.source.path).toBe("../my-elm-browser")
      }
    }
  })

  it("should parse install command in interactive mode", () => {
    const result = parseArgs(["install"])
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const command = result.value as InstallCommand
      expect(command.type).toBe("install")
      expect(command.mode).toBe("interactive")
    }
  })

  it("should parse install command with --always flag", () => {
    const result = parseArgs(["install", "--always"])
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const command = result.value as InstallCommand
      expect(command.type).toBe("install")
      expect(command.mode).toBe("always")
    }
  })

  it("should parse install command with --dry-run flag", () => {
    const result = parseArgs(["install", "--dry-run"])
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      const command = result.value as InstallCommand
      expect(command.type).toBe("install")
      expect(command.mode).toBe("dry-run")
    }
  })

  it("should parse unload command", () => {
    const result = parseArgs(["unload"])
    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value.type).toBe("unload")
    }
  })
})

describe("createTestRuntime", () => {
  it("should create a test runtime with defaults", () => {
    const command: Command = { type: "help" }
    const runtime = createTestRuntime(command, {}, {}, mockUserIO)

    expect(runtime.command).toEqual(command)
    expect(runtime.environment.elmHome).toBe("/test/elm")
    expect(runtime.environment.cwd).toBe("/test/project")
    expect(runtime.environment.hasElmJson).toBe(true)
    expect(runtime.environment.hasSideloadConfig).toBe(false)
  })

  it("should allow overriding environment values", () => {
    const command: Command = { type: "init" }
    const runtime = createTestRuntime(
      command,
      {
        elmHome: "/custom/elm",
        hasElmJson: false,
        hasSideloadConfig: true,
      },
      {},
      mockUserIO
    )

    expect(runtime.environment.elmHome).toBe("/custom/elm")
    expect(runtime.environment.hasElmJson).toBe(false)
    expect(runtime.environment.hasSideloadConfig).toBe(true)
  })
})
