import { Command as CommanderCommand } from "commander"
import { Result, ok, err } from "neverthrow"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import { createGitIO } from "./gitIO"
import {
  Command,
  Runtime,
  Environment,
  FileSystemAdapter,
  RuntimeError,
  FileError,
  HelpCommand,
  InitCommand,
  ConfigureCommand,
  InstallCommand,
  UnloadCommand,
  ConfigureInput,
} from "./types"

// =============================================================================
// Real File System Adapter
// =============================================================================

const realFileSystem: FileSystemAdapter = {
  readFile: (path: string) => {
    try {
      const content = fs.readFileSync(path, "utf8")
      return ok(content)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return err("fileNotFound")
      }
      return err("readError")
    }
  },

  writeFile: (path: string, content: string) => {
    try {
      fs.writeFileSync(path, content, "utf8")
      return ok(undefined)
    } catch (error) {
      return err("writeError")
    }
  },

  exists: (path: string) => {
    try {
      const exists = fs.existsSync(path)
      return ok(exists)
    } catch (error) {
      return err("readError")
    }
  },

  mkdir: (path: string) => {
    try {
      fs.mkdirSync(path, { recursive: true })
      return ok(undefined)
    } catch (error) {
      return err("writeError")
    }
  },

  deleteFile: (path: string) => {
    try {
      fs.unlinkSync(path)
      return ok(undefined)
    } catch (error) {
      return err("writeError")
    }
  },

  deleteDir: (path: string) => {
    try {
      fs.rmSync(path, { recursive: true, force: true })
      return ok(undefined)
    } catch (error) {
      return err("writeError")
    }
  },
}

// =============================================================================
// Environment Detection
// =============================================================================

function getElmHome(): string {
  const maybeCustomHome = process.env.ELM_HOME
  if (maybeCustomHome) {
    return maybeCustomHome
  }

  const platform = os.platform()
  const homeDir = os.homedir()

  switch (platform) {
    case "win32":
      return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "elm")
    default:
      return path.join(homeDir, ".elm")
  }
}

function createEnvironment(): Environment {
  const cwd = process.cwd()
  const elmJsonPath = path.join(cwd, "elm.json")
  const sideloadConfigPath = path.join(cwd, "elm.sideload.json")

  return {
    elmHome: getElmHome(),
    cwd,
    hasElmJson: fs.existsSync(elmJsonPath),
    hasSideloadConfig: fs.existsSync(sideloadConfigPath),
  }
}

// =============================================================================
// Command Line Parsing
// =============================================================================

export function parseArgs(argv: string[]): Result<Command, RuntimeError> {
  const program = new CommanderCommand()
  let parsedCommand: Command | null = null

  program
    .name("elm-sideload")
    .description("Sideload / override Elm packages from your elm.json")
    .version("1.0.0")
    .action(() => {
      parsedCommand = { type: "help" } as HelpCommand
    })

  // elm-sideload init
  program
    .command("init")
    .description("Create elm.sideload.json configuration")
    .action(() => {
      parsedCommand = { type: "init" } as InitCommand
    })

  // elm-sideload configure <package> [options]
  program
    .command("configure")
    .description("Configure a package sideload")
    .argument("<package>", "Package name (e.g., elm/html)")
    .option("--github <url>", "GitHub repository URL")
    .option("--branch <branch>", "Git branch to pin to")
    .option("--sha <sha>", "Git SHA to pin to")
    .option("--relative <path>", "Relative directory path")
    .action((packageName: string, options: any) => {
      const result = parseConfigureCommand(packageName, options)
      if (result.isOk()) {
        parsedCommand = result.value
      }
    })

  // elm-sideload install [options]
  program
    .command("install")
    .description("Install sideloaded packages")
    .option("--always", "Apply without prompting")
    .option("--dry-run", "Show what would be done without doing it")
    .action((options: any) => {
      const mode = options.always ? "always" : options.dryRun ? "dry-run" : "interactive"

      parsedCommand = { type: "install", mode } as InstallCommand
    })

  // elm-sideload unload
  program
    .command("unload")
    .description("Remove sideloaded packages")
    .action(() => {
      parsedCommand = { type: "unload" } as UnloadCommand
    })

  try {
    program.parse(argv, { from: "user" })

    // If no command was captured, show help
    if (parsedCommand === null) {
      return ok({ type: "help" } as HelpCommand)
    }

    return ok(parsedCommand)
  } catch (error) {
    return err("invalidArguments")
  }
}

function parseConfigureCommand(packageName: string, options: any): Result<ConfigureCommand, RuntimeError> {
  let source: ConfigureInput

  if (options.github) {
    if (options.branch) {
      source = {
        type: "github",
        url: options.github,
        pinTo: { branch: options.branch },
      }
    } else if (options.sha) {
      source = {
        type: "github",
        url: options.github,
        pinTo: { sha: options.sha },
      }
    } else {
      return err("invalidArguments")
    }
  } else if (options.relative) {
    source = {
      type: "relative",
      path: options.relative,
    }
  } else {
    return err("invalidArguments")
  }

  return ok({
    type: "configure",
    packageName,
    source,
  })
}

// =============================================================================
// Runtime Creation
// =============================================================================

export function createRuntime(argv: string[]): Result<Runtime, RuntimeError> {
  return parseArgs(argv).andThen((command) => {
    const environment = createEnvironment()

    return createGitIO()
      .mapErr(() => "gitNotAvailable" as const)
      .map((gitIO) => ({
        command,
        environment,
        fileSystem: realFileSystem,
        gitIO,
      }))
  })
}

// =============================================================================
// Test Helper - Mock File System
// =============================================================================

export function createTestRuntime(
  command: Command,
  environment: Partial<Environment> = {},
  fileSystem: Partial<FileSystemAdapter> = {}
): Runtime {
  const defaultEnvironment: Environment = {
    elmHome: "/test/elm",
    cwd: "/test/project",
    hasElmJson: true,
    hasSideloadConfig: false,
    ...environment,
  }

  const defaultFileSystem: FileSystemAdapter = {
    readFile: () => err("fileNotFound"),
    writeFile: () => ok(undefined),
    exists: () => ok(false),
    mkdir: () => ok(undefined),
    deleteFile: () => ok(undefined),
    deleteDir: () => ok(undefined),
    ...fileSystem,
  }

  // Mock GitIO for testing
  const mockGitIO = {
    clone: () => ok(undefined),
    checkout: () => ok(undefined),
    getCurrentSha: () => ok("abc123"),
    getRecentCommits: () => ok([]),
    isClean: () => ok(true),
    pull: () => ok(undefined),
    resolveBranchToSha: () => ok("abc123"),
    shaExists: () => ok(true),
  }

  return {
    command,
    environment: defaultEnvironment,
    fileSystem: defaultFileSystem,
    gitIO: mockGitIO,
  }
}
