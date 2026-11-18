#!/bin/sh
# Downloads the motion capture takes the running gaits are built from, from the
# Bandai Namco Research Motion Dataset (CC BY-NC 4.0, non-commercial use only),
# into tools/.cache/bandai. Then run: node tools/build-mocap.mjs
set -e
DIR="$(dirname "$0")/.cache/bandai"
B=https://raw.githubusercontent.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset/master/dataset
get() { mkdir -p "$DIR/$(dirname "$1")"; [ -s "$DIR/$1" ] || curl -sf -o "$DIR/$1" "$B/$1"; }
D1=Bandai-Namco-Research-Motiondataset-1
D2=Bandai-Namco-Research-Motiondataset-2
get $D1/LICENSE
get $D1/data/dataset-1_walk_active_001.bvh
get $D1/data/dataset-1_run_active_001.bvh
get $D1/data/dataset-1_dash_masculinity_001.bvh
get $D1/data/dataset-1_walk-back_active_001.bvh
get $D2/data/dataset-2_run_active_002.bvh
echo "mocap takes in $DIR"
