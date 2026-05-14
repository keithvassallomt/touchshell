UUID := "touchshell@touchshell.com"
ZIP := "dist/" + UUID + ".shell-extension.zip"

# List available recipes
default:
    @just --list

# Build the EGO-submittable extension zip into ./dist/
generate-zip:
    ./scripts/pack.sh

# Build the zip and lint it with shexli (EGO review parity)
validate: generate-zip
    [ -d venv ] || python3 -m venv venv
    . venv/bin/activate && pip install -U shexli && shexli {{ZIP}}
