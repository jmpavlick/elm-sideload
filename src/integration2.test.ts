import { describe, it, expect, beforeAll } from "vitest"
import { execSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

/**
 * TEST SETUP
 */
const ellie = `
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

// project root
const ROOT: string = process.cwd()
// build output folder
const DIST: string = path.join(ROOT, "dist")
// last-built executable path
const BIN_PATH: string = `node ${path.join(DIST, "index.js")}`
// test output folder
const TEST_OUTPUT_DIR: string = path.join(ROOT, ".test")

// run a command-line invocation
const toRunCmd = (workDir: string) => (command: string) => {
  const executableCommand: string = command.replace("elm-sideload", BIN_PATH)
  process.stdout.write(`$ ${command}\n\n`)

  // Determine shell based on OS and environment
  const getShell = () => {
    if (process.env.SHELL) return process.env.SHELL
    if (process.platform === "win32") return "cmd"
    return "/bin/bash" // Default for Unix-like systems (Linux, macOS)
  }

  const commandOutput = execSync(executableCommand, {
    cwd: workDir,
    encoding: "utf-8",
    env: { ...process.env, PATH: `${DIST}:${process.env.PATH}` },
    shell: getShell(),
  })

  process.stdout.write(`${commandOutput}\n\n`)
}

type Compiler = {
  label: string
  init: string
  install: (packageName: string) => string
  srcDirName: string
  make: string
  compiledFilename: string
}

const toInitializedEnv = (compiler: Compiler, elmHome?: string) => (testOutputDir: string) => {
  // define and clear working directory for test output
  const workDir = path.join(TEST_OUTPUT_DIR, compiler.label, testOutputDir)
  fs.rmSync(workDir, { recursive: true, force: true })
  fs.mkdirSync(workDir, { recursive: true })

  // create run command
  const runCmd = toRunCmd(workDir)

  // clean-build the app

  runCmd("npm run build")

  // if `elmHome` has a value, set the env var ELM_HOME to `elmHome`
  if (elmHome) {
    if (!fs.existsSync(elmHome)) {
      // if the directory doesn't exist, create it
      fs.mkdirSync(elmHome)
    }

    process.env.ELM_HOME = elmHome
  }

  // create a new elm app
  runCmd(compiler.init)
  // write the test `Main.elm` to the new `src` directory
  fs.writeFileSync(path.join(workDir, compiler.srcDirName, "Main.elm"), ellie, "utf-8")

  return {
    runCmd,
    getSideloadConfig: () => fs.readFileSync(path.join(workDir, "elm.sideload.config"), "utf-8"),
    getCompiledOutput: () => fs.readFileSync(path.join(workDir, compiler.compiledFilename), "utf-8"),
  }
}

// define an evaluation to get an environment and all tests for a given compiler
const toSuite =
  (compiler: Compiler, elmHome?: string) =>
  (
    tests: (
      compiler: Compiler
    ) => [
      string,
      (() => string | void)[],
      ({
        getSideloadConfig,
        getCompiledOutput,
      }: {
        getSideloadConfig: () => string
        getCompiledOutput: () => string
      }) => void,
    ][]
  ) => {
    describe(`end-to-end for ${compiler.label} with $ELM_HOME ${elmHome ? `set to ${elmHome}` : "unset"}`, () => {
      // define an evaluation to get a unique filesystem location for each test
      const toTestSlug = (title: string) => `${compiler.label}_${title}`.toLowerCase().replace(/[^a-z]/g, "-")

      // define an evaluation to wrap the test setup, execution, and assertions for each test
      const toTest =
        (title: string, setup: (() => string | void)[]) =>
        (
          runAssertions: ({
            getSideloadConfig,
          }: {
            getSideloadConfig: () => string
            getCompiledOutput: () => string
          }) => void
        ) => {
          const testSlug: string = toTestSlug(title)

          process.stdout.write(`# suite for ${compiler.label}\n\n`)

          it(testSlug, async () => {
            process.stdout.write(`## ${title}\n\n`)
            const { runCmd, getSideloadConfig, getCompiledOutput } = toInitializedEnv(compiler, elmHome)(testSlug)

            // run commands
            setup.map((thunk) => {
              const evaluated = thunk()

              if (typeof evaluated === "string") {
                runCmd(evaluated)
              }
            })

            // perform assertions

            runAssertions({ getSideloadConfig, getCompiledOutput })
          })
        }

      // Run all the provided tests
      tests(compiler).forEach(([title, setup, runAssertions]) => {
        toTest(title, setup)(runAssertions)
      })
    })
  }

const compilers: Compiler[] = [
  {
    label: "elm",
    init: "yes | elm init",
    install: (packageName) => `yes | elm install ${packageName}`,
    srcDirName: "src",
    make: "elm make src/Main.elm",
    compiledFilename: "index.html",
  },
]

// global setup
process.stdout.write(`global setup: deleting and re-creating test output directory: ${TEST_OUTPUT_DIR}\n`)
fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true })
fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true })

// Test definitions
const tests = (
  compiler: Compiler
): [
  string,
  (() => string | void)[],
  ({
    getSideloadConfig,
    getCompiledOutput,
  }: {
    getSideloadConfig: () => string
    getCompiledOutput: () => string
  }) => void,
][] => [
  [
    "environment setup should succeed",
    [() => compiler.make],
    (env) => {
      const { getCompiledOutput } = env

      // if this call succeeds, we were able to run the compiler and read the compiled output back in
      const _ = getCompiledOutput()
    },
  ],
  [
    "init should succeed",
    [() => "elm-sideload"],
    (env) => {
      const { getSideloadConfig } = env
    },
  ],
]

// ACTUALLY DO SOMETHING
compilers.forEach((compiler) => toSuite(compiler)(tests))
