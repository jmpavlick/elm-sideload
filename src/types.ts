import { Result } from "neverthrow"

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
  source: ConfigureSource
}

export type ConfigureSource =
  | { type: "github"; url: string; pinTo: { branch: string } }
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

export type Runtime = {
  command: Command
  environment: Environment
  fileSystem: FileSystemAdapter
}

export type Environment = {
  elmHome: string
  cwd: string
  hasElmJson: boolean
  hasSideloadConfig: boolean
}

// =============================================================================
// Configuration Types
// =============================================================================

export type SideloadConfig = {
  elmJsonPath: string
  elmHomePackagesPath?:
    | { type: "relative"; path: string }
    | { type: "absolute"; path: string }
    | { type: "requireElmHome"; value: true }
  sideloads: SideloadRegistration[]
}

export type SideloadRegistration = {
  originalPackageName: string
  originalPackageVersion: string
  sideloadedPackage: SideloadSource
}

export type SideloadSource =
  | { type: "github"; url: string; pinTo: { branch: string } }
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
  readFile: (path: string) => Result<string, FileError>
  writeFile: (path: string, content: string) => Result<void, FileError>
  exists: (path: string) => Result<boolean, FileError>
  mkdir: (path: string) => Result<void, FileError>
  deleteFile: (path: string) => Result<void, FileError>
  deleteDir: (path: string) => Result<void, FileError>
}

// =============================================================================
// Error Types
// =============================================================================

export type FileError = "fileNotFound" | "readError" | "writeError" | "permissionDenied" | "directoryNotFound"

export type ValidationError =
  | "noElmJsonFound"
  | "packageNotFoundInElmJson"
  | "invalidGithubUrl"
  | "invalidRelativePath"
  | "sideloadConfigNotFound"
  | "invalidSideloadConfig"
  | "couldNotReadElmJson"

export type RuntimeError = "noElmHome" | "couldNotCreateRuntime" | "invalidArguments"

export type CommandError = FileError | ValidationError | RuntimeError

// =============================================================================
// Execution Results
// =============================================================================

export type ExecutionResult = {
  success: boolean
  message: string
  changes?: AppliedChange[]
}

export type AppliedChange = {
  packageName: string
  action: "sideloaded" | "restored" | "downloaded"
  source: string
}
