#!/usr/bin/env bash
# ============================================================
# 🚀 سكريبت التشغيل التلقائي — ماسح أسعار USDT/LYD
# يشغّل الخادم + النفق العام معاً ويعرض الرابط العام مباشرة
# التشغيل:  bash start.sh
# ============================================================

set -u

# تحديد المنفذ: نتجاهل أي قيمة PORT غير صالحة في البيئة (مثل 0)
DEFAULT_PORT=3000
PORT_ENV="${PORT:-}"
case "$PORT_ENV" in
  ''|*[!0-9]*) PORT="$DEFAULT_PORT" ;;
  *)
    if [ "$PORT_ENV" -gt 0 ] 2>/dev/null; then PORT="$PORT_ENV"; else PORT="$DEFAULT_PORT"; fi
  ;;
esac
TUNNEL_PID=""
SERVER_PID=""

# ألوان للعرض
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

cleanup() {
  echo ""
  echo -e "${YELLOW}⏹  إيقاف كل شيء...${NC}"
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  # إيقاف أي نسخة قديمة من الخادم على نفس المنفذ
  if command -v fuser >/dev/null 2>&1; then fuser -k "${PORT}/tcp" 2>/dev/null; fi
  echo -e "${GREEN}✅ تم. إلى اللقاء!${NC}"
  exit 0
}
trap cleanup INT TERM

echo -e "${BOLD}🚀 ماسح أسعار USDT/LYD — بدء التشغيل التلقائي${NC}"
echo "──────────────────────────────────────────────"

# 1) إن كان الخادم يعمل أصلاً على المنفذ، نستخدمه بدل تشغيل نسخة جديدة
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:${PORT}/"; then
  echo -e "${YELLOW}ℹ️  خادم يعمل أصلاً على المنفذ ${PORT} — سيتم استخدامه${NC}"
  SERVER_PID=""
else
  echo -e "${CYAN}1/3 تشغيل الخادم المحلي...${NC}"
  nohup node server.js > server.log 2>&1 &
  SERVER_PID=$!

  # انتظار جاهزية الخادم
  for i in $(seq 1 20); do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PORT}/"; then
      echo -e "${GREEN}✅ الخادم يعمل على http://localhost:${PORT}${NC}"
      break
    fi
    sleep 1
    if [ "$i" = 20 ]; then
      echo -e "${RED}❌ فشل تشغيل الخادم — راجع server.log${NC}"
      cleanup
    fi
  done
fi

# 2) فتح النفق العام
echo -e "${CYAN}2/3 فتح النفق العام (serveo)...${NC}"
PUBLIC_URL_FILE=$(mktemp)
ssh -o StrictHostKeyChecking=no \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -R "80:127.0.0.1:${PORT}" serveo.net > "$PUBLIC_URL_FILE" 2>&1 &
TUNNEL_PID=$!

# انتظار ظهور الرابط العام
PUBLIC_URL=""
for i in $(seq 1 20); do
  PUBLIC_URL=$(grep -o 'https://[a-zA-Z0-9.-]*serveousercontent\.com' "$PUBLIC_URL_FILE" | head -n 1)
  [ -n "$PUBLIC_URL" ] && break
  sleep 1
done
rm -f "$PUBLIC_URL_FILE"

if [ -z "$PUBLIC_URL" ]; then
  echo -e "${RED}❌ تعذر إنشاء النفق — تأكد من اتصال الإنترنت ثم أعد المحاولة${NC}"
  echo -e "${YELLOW}💡 الخادم المحلي لا يزال يعمل على http://localhost:${PORT}${NC}"
  cleanup
fi

# 3) عرض النتيجة
echo -e "${CYAN}3/3 التحقق من الرابط...${NC}"
sleep 2
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  STATUS="${GREEN}✅ يعمل${NC}"
else
  STATUS="${YELLOW}⚠️  كود $HTTP_CODE (قد يتأخر الرابط لحظات)${NC}"
fi

echo ""
echo "══════════════════════════════════════════════"
echo -e "${BOLD}🌐 الرابط العام:${NC}"
echo -e "${GREEN}${BOLD}   $PUBLIC_URL${NC}"
echo -e "   الحالة: $STATUS"
echo ""
echo -e "🖥️  محلياً:  ${CYAN}http://localhost:${PORT}${NC}"
echo -e "📡 تحديث لحظي كل 10 ثوانٍ عبر SSE"
echo "══════════════════════════════════════════════"
echo ""
echo -e "${YELLOW}ملاحظات:${NC}"
echo "  • الرابط يعمل طالما هذه النافذة مفتوحة"
echo "  • للإيقاف: اضغط Ctrl+C (سيُغلق الخادم والنفق معاً)"
echo "  • عند إعادة التشغيل قد يتغير الرابط"
echo ""

# إبقاء النفق حياً ومراقبة خروجه
wait "$TUNNEL_PID" 2>/dev/null
echo -e "${RED}⚠️  انقطع النفق — أعد تشغيل السكريبت للحصول على رابط جديد${NC}"
cleanup
