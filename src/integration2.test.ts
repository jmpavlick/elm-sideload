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
const toRunCmd = (workDir: string, logFile: string) => (command: string) => {
  const executableCommand: string = command.replace("elm-sideload ", `${BIN_PATH} `)
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

  // Write to both stdout and file
  process.stdout.write(`${commandOutput}\n\n`)
  fs.appendFileSync(logFile, `$ ${command}\n${commandOutput}\n\n`)

  return commandOutput
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
  const runCmd = toRunCmd(workDir, path.join(workDir, "command.log"))

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
    getElmSideloadConfig: () => fs.readFileSync(path.join(workDir, "elm.sideload.json"), "utf-8"),
    getCompiledOutput: () => fs.readFileSync(path.join(workDir, compiler.compiledFilename), "utf-8"),
    getStdout: () => fs.readFileSync(path.join(workDir, "command.log"), "utf-8"),
    elmSideloadCacheDir: path.join(workDir, ".elm.sideload.cache"),
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
        runCmd,
        getElmSideloadConfig,
        getCompiledOutput,
        getStdout,
        elmSideloadCacheDir,
      }: {
        runCmd: (command: string) => string
        getElmSideloadConfig: () => string
        getCompiledOutput: () => string
        getStdout: () => string
        elmSideloadCacheDir: string
      }) => void,
    ][]
  ) => {
    describe(`end-to-end for ${compiler.label} with $ELM_HOME ${elmHome ? `set to ${elmHome}` : "unset"}`, () => {
      // Print suite header once
      process.stdout.write(`# suite for ${compiler.label}\n\n`)

      // define an evaluation to get a unique filesystem location for each test
      const toTestSlug = (title: string) => `${compiler.label}_${title}`.toLowerCase().replace(/[^a-z]/g, "-")

      // define an evaluation to wrap the test setup, execution, and assertions for each test
      const toTest =
        (title: string, setup: (() => string | void)[]) =>
        (
          runAssertions: ({
            runCmd,
            getElmSideloadConfig,
            getCompiledOutput,
            getStdout,
            elmSideloadCacheDir,
          }: {
            runCmd: (command: string) => string
            getElmSideloadConfig: () => string
            getCompiledOutput: () => string
            getStdout: () => string
            elmSideloadCacheDir: string
          }) => void
        ) => {
          const testSlug: string = toTestSlug(title)

          it(title, async () => {
            process.stdout.write(`## ${title}\n\n`)
            const { runCmd, getElmSideloadConfig, getCompiledOutput, getStdout, elmSideloadCacheDir } =
              toInitializedEnv(compiler, elmHome)(testSlug)

            // run commands
            setup.map((thunk) => {
              const evaluated = thunk()

              if (typeof evaluated === "string") {
                runCmd(evaluated)
              }
            })

            // perform assertions
            runAssertions({ runCmd, getElmSideloadConfig, getCompiledOutput, getStdout, elmSideloadCacheDir })
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
    runCmd,
    getElmSideloadConfig,
    getCompiledOutput,
    getStdout,
    elmSideloadCacheDir,
  }: {
    runCmd: (command: string) => string
    getElmSideloadConfig: () => string
    getCompiledOutput: () => string
    getStdout: () => string
    elmSideloadCacheDir: string
  }) => void,
][] => [
  /*
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
    "help command should work",
    [() => "elm-sideload"],
    (env) => {
      const { getStdout } = env
      const stdout = getStdout()

      expect(stdout).toContain("elm-sideload: congratulations")
    },
  ],
  [
    "init command should work",
    [() => "elm-sideload init"],
    (env) => {
      const { getStdout, getElmSideloadConfig } = env
      const stdout = getStdout()
      const elmSideloadConfig = getElmSideloadConfig()

      expect(stdout).toContain("Created elm.sideload.json, .elm.sideload.cache directory, and updated .gitignore")
    },
  ],
  */
  [
    "github should update config, get sha, and cache the clone",
    [
      () => "elm-sideload init",
      () => "elm-sideload configure elm/virtual-dom --github https://github.com/lydell/virtual-dom --branch safe",
    ],
    (env) => {
      // setup
      const { runCmd, getStdout, getElmSideloadConfig, elmSideloadCacheDir } = env
      const stdout = getStdout()
      const elmSideloadConfig = JSON.parse(getElmSideloadConfig())

      // Get the actual SHA from the cached git repo
      const gitSha = runCmd(`git -C ${elmSideloadCacheDir}/lydell/virtual-dom rev-parse HEAD`).trim()

      // assertions
      expect(elmSideloadConfig.sideloads).toHaveLength(1)
      expect(elmSideloadConfig.sideloads[0].originalPackageName).toBe("elm/virtual-dom")
      expect(elmSideloadConfig.sideloads[0].sideloadedPackage.type).toBe("github")
      expect(elmSideloadConfig.sideloads[0].sideloadedPackage.url).toBe("https://github.com/lydell/virtual-dom")
      expect(elmSideloadConfig.sideloads[0].sideloadedPackage.pinTo.sha).toBe(gitSha)
      expect(elmSideloadConfig.sideloads[0].sideloadedPackage.pinTo).not.toHaveProperty("branch")

      // Verify the repo was cached
      expect(fs.existsSync(path.join(elmSideloadCacheDir, "elm", "virtual-dom"))).toBe(true)
      expect(fs.existsSync(path.join(elmSideloadCacheDir, "elm", "virtual-dom", ".git"))).toBe(true)
    },
  ],
  /*
  [
    "configure command with github sha should work",
    [() => "elm-sideload configure elm/virtual-dom --github https://github.com/lydell/virtual-dom --sha abc123"],
    (env) => {
      throw new Error("TODO: implement configure github sha test")
    },
  ],
  [
    "configure command with relative path should work",
    [() => "elm-sideload configure elm/virtual-dom --relative ./local-package"],
    (env) => {
      throw new Error("TODO: implement configure relative test")
    },
  ],
  [
    "install command interactive should work",
    [() => "elm-sideload install"],
    (env) => {
      throw new Error("TODO: implement install interactive test")
    },
  ],
  [
    "install command always should work",
    [() => "elm-sideload install --always"],
    (env) => {
      throw new Error("TODO: implement install always test")
    },
  ],
  [
    "install command dry-run should work",
    [() => "elm-sideload install --dry-run"],
    (env) => {
      throw new Error("TODO: implement install dry-run test")
    },
  ],
  [
    "unload command should work",
    [() => "elm-sideload unload"],
    (env) => {
      throw new Error("TODO: implement unload test")
    },
  ],
  */
]

// ACTUALLY DO SOMETHING
compilers.forEach((compiler) => toSuite(compiler)(tests))
