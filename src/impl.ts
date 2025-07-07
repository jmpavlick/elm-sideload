import { Result, ok, err } from "neverthrow"
import * as path from "path"
import * as child_process from "child_process"
import * as fs from "fs"
import dedent from "dedent"
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
        message: getHelpText(),
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

function getHelpText(): string {
  return dedent`
    elm-sideload: congratulations, you can write javascript again

    getting help:

      elm-sideload
          Prints the text that you see here. Maybe pipe it to 'less'?

    getting started:

      elm-sideload init
          Creates your 'elm.sideload.json', and configures necessary filepaths, creates a folder '.elm.sideload.cache' in your working directory,
          and attempts to add the '.elm.sideload.cache' folder to your '.gitignore'.

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
            - If you have set an 'elmHomePackagesPath' in your 'elm.sideload.json':
              - For 'relative' or 'absolute', it will ensure that the target directory exists _and_ is writable; if not, it will signal adversity and exit
              - For 'requireElmHome: true', it will use the default path as constructed from '$ELM_HOME'; if you set 'requireElmHome: true' and
                the program runs in a shell without '$ELM_HOME' set, it will signal adversity and exit.
            - If the program is still running at this point, IT WILL ASK YOU TO CONFIRM! that you DO IN FACT want to overwrite the target packages
              with your sideloads. It will time out, signal adversity, and exit if a response is not provided quickly enough.
              - If you intentionally decline, the program will exit signaling success.
              - If you accept, the program will continue.
            - The program will then:
              - Download any sideloaded packages that are not yet in '.elm.sideload.cache'
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

    how does it work:

        We're doing as much as we can to make this a safe and stable experience out here:

        - When you attempt to install a sideload, if the package that you're attempting to overwrite does not exist in your 

    why have you done this:

        It's wild out there. Many packages in the 'elm' organization on GitHub have outstanding pull requests, open issues, and so on.

        I am personally a big giant fan of and shill for the man/myth/legend known as 'evancz', and I have all of the respect in the world
        for his style of working. This isn't some "phillip the fifth"-ass bullshit or whatever (if you know, you know). But the thing is, at time of
        writing, pretty much 100% of deployed Elm applications suffer from the whole "oh no what if somebody installs literally any browser
        extension" explosion-at-runtime. Elm-Certified Level 40 Decoder Wizard https://github.com/lydell has released a bunch of patches for
        'elm/virtual-dom' that fix this issue, as well as a handy guide on installing those packages.

        The real fix would be to get everybody using https://github.com/Zokka-Dev/zokka-compiler/ until we hear news from The Evan, but since
        many of our friends are using the Lamdera compiler or somesuch, well - look, if I knew how to merge the "package override" bits of
        the Zokka compiler with the Lamdera compiler, I wouldn't be doing this in Typescript, now, would I?

        So here's this. It's a blood-clotting agent. Nothing more. Batteries included, but pay attention to which direction the terminals are
        facing when you put them in. Lipo fires are hard to extinguish. By using this software, you are accepting responsibility on behalf of
        your users for leaving the Safe Zone of the Elm compiler and its guarantees. You are stating that you know what you are doing. And I believe you,
        and I believe in you, or else I wouldn't be doing this - just, be careful, alright?
  `
}

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
            : performInstallation(config, cacheDir, elmHomePackagesPath)
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
