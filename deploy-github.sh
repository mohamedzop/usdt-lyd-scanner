#!/usr/bin/env bash
# ============================================================
# 🐙 سكريبت النشر على GitHub Pages — ماسح USDT/LYD
# ينشئ مستودعاً، يرفع المشروع، ويفعّل GitHub Pages + Actions
# الاستخدام: bash deploy-github.sh اسم-المستودع [public|private]
# يتطلب: gh (GitHub CLI) مسجّل الدخول — أو git + حساب GitHub
# ============================================================

set -euo pipefail

REPO_NAME="${1:-usdt-lyd-scanner}"
VISIBILITY="${2:-public}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${BOLD}🐙 النشر على GitHub Pages — ماسح USDT/LYD${NC}"
echo "──────────────────────────────────────────────"

# 1) التحقق من الأدوات
if ! command -v git >/dev/null 2>&1; then
  echo -e "${RED}❌ git غير مثبت${NC}"; exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  GitHub CLI (gh) غير مثبت — الأسهل تثبيته ليعمل السكريبت تلقائياً${NC}"
  echo "   ويندوز:  winget install GitHub.cli"
  echo "   ماك:     brew install gh"
  echo "   لينكس:   sudo apt install gh"
  echo ""
  echo "   بعد التثبيت:  gh auth login"
  echo ""
  echo -e "${YELLOW}أو اتبع الطريقة اليدوية في MANUAL-DEPLOY.md${NC}"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo -e "${YELLOW}🔑 تسجيل الدخول إلى GitHub...${NC}"
  gh auth login
fi

# 2) تهيئة المستودع المحلي
if [ ! -d .git ]; then
  echo -e "${CYAN}1/4 تهيئة مستودع git...${NC}"
  git init -b main >/dev/null
fi

# ملف .gitignore مناسب
cat > .gitignore <<'EOF'
node_modules/
server.log
cf_*.log
test_start*.log
tunnel.log
*.pid
cloudflared.exe
cloudflared
.freebuff/
EOF

echo -e "${CYAN}2/4 إضافة الملفات...${NC}"
git add .gitignore package.json scanner.js server.js README.md
git add docs/index.html docs/data.json docs/history.json 2>/dev/null || true
git add scripts/gh-scan.js .github/workflows/scanner.yml
git add start.sh start.bat deploy-github.sh 2>/dev/null || true

git commit -m "🚀 ماسح أسعار USDT/LYD — بايننس P2P مع نشر GitHub Pages" --allow-empty >/dev/null

# 3) إنشاء المستودع ورفع الكود
echo -e "${CYAN}3/4 إنشاء المستودع ${REPO_NAME} (${VISIBILITY})...${NC}"
if gh repo view "$REPO_NAME" >/dev/null 2>&1; then
  echo -e "${YELLOW}ℹ️  المستودع موجود — سيتم الرفع إليه${NC}"
else
  gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --push
  echo -e "${GREEN}✅ تم إنشاء المستودع ورفع الكود${NC}"
fi

# رفع آخر التحديثات دائماً
git push -u origin main 2>/dev/null || gh repo create "$REPO_NAME" --"$VISIBILITY" --source=. --push

# 4) تفعيل GitHub Pages من فرع main / مجلد docs
echo -e "${CYAN}4/4 تفعيل GitHub Pages...${NC}"
gh api -X POST "repos/{owner}/$REPO_NAME/pages" \
  -f "source[branch]=main" -f "source[path]=/docs" >/dev/null 2>&1 \
  || echo -e "${YELLOW}ℹ️  Pages مفعّل مسبقاً أو ستحتاج تفعيله يدوياً (انظر أدناه)${NC}"

gh api -X POST "repos/{owner}/$REPO_NAME/actions/workflows/scanner.yml/dispatches" \
  -f 'ref=main' >/dev/null 2>&1 \
  && echo -e "${GREEN}✅ تم تشغيل أول مسح الآن${NC}" \
  || echo -e "${YELLOW}⚠️  شغّل المسح يدوياً من تبويب Actions${NC}"

REPO_URL=$(gh repo view "$REPO_NAME" --json url -q .url)
PAGE_URL=$(gh api "repos/{owner}/$REPO_NAME/pages" -q .html_url 2>/dev/null || echo "قريباً بعد أول بناء")

echo ""
echo "══════════════════════════════════════════════"
echo -e "${BOLD}✅ تم النشر!${NC}"
echo ""
echo -e "📦 المستودع:  $REPO_URL"
echo -e "🌐 اللوحة:    ${GREEN}${BOLD}$PAGE_URL${NC}"
echo ""
echo -e "${YELLOW}ملاحظات مهمة:${NC}"
echo "  • أول بناء للوحة يستغرق 1-3 دقائق"
echo "  • الماسح يعمل تلقائياً كل دقيقة عبر Actions"
echo "  • تحقق من تبويب Actions في المستودع أنه مفعّل"
echo "    (Settings → Actions → Allow all actions)"
echo "══════════════════════════════════════════════"
