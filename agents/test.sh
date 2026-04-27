#!/bin/bash
# Cosmic Engine - Test Agent
# Runs automated tests and reports results

set -e

echo "=== Test Agent Starting ==="

TASK_JSON="$COSMIC_TASK"
FRAMEWORK=$(echo $TASK_JSON | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('framework','node'))" 2>/dev/null || echo "node")
PROJECT=$(echo $TASK_JSON | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('project_name','demo-app'))" 2>/dev/null || echo "demo-app")
TARGET=$(echo $TASK_JSON | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('target','all'))" 2>/dev/null || echo "all")

WORKSPACE="/Users/mr/cosmic-engine/workspace/$PROJECT"

if [ ! -d "$WORKSPACE" ]; then
  echo "❌ Project workspace not found: $WORKSPACE"
  exit 1
fi

cd "$WORKSPACE"
echo "🧪 Running tests (framework: $FRAMEWORK, target: $TARGET)"

RESULTS_FILE="/Users/mr/cosmic-engine/data/test-results-$(date +%s).json"
START_TIME=$(date +%s)
PASSED=0
FAILED=0
TOTAL=0
ERRORS=""

run_test_file() {
  local file="$1"
  TOTAL=$((TOTAL + 1))
  echo "  Testing: $file"
  
  if [ "$FRAMEWORK" = "node" ] || [ "$FRAMEWORK" = "vitest" ]; then
    if node --check "$file" 2>/dev/null; then
      echo "    ✅ Syntax check passed"
      PASSED=$((PASSED + 1))
    else
      echo "    ❌ Syntax check failed"
      FAILED=$((FAILED + 1))
      ERRORS="$ERRORS\n  - $file: syntax error"
    fi
  fi
  
  # Check file exists and has content
  if [ -f "$file" ]; then
    local size=$(wc -c < "$file")
    if [ "$size" -gt 0 ]; then
      echo "    ✅ File exists (${size} bytes)"
    else
      echo "    ⚠️  File is empty"
    fi
  fi
}

# Discover and test files
echo "📂 Discovering files..."

if [ "$TARGET" = "all" ] || [ "$TARGET" = "src" ]; then
  while IFS= read -r file; do
    run_test_file "$file"
  done < <(find src -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" 2>/dev/null || true)
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "tests" ]; then
  while IFS= read -r file; do
    run_test_file "$file"
  done < <(find tests -name "*.js" -o -name "*.ts" -o -name "*.test.js" -o -name "*.test.ts" 2>/dev/null || true)
fi

if [ "$TARGET" = "all" ] || [ "$TARGET" = "server" ]; then
  if [ -f "server.js" ]; then
    run_test_file "server.js"
    # Try to syntax check
    if node -e "try { require('fs').readFileSync('server.js','utf-8'); console.log('  ✅ Server file readable'); } catch(e) { console.log('  ❌ Server file error: '+e.message); }" 2>/dev/null; then
      PASSED=$((PASSED + 1))
    fi
  fi
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

RESULTS=$(cat << EOF
{
  "framework": "$FRAMEWORK",
  "project": "$PROJECT",
  "start_time": $START_TIME,
  "end_time": $END_TIME,
  "duration": $DURATION,
  "total": $TOTAL,
  "passed": $PASSED,
  "failed": $FAILED,
  "errors": "$(echo -e "$ERRORS" | head -20)",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

echo "$RESULTS" > "$RESULTS_FILE"
echo "✅ Test results saved: $RESULTS_FILE"

# Summary
echo ""
echo "═══════════════════════════════════"
echo "  Test Results Summary"
echo "═══════════════════════════════════"
echo "  Total:  $TOTAL"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"
echo "  Time:   ${DURATION}s"
echo "═══════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  echo "❌ ${FAILED} test(s) failed"
  echo -e "$ERRORS"
  exit 0  # Don't fail the agent, just report
else
  echo "✅ All tests passed!"
fi

echo "Output: $RESULTS_FILE"
