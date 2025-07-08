# elm-sideload

**elm-sideload: congratulations, you can write javascript again**

A CLI tool for sideloading/overriding Elm packages from your `elm.json`.

## warning

This is _extremely alpha_. Proceed with caution.

✅ Tested and working with `elm make`
❌ Not tested at all on Windows (if somebody wants to check that out, it'd be cool)
❌ Not tested with Lamdera
❌ Not tested with elm-pages
❌ Not tested with Zokka

## installation

```bash
npm install --save-dev elm-sideload
```

## quick start

```bash
# run with no arguments to see the helptext
elm-sideload

# initialize sideload configuration
elm-sideload init

# configure elm/virtual-dom with Simon's browser extension patches
elm-sideload configure elm/virtual-dom --github https://github.com/lydell/virtual-dom --branch safe
elm-sideload configure elm/html --github https://github.com/lydell/html --branch safe
elm-sideload configure elm/browser --github https://github.com/lydell/browser --branch safe

# apply the sideloads
elm-sideload install

# build your Elm app
elm make src/Main.elm
```

## are you sure this is a good idea?

We're doing as much as we can to make this a safe and stable experience out here:

- When you attempt to install a sideload, if the package that you're attempting to overwrite does not exist in your local packages directory, the program will fail rather than risk putting your system in an inconsistent state.
- Branch names are resolved to commit SHAs immediately and only SHAs are stored in your configuration file, ensuring reproducible builds.
- Git repositories are cloned to a local cache directory (`.elm.sideload.cache`) for faster subsequent operations.
- All file operations use functional error handling with comprehensive error reporting.

## why have you done this?

It's wild out there. Many packages in the `elm` organization on GitHub have outstanding pull requests, open issues, and so on.

I am personally a big giant fan of and shill for the man/myth/legend known as `evancz`, and I have all of the respect in the world for his style of working. This isn't some "phillip the fifth"-ass bullshit or whatever (if you know, you know). But the thing is, at time of writing, pretty much 100% of deployed Elm applications suffer from the whole "oh no what if somebody installs literally any browser extension" explosion-at-runtime. Elm-Certified Level 40 Decoder Wizard https://github.com/lydell has released a bunch of patches for `elm/virtual-dom` that fix this issue, as well as a handy guide on installing those packages.

The real fix would be to get everybody using https://github.com/Zokka-Dev/zokka-compiler/ until we hear news from The Evan, but since many of our friends are using the Lamdera compiler or somesuch, well - look, if I knew how to merge the "package override" bits of the Zokka compiler with the Lamdera compiler, I wouldn't be doing this in Typescript, now, would I?

So here's this. It's a blood-clotting agent. Nothing more. Batteries included, but pay attention to which direction the terminals are facing when you put them in. Lipo fires are hard to extinguish. By using this software, you are accepting responsibility on behalf of your users for leaving the Safe Zone of the Elm compiler and its guarantees. You are stating that you know what you are doing. And I believe you, and I believe in you, or else I wouldn't be doing this - just, be careful, alright?

## License

MIT 