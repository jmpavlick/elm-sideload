import * as os from "os"
import * as path from "path"
import * as fs from "fs"
import { type Result, ok, err } from "neverthrow"
import dedent from "dedent"

type Err = "noElmJsonFound" | "noDependenciesFound" | "couldNotReadElmJson"

export function getElmHome(): string {
  // Check for ELM_HOME environment variable first
  const maybeCustomHome = process.env.ELM_HOME

  if (maybeCustomHome) {
    return maybeCustomHome
  }

  // Fall back to platform-specific app user data directory
  return getAppUserDataDirectory("elm")
}

export function getAppUserDataDirectory(appName: string): string {
  const platform = os.platform()
  const homeDir = os.homedir()

  switch (platform) {
    case "win32":
      // Windows: %APPDATA%\appName
      return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName)

    default:
      // Unix-like systems (macOS, Linux, etc.): ~/.appName
      return path.join(homeDir, "." + appName)
  }
}

console.log("hello world")
console.log("Elm home:", getElmHome())

export type SideloadRegistration = {
  originalPackageName: string
  originalPackageVersion: string
  sideloadedPackage:
    | { githubRepoUrl: string; pinTo: { branch: string } | { sha: string } }
    | { relativeDirectoryPath: string }
}

export type Config = {
  elmJsonPath: string
  elmHomePackagesPath?: { relative: string } | { absolute: string } | { requireElmHome: true }
  sideloads: SideloadRegistration[]
}

type ElmJson = {
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

function toInstalledPackages(
  elmJson: ElmJson
): Result<{ originalPackageName: string; originalPackageVersion: string }[], Err> {
  const { dependencies } = elmJson

  const { direct, indirect } = dependencies

  const { direct: testDirect, indirect: testIndirect } = dependencies["test-dependencies"]

  const allDependencies = Object.entries({
    ...direct,
    ...indirect,
    ...testDirect,
    ...testIndirect,
  }).map(([originalPackageName, originalPackageVersion]) => ({
    originalPackageName,
    originalPackageVersion,
  }))

  return allDependencies.length > 0 ? ok(allDependencies) : err("noDependenciesFound")
}

function readElmJson(elmJsonPath: string): Result<string, Err> {
  try {
    const contents = fs.readFileSync(elmJsonPath).toString()
    return ok(contents)
  } catch (e) {
    console.error(e)
    return err("couldNotReadElmJson")
  }
}

function init() {}

function help(): void {
  const str = dedent`
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

  console.log(str)
}
