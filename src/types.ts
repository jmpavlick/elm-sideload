import { Result, ResultAsync } from "neverthrow"
import { type GitIO, type Error as GitIOError } from "./gitIO"

// =============================================================================
// CLI Command Types
// =============================================================================

export type Command = HelpCommand | InitCommand | ConfigureCommand | InstallCommand | UnloadCommand

export type HelpCommand = {
  type: "help"
}

export type InitCommand = {
  type: "init"
}

export type ConfigureCommand = {
  type: "configure"
  packageName: string // e.g. "elm/html"
  source: ConfigureInput
}

// CLI input types (before resolution)
export type ConfigureInput =
  | { type: "github"; url: string; pinTo: { branch: string } }
  | { type: "github"; url: string; pinTo: { sha: string } }
  | { type: "relative"; path: string }

// Internal storage types (after resolution - SHA only)
export type ConfigureSource =
  | { type: "github"; url: string; pinTo: { sha: string } }
  | { type: "relative"; path: string }

export type InstallCommand = {
  type: "install"
  mode: "interactive" | "always" | "dry-run"
}

export type UnloadCommand = {
  type: "unload"
}

// =============================================================================
// Runtime Environment
// =============================================================================

export interface Runtime {
  command: Command
  environment: Environment
  fileSystem: FileSystemAdapter
  gitIO: GitIO
  userIO: UserIOAdapter
}

export type ElmHome =
  | { type: "fromShellEnv"; elmHome: string; packagesPath: string }
  | { type: "fromOsDefault"; elmHome: string; packagesPath: string }

export interface Environment {
  elmHome: ElmHome
  cwd: string
  hasElmJson: boolean
  hasSideloadConfig: boolean
}

// =============================================================================
// Configuration Types
// =============================================================================

export type SideloadConfig = {
  elmJsonPath: string
  requireElmHome: boolean
  sideloads: SideloadRegistration[]
}

export type SideloadRegistration = {
  originalPackageName: string
  originalPackageVersion: string
  sideloadedPackage: SideloadSource
}

export type SideloadSource =
  | { type: "github"; url: string; pinTo: { sha: string } }
  | { type: "relative"; path: string }

export type ElmJson = {
  type: string
  "source-directories": string[]
  "elm-version": string
  dependencies: {
    direct: Record<string, string>
    indirect: Record<string, string>
    "test-dependencies": {
      direct: Record<string, string>
      indirect: Record<string, string>
    }
  }
}

// =============================================================================
// File System Adapter (for testing)
// =============================================================================

export type FileSystemAdapter = {
  readFile: (path: string) => ResultAsync<string, FileError>
  writeFile: (path: string, content: string) => ResultAsync<void, FileError>
  exists: (path: string) => ResultAsync<boolean, FileError>
  mkdir: (path: string) => ResultAsync<void, FileError>
  deleteFile: (path: string) => ResultAsync<void, FileError>
  deleteDir: (path: string) => ResultAsync<void, FileError>
  copyDirectoryRecursive: (source: string, target: string) => ResultAsync<void, FileError>
}

// =============================================================================
// User IO Adapter
// =============================================================================

export type UserIOAdapter = {
  prompt: (message: string) => ResultAsync<string, UserIOError>
}

// =============================================================================
// Error Types
// =============================================================================

export type UserIOError = "promptFailed"

export type FileError =
  | "fileNotFound"
  | "readError"
  | "writeError"
  | "permissionDenied"
  | "directoryNotFound"
  | "copyError"

export type ValidationError =
  | "noElmJsonFound"
  | "packageNotFoundInElmJson"
  | "invalidGithubUrl"
  | "invalidRelativePath"
  | "sideloadConfigNotFound"
  | "invalidSideloadConfig"
  | "couldNotReadElmJson"
  | "gitCloneFailed"
  | "invalidPackageName"
  | "packageCopyFailed"
  | "elmHomePathNotFound"
  | "unloadFailed"

export type RuntimeError = "noElmHome" | "couldNotCreateRuntime" | "invalidArguments" | "gitNotAvailable"

export type CommandError = FileError | ValidationError | RuntimeError | GitIOError | UserIOError

// =============================================================================
// Execution Results
// =============================================================================

export type ExecutionResult = {
  message: string
  changes?: AppliedChange[]
}

export type AppliedChange = {
  packageName: string
  action: "sideloaded" | "restored" | "downloaded"
  source: string
}
