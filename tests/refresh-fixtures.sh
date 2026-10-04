#!/bin/sh
# Refreshes the vendored copies of lich's hook-contract fixtures.
#
# The fixtures are canonical in the lich repository (docs/hooks/fixtures/
# there). This repository only vendors them so the test suite never needs the
# network. They are read at the lich release named in tests/lich-ref, never at
# main: a contract lich has merged but not released is one no user's lich
# speaks yet. Move that ref when a lich release changes a contract, run this,
# and make the scripts match; CI diffs the copy against that release and fails
# on drift.
#
# Never hand-edit a fixture to get a green run — a fixture moves in lich, and
# only because the contract moved.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ref=$(tr -d '[:space:]' <"$here/lich-ref")
base=https://raw.githubusercontent.com/omartelo/lich/$ref/docs/hooks/fixtures

for file in session-state.jsonl session-start.jsonl session-title.jsonl \
  session-touched.jsonl; do
  curl -fsSL "$base/$file" -o "$here/fixtures/$file"
  echo "refreshed $file at $ref"
done

# The mod-usage contract is in no lich release yet either: its fixture is read
# at a lich main commit that carries it, on the same terms as
# the block below, and folds into the first list once a release ships it.
usage=6476d2d27ebdb5716fd369647d383dbd13a00936
curl -fsSL "https://raw.githubusercontent.com/omartelo/lich/$usage/docs/hooks/fixtures/mod-usage.jsonl" \
  -o "$here/fixtures/mod-usage.jsonl"
echo "refreshed mod-usage.jsonl at $usage (unreleased)"

# The mod-control `command` and `ask` kinds are in no lich release yet: these two files are
# read at a lich main commit that carries them, so the
# module is held to the contract lich is about to ship rather than to the one
# it replaces. Once a release ships it, move tests/lich-ref there, fold these
# files back into the list above and delete this block.
pending=6476d2d27ebdb5716fd369647d383dbd13a00936
for file in mod-control.jsonl mod-commands.json; do
  curl -fsSL "https://raw.githubusercontent.com/omartelo/lich/$pending/docs/hooks/fixtures/$file" \
    -o "$here/fixtures/$file"
  echo "refreshed $file at $pending (unreleased)"
done
