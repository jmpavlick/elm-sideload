import { describe, it, expect, beforeAll } from "vitest"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

// =============================================================================
// Test Data
// =============================================================================

const testElmApp = `
module Main exposing (main)

import Browser
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)


type alias Model = { count : Int }


initialModel : Model
initialModel = { count = 0 }


type Msg = Increment | Decrement


update : Msg -> Model -> Model
update msg model =
    case msg of
        Increment ->
            { model | count = model.count + 1 }

        Decrement ->
            { model | count = model.count - 1 }


view : Model -> Html Msg
view model =
    div []
        [ button [ onClick Increment ] [ text "+1" ]
        , div [] [ text <| String.fromInt model.count ]
        , button [ onClick Decrement ] [ text "-1" ]
        ]


main : Program () Model Msg
main =
    Browser.sandbox
        { init = initialModel
        , view = view
        , update = update
        }
`

// The signature patch from lydell's repository
// https://github.com/lydell/virtual-dom/blob/8c20e5b9f309e82e67284669f3740132a2a4d9d6/src/Elm/Kernel/VirtualDom.js#L42
const lydellPatchSignature = "too big until after 25 000 years"

// =============================================================================
// Test Environment
// =============================================================================

type TestEnvironment = {
  tempDir: string
  originalCwd: string
  cliPath: string
  elmHome: string
}

function createTestEnvironment(testName?: string): TestEnvironment {
  const originalCwd = process.cwd()
  const tempDirName = testName ? `${testName}` : "default"
  const tempDir = path.join(originalCwd, ".test", tempDirName)
  const cliPath = path.join(originalCwd, "dist")
  const elmHome = path.join(os.homedir(), ".elm")

  return { tempDir, originalCwd, cliPath, elmHome }
}

function cleanupAllTestEnvironments(): void {
  const testBaseDir = path.join(process.cwd(), ".test")
  if (fs.existsSync(testBaseDir)) {
    fs.rmSync(testBaseDir, { recursive: true, force: true })
    console.log(`Cleaned up all test environments in: ${testBaseDir}`)
  }
}

function setupTestEnvironment(env: TestEnvironment): void {
  // Create fresh test directory (will be preserved after tests)
  fs.mkdirSync(env.tempDir, { recursive: true })
  console.log(`Created test directory: ${env.tempDir}`)
}

// =============================================================================
// Test Utilities
// =============================================================================

function runCommand(command: string, env: TestEnvironment): string {
  // Log command execution for debugging
  process.stdout.write(`$ ${command}\n`)
  try {
    return execSync(command, {
      cwd: env.tempDir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${env.cliPath}:${process.env.PATH}` },
    })
  } catch (error) {
    console.error(`Command failed: ${command}`)
    console.error(error)
    throw error
  }
}

function writeFile(contents: string, relativePath: string, env: TestEnvironment): void {
  const fullPath = path.join(env.tempDir, relativePath)
  const dir = path.dirname(fullPath)

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fullPath, contents, "utf8")
  console.log(`Wrote file: ${relativePath}`)
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8")
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath)
}

function getElmHomePackagePath(env: TestEnvironment, packageName: string, version: string): string {
  const [author, name] = packageName.split("/")
  return path.join(env.elmHome, "0.19.1", "packages", author, name, version)
}

function getKernelFilePath(env: TestEnvironment, packageName: string, version: string): string {
  return path.join(getElmHomePackagePath(env, packageName, version), "src", "Elm", "Kernel", "VirtualDom.js")
}

// =============================================================================
// CLI Execution Helpers
// =============================================================================

const ELM_SIDELOAD_BIN = (env: TestEnvironment): string => `node ${path.join(env.originalCwd, "dist/index.js")} init`

// =============================================================================
// Command Blocks
// =============================================================================

type CommandBlock = {
  name: string
  run: (env: TestEnvironment) => void
}

const setupElmProject: CommandBlock = {
  name: "Setup Elm Project",
  run: (env) => {
    console.log(`Working in temp directory: ${env.tempDir}`)
    console.log(`Temp directory contents before:`, fs.readdirSync(env.tempDir))

    // Initialize Elm project
    runCommand("yes | elm init", env)
    console.log(`Temp directory contents after elm init:`, fs.readdirSync(env.tempDir))

    // Write our test Elm file
    writeFile(testElmApp, "src/Main.elm", env)
    console.log(`Temp directory contents after writing Main.elm:`, fs.readdirSync(env.tempDir, { recursive: true }))

    // Make sure elm/virtual-dom is in dependencies by doing initial build
    runCommand("elm make src/Main.elm --output=/dev/null", env)
  },
}

const initializeSideload: CommandBlock = {
  name: "Initialize Sideload",
  run: (env) => {
    runCommand(`node ${path.join(env.originalCwd, "dist/index.js")} init`, env)
  },
}

const configureSideload: CommandBlock = {
  name: "Configure Sideload",
  run: (env) => {
    runCommand(
      `node ${path.join(env.originalCwd, "dist/index.js")} configure elm/virtual-dom --github https://github.com/lydell/virtual-dom --branch safe`,
      env
    )
  },
}

const applySideloads: CommandBlock = {
  name: "Apply Sideloads",
  run: (env) => {
    runCommand(`node ${path.join(env.originalCwd, "dist/index.js")} install --always`, env)
  },
}

const buildElmApp: CommandBlock = {
  name: "Build Elm App",
  run: (env) => {
    runCommand("elm make src/Main.elm --output=main.js", env)
  },
}

const unloadSideloads: CommandBlock = {
  name: "Unload Sideloads",
  run: (env) => {
    runCommand(`node ${path.join(env.originalCwd, "dist/index.js")} unload`, env)
  },
}

//

//

// =============================================================================
// Test Suite
// =============================================================================

describe("Integration Test: elm-sideload end-to-end", () => {
  let globalEnv: TestEnvironment

  beforeAll(() => {
    globalEnv = createTestEnvironment()

    // Clean up any existing test environments before starting
    cleanupAllTestEnvironments()

    // Build our CLI first
    console.log("Building CLI...")
    execSync("npm run build", { cwd: globalEnv.originalCwd })
  })

  it("should resolve branch to SHA and configure sideload", async () => {
    const env = createTestEnvironment("config-test")
    setupTestEnvironment(env)

    try {
      // Execute command blocks
      setupElmProject.run(env)
      initializeSideload.run(env)
      configureSideload.run(env)

      // Verify configuration was created correctly
      const sideloadConfig = JSON.parse(readFile(path.join(env.tempDir, "elm.sideload.json")))
      expect(sideloadConfig.sideloads).toHaveLength(1)
      expect(sideloadConfig.sideloads[0].originalPackageName).toBe("elm/virtual-dom")
      expect(sideloadConfig.sideloads[0].sideloadedPackage.type).toBe("github")
      expect(sideloadConfig.sideloads[0].sideloadedPackage.url).toBe("https://github.com/lydell/virtual-dom")

      // Verify that the branch was resolved to a SHA
      const pinTo = sideloadConfig.sideloads[0].sideloadedPackage.pinTo
      expect(pinTo).toHaveProperty("sha")
      expect(pinTo.sha).toMatch(/^[a-f0-9]{40}$/) // SHA should be 40 hex characters
      expect(pinTo).not.toHaveProperty("branch") // Should not have branch anymore
    } catch (error) {
      console.error(`Test failed in directory: ${env.tempDir}`)
      throw error
    }
  }, 30000)

  it("should complete full sideload cycle with lydell's patches", async () => {
    const env = createTestEnvironment("full-cycle-test")
    setupTestEnvironment(env)

    try {
      // Execute command blocks
      setupElmProject.run(env)
      initializeSideload.run(env)
      configureSideload.run(env)
      applySideloads.run(env)

      // Verify packages were installed to ELM_HOME
      const packagePath = getElmHomePackagePath(env, "elm/virtual-dom", "1.0.4")
      expect(fileExists(packagePath)).toBe(true)

      // Verify lydell's patches are present
      const kernelFilePath = getKernelFilePath(env, "elm/virtual-dom", "1.0.4")
      expect(fileExists(kernelFilePath)).toBe(true)

      const kernelContent = readFile(kernelFilePath)
      expect(kernelContent).toContain(lydellPatchSignature)

      // Build with sideloaded packages
      buildElmApp.run(env)

      // Verify the build succeeded with the sideloaded packages
      const mainJsPath = path.join(env.tempDir, "main.js")
      expect(fileExists(mainJsPath)).toBe(true)

      // The compiled output won't contain the comment, but the fact that it built
      // successfully with our sideloaded package proves the patches are active

      // Test unload functionality
      unloadSideloads.run(env)

      // Verify package was removed from ELM_HOME
      expect(fileExists(packagePath)).toBe(false)
    } catch (error) {
      console.error(`Test failed in directory: ${env.tempDir}`)
      throw error
    }
  }, 60000) // Longer timeout for full cycle
})
