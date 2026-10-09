#!/bin/sh
# Refreshes the vendored copies of lich's hook-contract fixtures, and of the
# theme template the theme skill hands out and validates against.
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
raw=https://raw.githubusercontent.com/omartelo/lich/$ref
base=$raw/docs/hooks/fixtures

for file in session-start.jsonl session-title.jsonl \
  session-touched.jsonl mod-usage.jsonl mod-control.jsonl mod-commands.json \
  mod-answer.jsonl mod-status.json; do
  curl -fsSL "$base/$file" -o "$here/fixtures/$file"
  echo "refreshed $file at $ref"
done

# session-state gained `compacting` in omartelo/lich#687, merged to main but in
# no release yet, so it is read at the merge commit. Once a release ships it,
# move tests/lich-ref to that release and put the file back in the loop above.
unreleased=f44818488bd2bb18023bec69f2d9476e31434256
curl -fsSL "https://raw.githubusercontent.com/omartelo/lich/$unreleased/docs/hooks/fixtures/session-state.jsonl" \
  -o "$here/fixtures/session-state.jsonl"
echo "refreshed session-state.jsonl at $unreleased (unreleased)"

# validate.mjs reads its token sets off this copy, so a token lich adds reaches
# the validator by moving tests/lich-ref, not by hand.
curl -fsSL "$raw/themes/template.json" -o "$here/../skills/theme/template.json"
echo "refreshed skills/theme/template.json at $ref"
