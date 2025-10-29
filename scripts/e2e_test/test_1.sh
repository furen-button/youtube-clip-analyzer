#!/bin/bash -xe

SCRIPT_DIR=$(cd $(dirname $0); pwd)
ROOT_DIR=$(cd $SCRIPT_DIR/../..; pwd)
cd $ROOT_DIR

npm install
# node ./cli.js https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl --json scripts/e2e_test/test_1_result.json

DATE=$(date +%Y%m%d%H%M%S)
TMP_OUTPUT_DIR="$ROOT_DIR/tmp"
mkdir -p "$TMP_OUTPUT_DIR"
TMP_OUTPUT_FILE="$TMP_OUTPUT_DIR/e2e_test_output_$DATE.json"
node ./cli.js https://www.youtube.com/clip/UgkxzjQPU1Ug_59l4pDl9d6-E0WR_RbjTsSl --json "$TMP_OUTPUT_FILE"

# Compare output
# extractedAt は実行タイミングの違いで変わる可能性があるため無視する

jq 'del(.extractedAt)' "$TMP_OUTPUT_FILE" > "$TMP_OUTPUT_FILE.tmp" && mv "$TMP_OUTPUT_FILE.tmp" "$TMP_OUTPUT_FILE"
jq 'del(.extractedAt)' "$SCRIPT_DIR/test_1_result.json" > "$TMP_OUTPUT_DIR/test_1_result_processed.json"
diff -u "$TMP_OUTPUT_DIR/test_1_result_processed.json" "$TMP_OUTPUT_FILE" || (echo "E2E test failed: Output does not match expected result"; exit 1)

echo "E2E test passed"
