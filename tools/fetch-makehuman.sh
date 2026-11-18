#!/bin/sh
# Downloads the MakeHuman data the player bodies are built from (all CC0 1.0,
# released by the MakeHuman team in 2020) into tools/.cache/makehuman.
# Then run: node tools/build-bodies.mjs
set -e
DIR="$(dirname "$0")/.cache/makehuman"
B=https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data
mkdir -p "$DIR/targets/macrodetails/height" "$DIR/targets/macrodetails/proportions"
get() { [ -s "$DIR/$2" ] || curl -sf -o "$DIR/$2" "$B/$1"; }
get 3dobjs/base.obj base.obj
get rigs/default.mhskel default.mhskel
get rigs/default_weights.mhw default_weights.mhw
for g in male female; do
  for e in african asian caucasian; do get targets/macrodetails/$e-$g-young.target targets/macrodetails/$e-$g-young.target; done
  get targets/macrodetails/universal-$g-young-maxmuscle-averageweight.target targets/macrodetails/universal-$g-young-maxmuscle-averageweight.target
  get targets/macrodetails/height/$g-young-averagemuscle-averageweight-maxheight.target targets/macrodetails/height/$g-young-averagemuscle-averageweight-maxheight.target
  get targets/macrodetails/proportions/$g-young-averagemuscle-averageweight-idealproportions.target targets/macrodetails/proportions/$g-young-averagemuscle-averageweight-idealproportions.target
done
echo "MakeHuman data in $DIR"
