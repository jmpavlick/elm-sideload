import { Result, ok, err } from "neverthrow"
import * as path from "path"
import * as child_process from "child_process"
import * as fs from "fs"
import { helpText } from "./generated/help"
import {
  Runtime,
  Command,
  CommandError,
  ExecutionResult,
  SideloadConfig,
  ElmJson,
  ValidationError,
  FileError,
  SideloadRegistration,
  AppliedChange,
  ConfigureInput,
  ConfigureSource,
} from "./types"

// =============================================================================
// Main Command Execution
// =============================================================================

export function executeCommand(runtime: Runtime): Result<ExecutionResult, CommandError> {
  switch (runtime.command.type) {
    case "help":
      return ok({
        success: true,
        message: helpText,
      })

    case "init":
      return executeInit(runtime)

    case "configure":
      const { packageName, source } = runtime.command
      return executeConfigure(runtime, packageName, source)

    case "install":
      const { mode } = runtime.command
      return executeInstall(runtime, mode)

    case "unload":
      return executeUnload(runtime)

    default:
      const _: never = runtime.command
      throw new Error(`Unhandled command: ${(runtime.command as any).type}`)
  }
}

// =============================================================================
// Help Command
// =============================================================================

// =============================================================================
// Init Command
// =============================================================================

function executeInit(runtime: Runtime): Result<ExecutionResult, CommandError> {
  const validateInitConditions = (): Result<void, CommandError> =>
    runtime.environment.hasSideloadConfig
      ? err("invalidSideloadConfig")
      : !runtime.environment.hasElmJson
        ? err("noElmJsonFound")
        : ok(undefined)

  const createDefaultConfig = (): SideloadConfig => ({
    elmJsonPath: "elm.json",
    sideloads: [],
  })

  const writeConfigAndCreateCache = (config: SideloadConfig): Result<ExecutionResult, CommandError> => {
    const configPath = path.join(runtime.environment.cwd, "elm.sideload.json")
    const configJson = JSON.stringify(config, null, 2)
    const cachePath = path.join(runtime.environment.cwd, ".elm.sideload.cache")
    const gitignorePath = path.join(runtime.environment.cwd, ".gitignore")

    const addToGitignore = (): Result<void, CommandError> =>
      runtime.fileSystem
        .readFile(gitignorePath)
        .map((content) => (content.includes(".elm.sideload.cache") ? content : content + "\n.elm.sideload.cache\n"))
        .orElse(() => ok(".elm.sideload.cache\n"))
        .andThen((content) => runtime.fileSystem.writeFile(gitignorePath, content))

    return runtime.fileSystem
      .writeFile(configPath, configJson)
      .andThen(() => runtime.fileSystem.mkdir(cachePath))
      .andThen(() => addToGitignore())
      .map(() => ({
        success: true,
        message: `Created elm.sideload.json, .elm.sideload.cache directory, and updated .gitignore`,
      }))
  }

  return validateInitConditions()
    .map(() => createDefaultConfig())
    .andThen(writeConfigAndCreateCache)
}

// =============================================================================
// Configure Command
// =============================================================================

function executeConfigure(
  runtime: Runtime,
  packageName: string,
  source: ConfigureInput
): Result<ExecutionResult, CommandError> {
  const validatePackageInElmJson = (elmJson: ElmJson): Result<ElmJson, CommandError> =>
    checkPackageInElmJson(elmJson, packageName) ? ok(elmJson) : err("packageNotFoundInElmJson")

  const getOrCreateSideloadConfig = (): Result<SideloadConfig, CommandError> =>
    loadSideloadConfig(runtime).orElse(() =>
      ok({
        elmJsonPath: "elm.json",
        sideloads: [],
      })
    )

  const createRegistration = (
    elmJson: ElmJson,
    config: SideloadConfig,
    resolvedSource: ConfigureSource
  ): Result<SideloadConfig, CommandError> => {
    const packageVersion = getPackageVersion(elmJson, packageName)

    return packageVersion
      ? ok({
          ...config,
          sideloads: [
            ...config.sideloads.filter((s) => s.originalPackageName !== packageName),
            {
              originalPackageName: packageName,
              originalPackageVersion: packageVersion,
              sideloadedPackage: resolvedSource,
            },
          ],
        })
      : err("packageNotFoundInElmJson")
  }

  const saveConfig = (config: SideloadConfig): Result<ExecutionResult, CommandError> => {
    const configPath = path.join(runtime.environment.cwd, "elm.sideload.json")
    const configJson = JSON.stringify(config, null, 2)

    return runtime.fileSystem.writeFile(configPath, configJson).map(() => ({
      success: true,
      message: `Configured sideload for ${packageName}`,
    }))
  }

  return resolveInputToSource(source).andThen((resolvedSource) =>
    loadElmJson(runtime)
      .andThen(validatePackageInElmJson)
      .andThen((elmJson) =>
        getOrCreateSideloadConfig().andThen((config) => createRegistration(elmJson, config, resolvedSource))
      )
      .andThen(saveConfig)
  )
}

// =============================================================================
// Install Command
// =============================================================================

function executeInstall(
  runtime: Runtime,
  mode: "interactive" | "always" | "dry-run"
): Result<ExecutionResult, CommandError> {
  const validateElmJsonExists = (): Result<void, CommandError> =>
    runtime.environment.hasElmJson ? ok(undefined) : err("noElmJsonFound")

  const ensureCacheDirectory = (): Result<string, CommandError> => {
    const cacheDir = path.join(runtime.environment.cwd, ".elm.sideload.cache")
    return runtime.fileSystem.mkdir(cacheDir).map(() => cacheDir)
  }

  const installSideload = (
    sideload: SideloadRegistration,
    cacheDir: string,
    elmHomePackagesPath: string
  ): Result<AppliedChange, CommandError> => {
    const { originalPackageName, originalPackageVersion, sideloadedPackage } = sideload

    switch (sideloadedPackage.type) {
      case "github":
        return cloneRepository(sideloadedPackage.url, sideloadedPackage.pinTo.sha, cacheDir)
          .andThen((clonedPath) =>
            copyPackageToElmHome(clonedPath, originalPackageName, originalPackageVersion, elmHomePackagesPath)
          )
          .map(() => ({
            packageName: originalPackageName,
            action: "sideloaded" as const,
            source: sideloadedPackage.url,
          }))

      case "relative":
        const sourcePath = path.resolve(runtime.environment.cwd, sideloadedPackage.path)
        return copyPackageToElmHome(sourcePath, originalPackageName, originalPackageVersion, elmHomePackagesPath).map(
          () => ({
            packageName: originalPackageName,
            action: "sideloaded" as const,
            source: sideloadedPackage.path,
          })
        )

      default:
        const _: never = sideloadedPackage
        return err("invalidSideloadConfig")
    }
  }

  const performInstallation = (
    config: SideloadConfig,
    cacheDir: string,
    elmHomePackagesPath: string
  ): Result<AppliedChange[], CommandError> => {
    const changes: AppliedChange[] = []

    for (const sideload of config.sideloads) {
      const result = installSideload(sideload, cacheDir, elmHomePackagesPath)
      if (result.isErr()) {
        return err(result.error)
      }
      changes.push(result.value)
    }

    return ok(changes)
  }

  const bustElmCache = (): Result<void, CommandError> => {
    const elmStuffPath = path.join(runtime.environment.cwd, "elm-stuff", "0.19.1")

    try {
      if (fs.existsSync(elmStuffPath)) {
        console.log("Deleting elm-stuff/0.19.1 to bust compilation cache...")
        fs.rmSync(elmStuffPath, { recursive: true, force: true })
      }
      return ok(undefined)
    } catch (error) {
      console.error(`Failed to delete elm-stuff cache:`, error)
      return err("writeError")
    }
  }

  const createResult = (changes: AppliedChange[]): ExecutionResult => ({
    success: true,
    message:
      mode === "dry-run"
        ? `Would install ${changes.length} sideloads (dry-run mode)`
        : `Successfully installed ${changes.length} sideloads`,
    changes,
  })

  return validateElmJsonExists()
    .andThen(() => loadSideloadConfig(runtime))
    .andThen((config) =>
      getElmHomePackagesPath(runtime, config).andThen((elmHomePackagesPath) =>
        ensureCacheDirectory().andThen((cacheDir) =>
          mode === "dry-run"
            ? ok(
                config.sideloads.map((sideload) => ({
                  packageName: sideload.originalPackageName,
                  action: "sideloaded" as const,
                  source:
                    sideload.sideloadedPackage.type === "github"
                      ? sideload.sideloadedPackage.url
                      : sideload.sideloadedPackage.path,
                }))
              )
            : bustElmCache().andThen(() => performInstallation(config, cacheDir, elmHomePackagesPath))
        )
      )
    )
    .map(createResult)
}

// =============================================================================
// Unload Command
// =============================================================================

function executeUnload(runtime: Runtime): Result<ExecutionResult, CommandError> {
  const removeSideloadedPackage = (
    packageName: string,
    version: string,
    elmHomePackagesPath: string
  ): Result<AppliedChange, CommandError> => {
    try {
      const [author, name] = packageName.split("/")
      if (!author || !name) {
        return err("invalidPackageName")
      }

      const packageDir = path.join(elmHomePackagesPath, author, name, version)

      if (fs.existsSync(packageDir)) {
        fs.rmSync(packageDir, { recursive: true, force: true })
      }

      return ok({
        packageName,
        action: "restored" as const,
        source: "official package repository",
      })
    } catch (error) {
      console.error(`Failed to remove package ${packageName}:`, error)
      return err("packageCopyFailed")
    }
  }

  const performUnload = (
    config: SideloadConfig,
    elmHomePackagesPath: string
  ): Result<AppliedChange[], CommandError> => {
    const changes: AppliedChange[] = []

    for (const sideload of config.sideloads) {
      const result = removeSideloadedPackage(
        sideload.originalPackageName,
        sideload.originalPackageVersion,
        elmHomePackagesPath
      )
      if (result.isErr()) {
        return err(result.error)
      }
      changes.push(result.value)
    }

    return ok(changes)
  }

  return loadSideloadConfig(runtime)
    .andThen((config) =>
      getElmHomePackagesPath(runtime, config).andThen((elmHomePackagesPath) =>
        performUnload(config, elmHomePackagesPath)
      )
    )
    .map((changes) => ({
      success: true,
      message: `Successfully unloaded ${changes.length} sideloads`,
      changes,
    }))
}

// =============================================================================
// Git Operations
// =============================================================================

function resolveGitReference(url: string, reference: string): Result<string, CommandError> {
  try {
    // Use git ls-remote to get the SHA for the branch/tag
    const command = `git ls-remote ${url} refs/heads/${reference}`
    const output = child_process.execSync(command, { encoding: "utf8", stdio: "pipe" })

    const lines = output.trim().split("\n")
    if (lines.length === 0 || !lines[0]) {
      return err("invalidGithubUrl") // Branch not found
    }

    const sha = lines[0].split("\t")[0]
    return sha ? ok(sha) : err("invalidGithubUrl")
  } catch (error) {
    console.error(`Git ls-remote failed for ${url}:${reference}`, error)
    return err("invalidGithubUrl")
  }
}

function resolveInputToSource(input: ConfigureInput): Result<ConfigureSource, CommandError> {
  switch (input.type) {
    case "relative":
      return ok(input)

    case "github":
      if ("sha" in input.pinTo) {
        // Already has SHA, convert to ConfigureSource type
        return ok({
          type: "github" as const,
          url: input.url,
          pinTo: { sha: input.pinTo.sha },
        })
      } else {
        // Has branch, resolve to SHA
        return resolveGitReference(input.url, input.pinTo.branch).map((sha) => ({
          type: "github" as const,
          url: input.url,
          pinTo: { sha },
        }))
      }

    default:
      const _: never = input
      throw new Error(`Unhandled ConfigureInput type: ${(input as any).type}`)
  }
}

function cloneRepository(url: string, sha: string, cacheDir: string): Result<string, CommandError> {
  try {
    // Create unique directory name based on URL and SHA
    const repoName = path.basename(url, ".git")
    const cloneDir = path.join(cacheDir, `${repoName}-${sha.substring(0, 8)}`)

    // Clean up existing directory if it exists
    if (fs.existsSync(cloneDir)) {
      fs.rmSync(cloneDir, { recursive: true, force: true })
    }

    // Clone the repository
    child_process.execSync(`git clone ${url} ${cloneDir}`, {
      stdio: "pipe",
      encoding: "utf8",
    })

    // Checkout the specific SHA
    child_process.execSync(`git checkout ${sha}`, {
      cwd: cloneDir,
      stdio: "pipe",
      encoding: "utf8",
    })

    return ok(cloneDir)
  } catch (error) {
    console.error(`Failed to clone repository ${url} at SHA ${sha}:`, error)
    return err("gitCloneFailed")
  }
}

function copyPackageToElmHome(
  sourcePath: string,
  packageName: string,
  version: string,
  elmHomePackagesPath: string
): Result<string, CommandError> {
  try {
    const [author, name] = packageName.split("/")
    if (!author || !name) {
      return err("invalidPackageName")
    }

    const targetDir = path.join(elmHomePackagesPath, author, name, version)

    // Create target directory
    fs.mkdirSync(targetDir, { recursive: true })

    // Copy all files from source to target
    copyDirectoryRecursive(sourcePath, targetDir)

    return ok(targetDir)
  } catch (error) {
    console.error(`Failed to copy package ${packageName} to ELM_HOME:`, error)
    return err("packageCopyFailed")
  }
}

function copyDirectoryRecursive(source: string, target: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`Source directory does not exist: ${source}`)
  }

  fs.mkdirSync(target, { recursive: true })

  const items = fs.readdirSync(source)
  for (const item of items) {
    // Skip .git directory to avoid permission issues
    if (item === ".git") {
      continue
    }

    const sourcePath = path.join(source, item)
    const targetPath = path.join(target, item)

    if (fs.statSync(sourcePath).isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath)
    } else {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

function getElmHomePackagesPath(runtime: Runtime, config: SideloadConfig): Result<string, CommandError> {
  // Check if custom elmHomePackagesPath is configured
  if (config.elmHomePackagesPath) {
    switch (config.elmHomePackagesPath.type) {
      case "relative":
        return ok(path.resolve(runtime.environment.cwd, config.elmHomePackagesPath.path))
      case "absolute":
        return ok(config.elmHomePackagesPath.path)
      case "requireElmHome":
        return runtime.environment.elmHome
          ? ok(path.join(runtime.environment.elmHome, "0.19.1", "packages"))
          : err("noElmHome")
      default:
        const _: never = config.elmHomePackagesPath
        return err("invalidSideloadConfig")
    }
  }

  // Default: use ELM_HOME if available, otherwise use default path
  const elmHome = runtime.environment.elmHome
  if (elmHome) {
    return ok(path.join(elmHome, "0.19.1", "packages"))
  }

  // Default ELM_HOME location based on OS
  const os = require("os")
  const platform = os.platform()

  let defaultElmHome: string
  if (platform === "win32") {
    defaultElmHome = path.join(os.homedir(), "AppData", "Roaming", "elm")
  } else {
    defaultElmHome = path.join(os.homedir(), ".elm")
  }

  return ok(path.join(defaultElmHome, "0.19.1", "packages"))
}

// =============================================================================
// Utility Functions
// =============================================================================

function loadElmJson(runtime: Runtime): Result<ElmJson, CommandError> {
  const elmJsonPath = path.join(runtime.environment.cwd, "elm.json")

  const parseElmJson = (content: string): Result<ElmJson, CommandError> => {
    try {
      return ok(JSON.parse(content) as ElmJson)
    } catch (error) {
      return err("couldNotReadElmJson")
    }
  }

  return runtime.fileSystem.readFile(elmJsonPath).andThen(parseElmJson)
}

function loadSideloadConfig(runtime: Runtime): Result<SideloadConfig, CommandError> {
  const configPath = path.join(runtime.environment.cwd, "elm.sideload.json")

  const parseConfig = (content: string): Result<SideloadConfig, CommandError> => {
    try {
      return ok(JSON.parse(content) as SideloadConfig)
    } catch (error) {
      return err("invalidSideloadConfig")
    }
  }

  return runtime.fileSystem
    .readFile(configPath)
    .mapErr(() => "sideloadConfigNotFound" as const)
    .andThen(parseConfig)
}

function checkPackageInElmJson(elmJson: ElmJson, packageName: string): boolean {
  const { dependencies } = elmJson

  return (
    packageName in dependencies.direct ||
    packageName in dependencies.indirect ||
    packageName in dependencies["test-dependencies"].direct ||
    packageName in dependencies["test-dependencies"].indirect
  )
}

function getPackageVersion(elmJson: ElmJson, packageName: string): string | null {
  const { dependencies } = elmJson

  return (
    dependencies.direct[packageName] ||
    dependencies.indirect[packageName] ||
    dependencies["test-dependencies"].direct[packageName] ||
    dependencies["test-dependencies"].indirect[packageName] ||
    null
  )
}
