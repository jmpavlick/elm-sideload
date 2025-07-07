# elm-sideload

**elm-sideload: congratulations, you can write javascript again**

A CLI tool for sideloading/overriding Elm packages from your `elm.json`.

## Getting Started

### Installation

```bash
npm install --save-dev elm-sideload
```

### Quick Start

```bash
# Initialize sideload configuration
elm-sideload init

# Configure elm/virtual-dom with Simon's browser extension patches
elm-sideload configure elm/virtual-dom --github https://github.com/lydell/virtual-dom --branch safe
elm-sideload configure elm/html --github https://github.com/lydell/html --branch safe
elm-sideload configure elm/browser --github https://github.com/lydell/browser --branch safe

# Apply the sideloads
elm-sideload install --always

# Build your Elm app (now protected from browser extension crashes!)
elm make src/Main.elm
```

## Commands

### Getting Help

```bash
elm-sideload
```
Prints the help text. Maybe pipe it to `less`?

### Getting Started

```bash
elm-sideload init
```
Creates your `elm.sideload.json`, and configures necessary filepaths, creates a folder `.elm.sideload.cache` in your working directory, and attempts to add the `.elm.sideload.cache` folder to your `.gitignore`.

If you already have an `elm.sideload.json`, this command will signal adversity and exit.

### Updating Your Sideload Configuration

```bash
elm-sideload configure <author/package> [flags]
```
Update your `elm.sideload.json` to add a "sideloaded" package to overwrite the package specified in the arguments, using `[flags]` to specify a source for the sideloaded package. The `configure` command will look for a reference to the package-to-overwrite in your `elm.json`, and will fail if it can't find one.

#### Configure from GitHub

```bash
elm-sideload configure <author/package> --github <github-url> --branch <branch-name>
```
Install from a Github URL. Pin to the latest commit SHA on that branch. Fails if it can't find the repo by URL, or if it can't find a branch with that name on the repo.

```bash
elm-sideload configure <author/package> --github <github-url> --sha <sha-value>
```
Install from a Github URL. Pin to a specific SHA. Fails if it can't find the repo by URL, or if it can't find a commit with that SHA on the repo.

#### Configure from Local Directory

```bash
elm-sideload configure <author/package> --relative <relative-folder-path>
```
Install from a relative folder path. The folder path that you use as an argument should be the folder that has the sideloaded package's `elm.json` _in it_.

### Applying Your Sideload Configuration

```bash
elm-sideload install
```
INTERACTIVELY apply the `elm.sideload.json` configuration. This is the step that actually copies or overwrites files.

Running this command will:
- Check for an `elm.sideload.json`; if one does not exist, it will signal adversity and exit
- Check to see if you have an `$ELM_HOME` set, and:
  - If you have an `$ELM_HOME` set, print its value
  - If you do _not_ have an `$ELM_HOME` set, print the value of the directory that it intends to write to
- Check for the `elm.json` in your `elm.sideload.json`; if it does not exist, it will signal adversity and exit
- If you have set an `elmHomePackagesPath` in your `elm.sideload.json`:
  - For `relative` or `absolute`, it will ensure that the target directory exists _and_ is writable; if not, it will signal adversity and exit
  - For `requireElmHome: true`, it will use the default path as constructed from `$ELM_HOME`; if you set `requireElmHome: true` and the program runs in a shell without `$ELM_HOME` set, it will signal adversity and exit.
- If the program is still running at this point, IT WILL ASK YOU TO CONFIRM! that you DO IN FACT want to overwrite the target packages with your sideloads. It will time out, signal adversity, and exit if a response is not provided quickly enough.
  - If you intentionally decline, the program will exit signaling success.
  - If you accept, the program will continue.
- The program will then:
  - Download any sideloaded packages that are not yet in `.elm.sideload.cache`
  - Apply all cached sideloaded packages
  - Print a summary of the packages that it changed
- If any of your sideloads:
  - Are not in cache, or
  - Fail to download, or
  - Are not accessible,
  - The program will exit, signaling adversity with a list of which packages were available to sideload, and which packages weren't

#### Non-Interactive Installation

```bash
elm-sideload install --always
```
Apply the `elm.sideload.json` without asking for permission. Does all of the above checks, and fails if any of them fail.

```bash
elm-sideload install --dry-run
```
Does everything _except_ overwrite files at the end; doesn't prompt for input.

### Undoing Your Sideload Configuration

```bash
elm-sideload unload
```
Deletes any sideloaded packages referenced in your `elm.sideload.json` so that the Elm compiler can re-download them from the official packages repository.

## How Does It Work?

We're doing as much as we can to make this a safe and stable experience out here:

- When you attempt to install a sideload, if the package that you're attempting to overwrite does not exist in your local packages directory, the program will fail rather than risk putting your system in an inconsistent state.
- Branch names are resolved to commit SHAs immediately and only SHAs are stored in your configuration file, ensuring reproducible builds.
- Git repositories are cloned to a local cache directory (`.elm.sideload.cache`) for faster subsequent operations.
- All file operations use functional error handling with comprehensive error reporting.

## Why Have You Done This?

It's wild out there. Many packages in the `elm` organization on GitHub have outstanding pull requests, open issues, and so on.

I am personally a big giant fan of and shill for the man/myth/legend known as `evancz`, and I have all of the respect in the world for his style of working. This isn't some "phillip the fifth"-ass bullshit or whatever (if you know, you know). But the thing is, at time of writing, pretty much 100% of deployed Elm applications suffer from the whole "oh no what if somebody installs literally any browser extension" explosion-at-runtime. Elm-Certified Level 40 Decoder Wizard https://github.com/lydell has released a bunch of patches for 'elm/virtual-dom' that fix this issue, as well as a handy guide on installing those packages.

The real fix would be to get everybody using https://github.com/Zokka-Dev/zokka-compiler/ until we hear news from The Evan, but since many of our friends are using the Lamdera compiler or somesuch, well - look, if I knew how to merge the "package override" bits of the Zokka compiler with the Lamdera compiler, I wouldn't be doing this in Typescript, now, would I?

So here's this. It's a blood-clotting agent. Nothing more. Batteries included, but pay attention to which direction the terminals are facing when you put them in. Lipo fires are hard to extinguish. By using this software, you are accepting responsibility on behalf of your users for leaving the Safe Zone of the Elm compiler and its guarantees. You are stating that you know what you are doing. And I believe you, and I believe in you, or else I wouldn't be doing this - just, be careful, alright?

## Development

### Architecture

This project uses the README.md as the single source of truth for CLI help documentation. The help text is automatically generated from this README at compile time using a simple Node.js script.

To update the CLI help text:
1. Edit this README.md file
2. Run `npm run build` (the help text is regenerated automatically via the prebuild script)

### Building

```bash
npm run build               # Automatically generates help text from README.md, then compiles TypeScript
npm run generate-help       # Just regenerate help text without building
```

### Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Run tests in watch mode
```

### Type Checking

```bash
npm run type-check
```

## License

MIT 