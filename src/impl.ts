import { Result, ResultAsync, ok, err, okAsync, errAsync } from "neverthrow"
import * as path from "path"
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

const helpText: string = `
elm-sideload: congratulations, you can write javascript again

getting help:

  elm-sideload
      Prints the text that you see here. Maybe pipe it to 'less'?

getting started:

  elm-sideload init
      INTERACTIVELY creates your 'elm.sideload.json', and configures necessary filepaths, creates a folder '.elm.sideload.cache' in your working directory,
      and attempts to add the '.elm.sideload.cache' folder to your '.gitignore'.

      elm-sideload init will tell you whether or not your current shell has an $ELM_HOME set, and if so, what it is; it will then prompt you to configure
      whether or not elm-sideload install should require $ELM_HOME to be set or not.

      If you already have an 'elm.sideload.json', this command will signal adversity and exit.

updating your sideload configuration:

  elm-sideload configure <author/package> [flags]
      Update your 'elm.sideload.json' to add a "sideloaded" package to overwrite the package specified in the arguments,
      using [flags] to specify a source for the sideloaded package. The 'configure' command will look for a reference to the package-to-overwrite in
      your 'elm.json', and will fail if it can't find one.

  elm-sideload configure <author/package> --github <github-url> [flags]
      Configure your 'elm.sideload.json' with an entry for a "sideloaded" package from a GitHub URL, using flags to specify what you want to "pin" to,
      and downloading the code to your local cache.

  elm-sideload configure <author/package> --github <github-url> --branch <branch-name>
      Install from a Github URL. Pin to the latest commit SHA on that branch. Fails it it can't find the repo by URL,
      or if it can't find a branch with that name on the repo.

  elm-sideload configure <author/package> --github <github-url> --sha <sha-value>
      Install from a Github URL. Pin to a specific SHA. Fails if it can't find the repo by URL,
      or if it can't find a commit with that SHA on the repo.

  elm-sideload configure <author/package> --relative <relative-folder-path>
      Install from a relative folder path. The folder path that you use as an argument should be the folder that has
      the sideloaded package's 'elm.json' _in it_.

applying your sideload configuration:

  elm-sideload install
      INTERACTIVELY apply the 'elm.sideload.json' configuration. This is the step that actually copies or overwrites files.
      Running this command will:
        - Check for an 'elm.sideload.json'; if one does not exist, it will signal adversity and exit
        - Check to see if you have an '$ELM_HOME' set, and:
          - If you have an '$ELM_HOME' set, print its value
          - If you do _not_ have an '$ELM_HOME' set, print the value of the directory that it intends to write to
        - Check for the 'elm.json' in your 'elm.sideload.json'; if it does not exist, it will signal adversity and exit
        - If you have set 'requireElmHome: true' in your 'elm.sideload.json':
          - It will use the path as constructed from '$ELM_HOME'; if you set 'requireElmHome: true' and
            the program runs in a shell without '$ELM_HOME' set, it will signal adversity and exit.
        - Verify sideloads:
          - Download any remote sideloaded packages that are not yet in '.elm.sideload.cache' and validate that versions matching the SHAs
            in your elm.sideload.config are available
          - For 'relative' packages, ensure that the references are present in their directories and ensure that they are well-formed (i.e., Elm packages with an 'elm.json' in the referenced directory)
          - This step will perform all validations and fail if any of these dependencies are not available
        - If the program is still running at this point, IT WILL ASK YOU TO CONFIRM! that you DO IN FACT want to overwrite the target packages
          with your sideloads. It will time out, signal adversity, and exit if a response is not provided quickly enough.
          - If you intentionally decline, the program will exit signaling success.
          - If you accept, the program will continue.
        - The program will then:
          - Apply all cached sideloaded packages
          - Print a summary of the packages that it changed
        - If any of your sideloads:
          - Are not in cache, or
          - Fail to download, or
          - Are not accessible,
          - The program will exit, signaling adversity with a list of which packages were available to sideload, and which packages weren't

  elm-sideload install --always
      Apply the 'elm.sideload.json' without asking for permission. Does all of the above checks, and fails if any of them fail.

  elm-sideload install --dry-run
      Does everything _except_ overwrite files at the end; doesn't prompt for input.

undoing your sideload configuration:

  elm-sideload unload
      Deletes any sideloaded packages referenced in your 'elm.sideload.json' so that the Elm compiler can
      re-download them from the official packages repository.
`

// =============================================================================
// Main Command Execution
// =============================================================================

export function executeCommand(runtime: Runtime): ResultAsync<ExecutionResult, CommandError> {
  switch (runtime.command.type) {
    case "help":
      return okAsync({
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

function executeInit(runtime: Runtime): ResultAsync<ExecutionResult, CommandError> {
  const validateInitConditions = (): ResultAsync<void, CommandError> =>
    runtime.environment.hasSideloadConfig
      ? errAsync("invalidSideloadConfig")
      : !runtime.environment.hasElmJson
        ? errAsync("noElmJsonFound")
        : okAsync(undefined)

  const promptForElmHome = (): ResultAsync<boolean, CommandError> => {
    const envElmHome = runtime.environment.getEnv("ELM_HOME")
    const { elmHome } = runtime.environment
    const message = !!envElmHome
      ? `An ELM_HOME was found at: ${envElmHome}\nShould elm-sideload require ELM_HOME to be set in all environments? (Y/n) `
      : `No ELM_HOME was found; defaulting to ${elmHome} in this environment. \nShould elm-sideload require ELM_HOME to be set in all environments? (Y/n) `

    return runtime.userIO.prompt(message).map((answer) => {
      return answer.toLowerCase().trim().startsWith("y")
    })
  }

  const createConfig = (requireElmHome: boolean): SideloadConfig => ({
    elmJsonPath: "elm.json",
    requireElmHome,
    sideloads: [],
  })

  const writeConfigAndCreateCache = (config: SideloadConfig): ResultAsync<ExecutionResult, CommandError> => {
    const configPath = path.join(runtime.environment.cwd, "elm.sideload.json")
    const configJson = JSON.stringify(config, null, 2)
    const cachePath = path.join(runtime.environment.cwd, ".elm.sideload.cache")
    const gitignorePath = path.join(runtime.environment.cwd, ".gitignore")

    const addToGitignore = (): ResultAsync<void, CommandError> =>
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
        message: `Created elm.sideload.json, .elm.sideload.cache directory, and updated .gitignore`,
      }))
  }

  return validateInitConditions().andThen(promptForElmHome).map(createConfig).andThen(writeConfigAndCreateCache)
}

// =============================================================================
// Configure Command
// =============================================================================

function executeConfigure(
  runtime: Runtime,
  packageName: string,
  source: ConfigureInput
): ResultAsync<ExecutionResult, CommandError> {
  const validatePackageInElmJson = (elmJson: ElmJson): ResultAsync<ElmJson, CommandError> =>
    checkPackageInElmJson(elmJson, packageName) ? okAsync(elmJson) : errAsync("packageNotFoundInElmJson")

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

  const saveConfig = (config: SideloadConfig): ResultAsync<ExecutionResult, CommandError> => {
    const configPath = path.join(runtime.environment.cwd, "elm.sideload.json")
    const configJson = JSON.stringify(config, null, 2)

    return runtime.fileSystem.writeFile(configPath, configJson).map(() => ({
      message: `Configured sideload for ${packageName}`,
    }))
  }

  return resolveInputToSource(runtime, source).andThen((resolvedSource) =>
    loadElmJson(runtime)
      .andThen(validatePackageInElmJson)
      .andThen((elmJson) =>
        loadSideloadConfig(runtime).andThen((config) => createRegistration(elmJson, config, resolvedSource))
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
): ResultAsync<ExecutionResult, CommandError> {
  const validateElmJsonExists = (): ResultAsync<void, CommandError> =>
    runtime.environment.hasElmJson ? okAsync(undefined) : errAsync("noElmJsonFound")

  const ensureCacheDirectory = (): ResultAsync<string, CommandError> => {
    const cacheDir = path.join(runtime.environment.cwd, ".elm.sideload.cache")
    return runtime.fileSystem.mkdir(cacheDir).map(() => cacheDir)
  }

  const installSideload = (
    sideload: SideloadRegistration,
    cacheDir: string,
    elmHomePackagesPath: string
  ): ResultAsync<AppliedChange, CommandError> => {
    const { originalPackageName, originalPackageVersion, sideloadedPackage } = sideload

    switch (sideloadedPackage.type) {
      case "github":
        const repoUrlParts = sideloadedPackage.url.split("/")
        const author = repoUrlParts[repoUrlParts.length - 2]
        const repoName = repoUrlParts[repoUrlParts.length - 1].replace(".git", "")
        const cachedRepoPath = path.join(cacheDir, author, repoName)

        // Check if repo is already cached
        const ensureRepoIsCached = (): ResultAsync<string, CommandError> => {
          return runtime.fileSystem.exists(cachedRepoPath).andThen((exists) => {
            if (exists) {
              // Repo exists, pull latest and checkout SHA
              return runtime.gitIO
                .isClean(cachedRepoPath)
                .andThen((isClean) => {
                  if (!isClean) {
                    return runtime.gitIO.getRecentCommits(cachedRepoPath, 5).andThen((commits) =>
                      err({
                        type: "dirtyRepo",
                        status: `Repository at ${cachedRepoPath} has uncommitted changes. Recent commits:\n${commits.join("\n")}`,
                      } as const)
                    )
                  }
                  return ok(undefined)
                })
                .andThen(() => runtime.gitIO.pull(cachedRepoPath))
                .andThen(() => runtime.gitIO.shaExists(cachedRepoPath, sideloadedPackage.pinTo.sha))
                .andThen((shaExists) => {
                  if (!shaExists) {
                    return runtime.gitIO.getRecentCommits(cachedRepoPath, 10).andThen((commits) =>
                      err({
                        type: "shaNotFound",
                        sha: sideloadedPackage.pinTo.sha,
                        recentCommits: commits,
                      } as const)
                    )
                  }
                  return ok(undefined)
                })
                .andThen(() => runtime.gitIO.checkout(cachedRepoPath, sideloadedPackage.pinTo.sha))
                .map(() => cachedRepoPath)
            } else {
              // Repo not cached, clone it
              return runtime.gitIO
                .clone(sideloadedPackage.url, cachedRepoPath)
                .andThen(() => runtime.gitIO.checkout(cachedRepoPath, sideloadedPackage.pinTo.sha))
                .map(() => cachedRepoPath)
            }
          })
        }

        return ensureRepoIsCached()
          .andThen((clonedPath) =>
            copyPackageToElmHome(runtime, clonedPath, originalPackageName, originalPackageVersion, elmHomePackagesPath)
          )
          .map(() => ({
            packageName: originalPackageName,
            action: "sideloaded" as const,
            source: sideloadedPackage.url,
          }))
          .mapErr((gitError) => gitError)

      case "relative":
        const sourcePath = path.resolve(runtime.environment.cwd, sideloadedPackage.path)
        return copyPackageToElmHome(
          runtime,
          sourcePath,
          originalPackageName,
          originalPackageVersion,
          elmHomePackagesPath
        ).map(() => ({
          packageName: originalPackageName,
          action: "sideloaded" as const,
          source: sideloadedPackage.path,
        }))

      default:
        const _: never = sideloadedPackage
        return errAsync("invalidSideloadConfig")
    }
  }

  const performInstallation = (
    config: SideloadConfig,
    cacheDir: string,
    elmHomePackagesPath: string
  ): ResultAsync<AppliedChange[], CommandError> => {
    const installPromises = config.sideloads.map((sideload) => installSideload(sideload, cacheDir, elmHomePackagesPath))

    return ResultAsync.combine(installPromises)
  }

  const createResult = (changes: AppliedChange[]): ExecutionResult => ({
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
            : performInstallation(config, cacheDir, elmHomePackagesPath).andThen((output) =>
                bustElmCache(runtime).map(() => output)
              )
        )
      )
    )
    .map(createResult)
}

// =============================================================================
// Unload Command
// =============================================================================

function executeUnload(runtime: Runtime): ResultAsync<ExecutionResult, CommandError> {
  const removeSideloadedPackage = (
    packageName: string,
    version: string,
    elmHomePackagesPath: string
  ): ResultAsync<AppliedChange, CommandError> => {
    const [author, name] = packageName.split("/")
    if (!author || !name) {
      return errAsync("invalidPackageName")
    }

    const packageDir = path.join(elmHomePackagesPath, author, name, version)

    console.log(`Deleting sideloaded package at ${packageDir} to force the compiler to re-download the package...`)

    return runtime.fileSystem
      .exists(packageDir)
      .andThen((exists) => {
        if (exists) {
          return runtime.fileSystem.deleteDir(packageDir)
        } else {
          return okAsync(undefined)
        }
      })
      .map(() => ({
        packageName,
        action: "restored" as const,
        source: "official package repository",
      }))
      .mapErr(() => "packageCopyFailed" as const)
  }

  const performUnload = (
    config: SideloadConfig,
    elmHomePackagesPath: string
  ): ResultAsync<AppliedChange[], CommandError> => {
    const unloadPromises = config.sideloads.map((sideload) =>
      removeSideloadedPackage(sideload.originalPackageName, sideload.originalPackageVersion, elmHomePackagesPath)
    )

    return ResultAsync.combine(unloadPromises)
  }

  return loadSideloadConfig(runtime)
    .andThen((config) =>
      getElmHomePackagesPath(runtime, config).andThen((elmHomePackagesPath) =>
        bustElmCache(runtime).andThen(() => performUnload(config, elmHomePackagesPath))
      )
    )
    .map((changes) => ({
      message: `Successfully unloaded ${changes.length} sideloads`,
      changes,
    }))
}

// =============================================================================
// Utility Functions
// =============================================================================

const bustElmCache = (runtime: Runtime): ResultAsync<void, CommandError> => {
  const elmStuffPath = path.join(runtime.environment.cwd, "elm-stuff", "0.19.1")

  return runtime.fileSystem
    .exists(elmStuffPath)
    .andThen((exists) => {
      if (exists) {
        console.log(`Deleting ${elmStuffPath} to bust compilation cache...`)
        return runtime.fileSystem.deleteDir(elmStuffPath)
      } else {
        return okAsync(undefined)
      }
    })
    .mapErr(() => "writeError" as const)
}

function resolveInputToSource(runtime: Runtime, input: ConfigureInput): ResultAsync<ConfigureSource, CommandError> {
  switch (input.type) {
    case "relative":
      return okAsync(input)

    case "github":
      if ("sha" in input.pinTo) {
        // Already has SHA, but still need to cache the repo
        const cacheDir = path.join(runtime.environment.cwd, ".elm.sideload.cache")
        const repoUrlParts = input.url.split("/")
        const author = repoUrlParts[repoUrlParts.length - 2]
        const repoName = repoUrlParts[repoUrlParts.length - 1].replace(".git", "")
        const targetDir = path.join(cacheDir, author, repoName)
        const sha = input.pinTo.sha

        return runtime.gitIO
          .clone(input.url, targetDir)
          .andThen(() => runtime.gitIO.checkout(targetDir, sha))
          .map(() => ({
            type: "github" as const,
            url: input.url,
            pinTo: { sha },
          }))
          .mapErr((gitError) => gitError)
      } else {
        // Has branch, resolve to SHA and cache
        const cacheDir = path.join(runtime.environment.cwd, ".elm.sideload.cache")
        const repoUrlParts = input.url.split("/")
        const author = repoUrlParts[repoUrlParts.length - 2]
        const repoName = repoUrlParts[repoUrlParts.length - 1].replace(".git", "")
        const targetDir = path.join(cacheDir, author, repoName)
        const branch = input.pinTo.branch

        return runtime.gitIO
          .clone(input.url, targetDir)
          .andThen(() => runtime.gitIO.resolveBranchToSha(targetDir, branch))
          .andThen((sha) => runtime.gitIO.checkout(targetDir, sha).map(() => sha))
          .map((sha) => ({
            type: "github" as const,
            url: input.url,
            pinTo: { sha },
          }))
          .mapErr((gitError) => gitError)
      }

    default:
      const _: never = input
      throw new Error(`Unhandled ConfigureInput type: ${(input as any).type}`)
  }
}

function copyPackageToElmHome(
  runtime: Runtime,
  sourcePath: string,
  packageName: string,
  version: string,
  elmHomePackagesPath: string
): ResultAsync<string, CommandError> {
  const [author, name] = packageName.split("/")
  if (!author || !name) {
    return errAsync("invalidPackageName")
  }

  const targetDir = path.join(elmHomePackagesPath, author, name, version)

  // Create target directory and copy all files from source to target
  return runtime.fileSystem
    .mkdir(targetDir)
    .andThen(() => runtime.fileSystem.copyDirectoryRecursive(sourcePath, targetDir))
    .map(() => targetDir)
    .mapErr(() => "packageCopyFailed" as const)
}

function getElmHomePackagesPath(runtime: Runtime, config: SideloadConfig): ResultAsync<string, CommandError> {
  // Check if requireElmHome is configured
  if (config.requireElmHome) {
    return runtime.environment.elmHome
      ? okAsync(path.join(runtime.environment.elmHome, "0.19.1", "packages"))
      : errAsync("noElmHome")
  }

  // Default: use `$ELM_HOME` if available, otherwise use default path (defined in the compiler, re-created here)
  const elmHome = runtime.environment.elmHome
  if (elmHome) {
    return okAsync(path.join(elmHome, "0.19.1", "packages"))
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

  return okAsync(path.join(defaultElmHome, "0.19.1", "packages"))
}

// =============================================================================
// Utility Functions
// =============================================================================

function loadElmJson(runtime: Runtime): ResultAsync<ElmJson, CommandError> {
  const elmJsonPath = path.join(runtime.environment.cwd, "elm.json")

  const parseElmJson = (content: string): Result<ElmJson, CommandError> => {
    try {
      return ok(JSON.parse(content) satisfies ElmJson)
    } catch (error) {
      return err("couldNotReadElmJson")
    }
  }

  return runtime.fileSystem.readFile(elmJsonPath).andThen(parseElmJson)
}

function loadSideloadConfig(runtime: Runtime): ResultAsync<SideloadConfig, CommandError> {
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
