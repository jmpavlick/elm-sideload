import { Command as CommanderCommand } from "commander"
import { Result, ResultAsync, ok, err } from "neverthrow"
import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import { promises as fsAsync } from "fs"
import * as readline from "readline"
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
  UserIOAdapter,
} from "./types"

// =============================================================================
// Real File System Adapter
// =============================================================================

const realFileSystem: FileSystemAdapter = {
  readFile: (path: string) => {
    return ResultAsync.fromPromise(fsAsync.readFile(path, "utf8"), (error: any) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "fileNotFound" as const
      }
      return "readError" as const
    })
  },

  writeFile: (path: string, content: string) => {
    return ResultAsync.fromPromise(fsAsync.writeFile(path, content, "utf8"), () => "writeError" as const)
  },

  exists: (path: string) => {
    return ResultAsync.fromPromise(
      fsAsync.access(path).then(() => true),
      () => false
    ).orElse(() => ResultAsync.fromSafePromise(Promise.resolve(false)))
  },

  mkdir: (path: string) => {
    return ResultAsync.fromPromise(fsAsync.mkdir(path, { recursive: true }), () => "writeError" as const).map(
      () => undefined
    )
  },

  deleteFile: (path: string) => {
    return ResultAsync.fromPromise(fsAsync.unlink(path), () => "writeError" as const)
  },

  deleteDir: (path: string) => {
    return ResultAsync.fromPromise(fsAsync.rm(path, { recursive: true, force: true }), () => "writeError" as const)
  },

  copyDirectoryRecursive: (source: string, target: string) => {
    return ResultAsync.fromPromise(fsAsync.cp(source, target, { recursive: true }), () => "copyError" as const)
  },
}

// =============================================================================
// Real User IO Adapter
// =============================================================================

const realUserIO: UserIOAdapter = {
  prompt: (message: string) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return ResultAsync.fromPromise(
      new Promise<string>((resolve) => {
        rl.question(message, (answer) => {
          rl.close()
          resolve(answer)
        })
      }),
      () => "promptFailed" as const
    )
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

  // Local environment variable store
  const envVars = new Map<string, string | undefined>()

  return {
    elmHome: getElmHome(),
    cwd,
    hasElmJson: fs.existsSync(elmJsonPath),
    hasSideloadConfig: fs.existsSync(sideloadConfigPath),
    getEnv: (key: string) => (envVars.has(key) ? envVars.get(key) : process.env[key]),
    setEnv: (key: string, value: string | undefined) => envVars.set(key, value),
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

export function createRuntime(argv: string[]): ResultAsync<Runtime, RuntimeError> {
  return parseArgs(argv).asyncAndThen((command) =>
    createGitIO()
      .mapErr(() => "gitNotAvailable" as const)
      .map((gitIO) => ({
        command,
        environment: createEnvironment(),
        fileSystem: realFileSystem,
        gitIO,
        userIO: realUserIO,
      }))
  )
}

// =============================================================================
// Test Helper - Mock File System
// =============================================================================

export function createTestRuntime(
  command: Command,
  environment: Partial<Environment> = {},
  fileSystem: Partial<FileSystemAdapter> = {},
  userIO: UserIOAdapter
): Runtime {
  const defaultEnvironment: Environment = {
    elmHome: "/test/elm",
    cwd: "/test/project",
    hasElmJson: true,
    hasSideloadConfig: false,
    getEnv: (key: string) => process.env[key],
    setEnv: (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    },
    ...environment,
  }

  const defaultFileSystem: FileSystemAdapter = {
    readFile: () => ResultAsync.fromSafePromise(Promise.reject("fileNotFound")).mapErr(() => "fileNotFound" as const),
    writeFile: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    exists: () => ResultAsync.fromSafePromise(Promise.resolve(false)),
    mkdir: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    deleteFile: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    deleteDir: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    copyDirectoryRecursive: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    ...fileSystem,
  }

  // Mock GitIO for testing
  const mockGitIO = {
    clone: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    checkout: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    getCurrentSha: () => ResultAsync.fromSafePromise(Promise.resolve("abc123")),
    getRecentCommits: () => ResultAsync.fromSafePromise(Promise.resolve([])),
    isClean: () => ResultAsync.fromSafePromise(Promise.resolve(true)),
    pull: () => ResultAsync.fromSafePromise(Promise.resolve(undefined)),
    resolveBranchToSha: () => ResultAsync.fromSafePromise(Promise.resolve("abc123")),
    shaExists: () => ResultAsync.fromSafePromise(Promise.resolve(true)),
  }

  const mockUserIO: UserIOAdapter = userIO || {
    prompt: (message: string) => (input: string) => ResultAsync.fromSafePromise(Promise.resolve(input)),
  }

  return {
    command,
    environment: defaultEnvironment,
    fileSystem: defaultFileSystem,
    gitIO: mockGitIO,
    userIO: mockUserIO,
  }
}
