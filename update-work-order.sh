#!/usr/bin/env bash
# 작업지시서 업데이트: 다운로드 폴더의 '가장 최근' 작업지시서를 링크에 반영
set -euo pipefail
WEB="/mnt/c/Users/multi/Desktop/aisel-web"
DL="/mnt/c/Users/multi/Downloads"
cd "$WEB"

# 1) 다운로드 + 바탕화면 전체에서 가장 최근(시각 기준) work-order 파일 찾기
#    (예전엔 다운로드만 봐서, 바탕화면에 저장한 최신본을 놓치는 일이 있었음)
DESK="/mnt/c/Users/multi/Desktop"
latest="$(find "$DL" "$DESK" -maxdepth 2 -type f -iname 'work-order*.html' \
            ! -samefile "$WEB/work-order.html" -printf '%T@\t%p\n' 2>/dev/null \
          | sort -rn | head -1 | cut -f2- || true)"

if [ -z "${latest:-}" ]; then
  echo "ℹ️  새 작업지시서 파일이 없어요. (이미 최신)"
  echo "   🔗 https://jisoo5000.github.io/aisel-web/work-order.html"
  exit 0
fi

echo "📄 최신 파일 감지: $(basename "$latest")  [$(stat -c '%y' "$latest" | cut -d. -f1)]"
cp "$latest" work-order.html

if git diff --quiet -- work-order.html; then
  echo "ℹ️  내용이 지금 링크와 동일해요. push 생략."
else
  git add work-order.html
  git commit -q -m "작업지시서 업데이트 ($(basename "$latest"))"
  git push -q origin main
  echo "✅ push 완료"
fi

# 2) 다운로드에 쌓인 work-order 통합본 파일들 정리 (최신 포함 전부 — 이미 반영/이력보관됨)
rm -f "$DL"/work-order*통합본*.html
# 방금 반영한 원본이 다른 곳(바탕화면 등)에 있으면 그것도 정리 (git 이력에 남아 되살릴 수 있음)
if [ -f "$latest" ]; then rm -f "$latest"; fi

# 3) 미확인/미완성 다운로드 조각(.crdownload) 정리
#    단, 최근 2분 안에 바뀐 건(=아직 받는 중일 수 있음) 건드리지 않음
crgone=0
while IFS= read -r -d '' f; do rm -f "$f" && crgone=$((crgone+1)); done \
  < <(find "$DL" -maxdepth 1 \( -iname "미확인*.crdownload" -o -iname "*.crdownload" \) -mmin +2 -print0 2>/dev/null)
[ "$crgone" -gt 0 ] && echo "🧹 미확인 파일(.crdownload) ${crgone}개 정리됨"

echo ""
echo "✅ 완료! 링크 주소는 그대로, 내용만 최신."
echo "   🔗 https://jisoo5000.github.io/aisel-web/work-order.html"
echo "   (1~2분 뒤 새로고침하면 최신 보여요)"
