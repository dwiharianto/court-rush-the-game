#!/bin/sh
# Downloads the captured tennis strokes the game's strokes and serve are built from:
# Tennis-MoCap (Caldas-Colombia tennis league players), CC BY-SA 3.0, into
# tools/.cache/tennis-mocap. Then run: node tools/build-strokes.mjs
set -e
DIR="$(dirname "$0")/.cache/tennis-mocap"
B=https://raw.githubusercontent.com/jdpulgarin/Tennis-MoCap/master
mkdir -p "$DIR/data"
get() { [ -s "$DIR/$1" ] || curl -sf -o "$DIR/$1" "$B/$1"; }
get README.md
get Copyright.md
for f in cferrero_Derecha lvargas_Reves jdescobar_VDerecha jgacosta_VReves jduribe_Remate jarua_Servicio; do
  get "data/$f.bvh"
done
echo "takes in $DIR"
