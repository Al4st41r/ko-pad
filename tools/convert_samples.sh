#!/usr/bin/env bash
# Convert a folder of WAV files into web/samples (FLAC) and build the catalogue.
# Name each file NNN_name.wav, where NNN is the sample number (1 to 599), for example 001_kick.wav or 100_snare.wav.
# The number ranges set the SOUND tab category: 1-99 KICK, 100-199 SNARE, 200-299 CYMB, 300-399 PERC, 400-499 BASS, 500-599 MELOD.
# Usage: tools/convert_samples.sh /path/to/folder    (needs ffmpeg)
set -euo pipefail
[ $# -eq 1 ] && [ -d "$1" ] || { echo "Usage: $0 /path/to/folder-of-wavs" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/web/samples"
mkdir -p "$OUT"
# Two files with the same number would write the same FLAC, so stop before converting anything.
dups="$(find "$1" -name '*.wav' -print0 | while IFS= read -r -d '' f; do b="$(basename "$f" .wav)"; n="${b%%_*}"; [[ "$n" =~ ^[0-9]+$ ]] && echo "$((10#$n))"; done | sort -n | uniq -d)"
[ -z "$dups" ] || { echo "More than one file has the sample number: $(echo $dups). Rename them so each number is used once." >&2; exit 1; }
find "$1" -name '*.wav' -print0 | while IFS= read -r -d '' f; do
  b="$(basename "$f" .wav)"; n="${b%%_*}"
  [[ "$n" =~ ^[0-9]+$ ]] && [ "$((10#$n))" -ge 1 ] && [ "$((10#$n))" -le 599 ] || { echo "Skipping $b: name must start with a number from 1 to 599" >&2; continue; }
  ffmpeg -loglevel error -y -i "$f" -c:a flac -compression_level 8 "$OUT/$(printf '%03d' "$((10#$n))").flac"
done
python3 -I "$ROOT/tools/make_catalogue.py" "$1" "$OUT/catalogue.json"
