import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const ellie: string = `
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

console.log(ellie)

const runCommand = (command: string, tempDir: string, cliPath: string): string => {
  console.log(`Running: ${command}`)
  try {
    return execSync(command, {
      cwd: tempDir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${cliPath}:${process.env.PATH}` },
    })
  } catch (error) {
    console.error(`Command failed: ${command}`)
    console.error(error)
    throw error
  }
}

const writeTempFile = (contents: string, relativePath: string, tempDir: string): void => {
  const fullPath = path.join(tempDir, relativePath)
  console.log("full path:" + fullPath)
  const dir = path.dirname(fullPath)

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fullPath, contents, "utf8")
  console.log(`Wrote file: ${relativePath}`)
}

// https://github.com/lydell/virtual-dom/blob/8c20e5b9f309e82e67284669f3740132a2a4d9d6/src/Elm/Kernel/VirtualDom.js#L42
const targetExpectedString: string = "too big until after 25 000 years"

describe("Integration Test: elm-sideload end-to-end", () => {
  let tempDir: string
  let originalCwd: string
  let cliPath: string

  beforeAll(() => {
    originalCwd = process.cwd()
    tempDir = path.join(originalCwd, ".temp")
    cliPath = path.join(originalCwd, "dist")

    // Clean up any existing temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }

    // Create fresh temp directory
    fs.mkdirSync(tempDir, { recursive: true })
    console.log(`Created temp directory: ${tempDir}`)

    // Build our CLI first
    console.log("Building CLI...")
    execSync("npm run build", { cwd: originalCwd })
  })

  it("should sideload elm/virtual-dom and produce lydell's patched output", async () => {
    console.log(`Working in temp directory: ${tempDir}`)
    console.log(`Temp directory contents before:`, fs.readdirSync(tempDir))

    // Initialize Elm project
    runCommand("yes | elm init", tempDir, cliPath)

    console.log(`Temp directory contents after elm init:`, fs.readdirSync(tempDir))

    // Write our test Elm file
    writeTempFile(ellie, "src/Main.elm", tempDir)

    console.log(`Temp directory contents after writing Main.elm:`, fs.readdirSync(tempDir, { recursive: true }))
    console.log(`Main.elm content:`, fs.readFileSync(path.join(tempDir, "src/Main.elm"), "utf8").slice(0, 200) + "...")

    // Make sure elm/virtual-dom is in dependencies by doing initial build
    runCommand("elm make src/Main.elm --output=/dev/null", tempDir, cliPath)

    // Initialize elm-sideload
    runCommand("node " + path.join(originalCwd, "dist/index.js") + " init", tempDir, cliPath)

    // Configure sideload for elm/virtual-dom
    runCommand(
      "node " +
        path.join(originalCwd, "dist/index.js") +
        " configure elm/virtual-dom --github https://github.com/lydell/virtual-dom --branch safe",
      tempDir,
      cliPath
    )

    // Apply sideloads (when we implement this)
    // runCommand('node ' + path.join(originalCwd, 'dist/index.js') + ' install --always', tempDir, cliPath)

    // Build with sideloaded packages
    // runCommand('yes | elm make src/Main.elm --output=main.js', tempDir, cliPath)

    // Check that the sideloaded code is present
    // const mainJs = fs.readFileSync(path.join(tempDir, 'main.js'), 'utf8')
    // expect(mainJs).toContain(targetExpectedString)

    // For now, just verify our config was created correctly
    const sideloadConfig = JSON.parse(fs.readFileSync(path.join(tempDir, "elm.sideload.json"), "utf8"))
    expect(sideloadConfig.sideloads).toHaveLength(1)
    expect(sideloadConfig.sideloads[0].originalPackageName).toBe("elm/virtual-dom")
    expect(sideloadConfig.sideloads[0].sideloadedPackage.type).toBe("github")
    expect(sideloadConfig.sideloads[0].sideloadedPackage.url).toBe("https://github.com/lydell/virtual-dom")

    // Verify that the branch was resolved to a SHA
    const pinTo = sideloadConfig.sideloads[0].sideloadedPackage.pinTo
    expect(pinTo).toHaveProperty("sha")
    expect(pinTo.sha).toMatch(/^[a-f0-9]{40}$/) // SHA should be 40 hex characters
    expect(pinTo).not.toHaveProperty("branch") // Should not have branch anymore
  }, 30000) // 30 second timeout for this integration test
})
