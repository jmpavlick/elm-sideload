import dedent from "dedent"

const ellie: string = dedent`
module Main exposing (main)

import Browser
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)


type alias Model =
    { count : Int }


initialModel : Model
initialModel =
    { count = 0 }


type Msg
    = Increment
    | Decrement


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
const runCommand = (args: string) => {
  throw new Error("TODO: run this on the command line")
}

const writeTempFile = (contents: string, relativePath: string) => {
  throw new Error("TODO: write contents to a file")
}

const getBuildCommand = (): string => {
  throw new Error("TODO: get the CLI command to actually build the project for real")
}

const getAddBuiltOutputToPathCommand = (): string => {
  throw new Error(
    "TODO: this should make it so that in our sequence below, if the CLI gets `elm-sideload`, it runs our program"
  )
}

// after executing all of these commands, we should be able to
// read in the `index.html` file, and find our "target expected string"
const ioSequence: (() => void)[] = [
  () => runCommand(getBuildCommand()),
  () => runCommand(getAddBuiltOutputToPathCommand()),
  () => runCommand("cd ./.temp/"),
  () => runCommand("npx elm init"),
  () => writeTempFile(ellie, "./src/Main.elm"),
  () => runCommand("npx elm make"),
  () => runCommand("elm-sideload init"),
  () => runCommand("elm-sideload configure elm/virtual-dom --github https://github.com/lydell/virtual-dom"),
  () => runCommand("elm-sideload apply --always"),
  () => runCommand("elm make"),
]

// https://github.com/lydell/virtual-dom/blob/8c20e5b9f309e82e67284669f3740132a2a4d9d6/src/Elm/Kernel/VirtualDom.js#L42
const targetExpectedString: string = "too big until after 25 000 years"
