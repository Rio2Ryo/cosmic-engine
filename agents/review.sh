#!/bin/bash
# Cosmic Engine - Code Review Agent
# Reviews code quality, structure, and best practices

set -e

echo "=== Review Agent Starting ==="

TASK_JSON="$COSMIC_TASK"
PROJECT=$(echo $TASK_JSON | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('project_name','demo-app'))" 2>/dev/null || echo "demo-app")
STANDARDS=$(echo $TASK_JSON | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('payload',{}).get('standards','general'))" 2>/dev/null || echo "general")

WORKSPACE="/Users/mr/cosmic-engine/workspace/$PROJECT"

if [ ! -d "$WORKSPACE" ]; then
  echo "❌ Project workspace not found: $WORKSPACE"
  exit 1
fi

cd "$WORKSPACE"

echo "🔍 Reviewing project: $PROJECT (standards: $STANDARDS)"

REVIEW_FILE="/Users/mr/cosmic-engine/data/review-$(date +%s).json"

ISSUES=()
SUGGESTIONS=()
SCORE=100

review_file() {
  local file="$1"
  local content
  
  if [ ! -f "$file" ]; then
    return
  fi
  
  content=$(cat "$file")
  local lines=$(echo "$content" | wc -l)
  local size=$(wc -c < "$file")
  
  echo "  📄 $file (${lines} lines, ${size}B)"
  
  # Check line length
  local long_lines=$(awk 'length > 120 {count++} END {print count+0}' "$file")
  if [ "$long_lines" -gt 0 ]; then
    ISSUES+=("{\"file\":\"$file\",\"severity\":\"warning\",\"message\":\"$long_lines lines exceed 120 chars\"}")
    SCORE=$((SCORE - 2 * long_lines))
  fi
  
  # Check for TODO/FIXME
  local todos=$(grep -c "TODO\|FIXME\|HACK\|XXX" "$file" 2>/dev/null || echo 0)
  if [ "$todos" -gt 0 ]; then
    SUGGESTIONS+=("{\"file\":\"$file\",\"message\":\"$todos TODO/FIXME markers found\"}")
  fi
  
  # Check trailing whitespace
  local trailing=$(grep -c "[[:space:]]$" "$file" 2>/dev/null || echo 0)
  if [ "$trailing" -gt 0 ]; then
    ISSUES+=("{\"file\":\"$file\",\"severity\":\"minor\",\"message\":\"$trailing lines with trailing whitespace\"}")
    SCORE=$((SCORE - trailing))
  fi
  
  # Check for console.log in JS files (non-test)
  if [[ "$file" == *.js ]] || [[ "$file" == *.ts ]]; then
    if [[ "$file" != *.test.* ]]; then
      local consoles=$(grep -c "console\.\(log\|warn\|error\)" "$file" 2>/dev/null || echo 0)
      if [ "$consoles" -gt 3 ]; then
        SUGGESTIONS+=("{\"file\":\"$file\",\"message\":\"$consoles console statements - consider using a logger\"}")
      fi
    fi
  fi
  
  # Check file size
  if [ "$lines" -gt 300 ]; then
    SUGGESTIONS+=("{\"file\":\"$file\",\"message\":\"File too large (${lines} lines) - consider splitting\"}")
    SCORE=$((SCORE - 5))
  fi
}

# Review all source files
echo ""
echo "📋 Reviewing files..."
echo "───────────────────────────────"

while IFS= read -r file; do
  review_file "$file"
done < <(find src -type f \( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.css" -o -name "*.html" -o -name "*.json" \) 2>/dev/null || true)

# Review server file
[ -f "server.js" ] && review_file "server.js"
[ -f "package.json" ] && review_file "package.json"

# Ensure score is within bounds
[ "$SCORE" -lt 0 ] && SCORE=0

# Generate review report
REPORT=$(cat << EOF
{
  "project": "$PROJECT",
  "standards": "$STANDARDS",
  "score": $SCORE,
  "issues": [$(IFS=,; echo "${ISSUES[*]}")],
  "suggestions": [$(IFS=,; echo "${SUGGESTIONS[*]}")],
  "summary": {
    "total_issues": ${#ISSUES[@]},
    "total_suggestions": ${#SUGGESTIONS[@]},
    "grade": $(if [ $SCORE -ge 90 ]; then echo "\"A\""; elif [ $SCORE -ge 75 ]; then echo "\"B\""; elif [ $SCORE -ge 60 ]; then echo "\"C\""; else echo "\"D\""; fi)
  },
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

echo "$REPORT" > "$REVIEW_FILE"

echo ""
echo "═══════════════════════════════════"
echo "  Review Results"
echo "═══════════════════════════════════"
echo "  Score: $SCORE/100"
echo "  Grade: $(echo $REPORT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['grade'])")"
echo "  Issues: ${#ISSUES[@]}"
echo "  Suggestions: ${#SUGGESTIONS[@]}"
echo "═══════════════════════════════════"

echo "Output: $REVIEW_FILE"
