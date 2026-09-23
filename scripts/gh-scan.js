// ============================================================
// ماسح USDT/LYD — وضع GitHub Actions
// يجلب أسعار P2P ويحدّث docs/data.json ليعرضه موقع GitHub Pages
// التشغيل: node scripts/gh-scan.js
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanMarket } from '../scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'docs', 'data.json');
const HISTORY_FILE = path.join(__dirname, '..', 'docs', 'history.json');
const NEW_ADS_FILE = path.join(__dirname, '..', 'docs', 'newads.json');     // أحداث "عرض جديد" للوحة (قائمة مستقلة)
const GONE_ADS_FILE = path.join(__dirname, '..', 'docs', 'goneads.json');   // أحداث "عرض منتهٍ" للوحة (قائمة مستقلة)
const DAILY_DIR = path.join(__dirname, '..', 'docs', 'daily');             // السجل اليومي التام (ملف لكل يوم)
const OPEN_ADS_FILE = path.join(__dirname, '..', 'docs', '.openads.json'); // العروض المفتوحة قيد التتبع (ملف داخلي)
const PREV_ADS_FILE = path.join(__dirname, '..', 'docs', '.prevads.json'); // خرائط الإعلانات في المسح السابق (ملف داخلي)
const MAX_HISTORY = 500; // نحفظ آخر 500 قراءة (≈ 500 دقيقة من التحديثات)
const MAX_NEW_ADS = 30;  // نحفظ آخر 30 حدث عرض جديد
const MAX_GONE_ADS = 30; // نحفظ آخر 30 حدث عرض منتهٍ
const OPEN_STALE_MS = 6 * 60 * 60 * 1000; // نغلق أي عرض بقي مفتوحاً أكثر من 6 ساعات دون ظهور

/** مفتاح فريد لكل إعلان: النوع + التاجر + السعر */
function adKey(ad, tradeType) {
  return `${tradeType}|${ad.nickname}|${ad.price}`;
}

/** تاريخ اليوم بصيغة YYYY-MM-DD (بتوقيت UTC — توقيت سيرفرات GitHub) */
function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/** إلحاق حدث بالسجل اليومي (ملف docs/daily/YYYY-MM-DD.json) */
function appendDaily(ts, event) {
  if (!fs.existsSync(DAILY_DIR)) fs.mkdirSync(DAILY_DIR, { recursive: true });
  const file = path.join(DAILY_DIR, dayKey(ts) + '.json');
  let arr = [];
  if (fs.existsSync(file)) {
    try { arr = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(arr)) arr = []; } catch { arr = []; }
  }
  arr.push(event);
  fs.writeFileSync(file, JSON.stringify(arr));
  return file;
}

async function main() {
  console.log('🚀 جلب أسعار USDT/LYD من بايننس P2P...');
  const scan = await scanMarket(2);

  console.log(`✅ شراء: ${scan.buy.best} | بيع: ${scan.sell.best} | أوسط: ${scan.mid}`);

  // ====== كشف الإعلانات الجديدة والمختفية (بيعاً أو شراءً) بمقارنة المفاتيح مع المسح السابق ======
  // الخرائط الحالية: مفتاح الإعلان → كميته المتاحة
  const curBuyMap = new Map(scan.buy.spreadAds.map((a) => [adKey(a, 'BUY'), String(a.available)]));
  const curSellMap = new Map(scan.sell.spreadAds.map((a) => [adKey(a, 'SELL'), String(a.available)]));

  let newBuy = 0;
  let newSell = 0;
  let newAdEvents = [];
  let goneBuy = 0;
  let goneSell = 0;
  let goneAdEvents = [];

  let prevKeys = null;
  if (fs.existsSync(PREV_ADS_FILE)) {
    try {
      const p = JSON.parse(fs.readFileSync(PREV_ADS_FILE, 'utf8'));
      if (Array.isArray(p.buy) && Array.isArray(p.sell)) prevKeys = p;
    } catch { prevKeys = null; }
  }

  if (prevKeys) {
    // الخرائط السابقة: مفتاح الإعلان → كميته (مع توافق مع الصيغة القديمة نصية المفاتيح)
    const toMap = (arr) => {
      const m = new Map();
      for (const it of arr || []) {
        if (typeof it === 'string') m.set(it, it.split('|')[2]);
        else m.set(it.k, it.a);
      }
      return m;
    };
    const prevBuy = toMap(prevKeys.buy);
    const prevSell = toMap(prevKeys.sell);
    for (const ad of scan.buy.spreadAds) {
      const k = adKey(ad, 'BUY');
      if (!prevBuy.has(k)) {
        newBuy++;
        newAdEvents.push({ id: scan.timestamp + '-b' + newBuy, t: scan.timestamp, type: 'buy', nickname: ad.nickname, price: ad.price, available: ad.available });
      }
    }
    for (const ad of scan.sell.spreadAds) {
      const k = adKey(ad, 'SELL');
      if (!prevSell.has(k)) {
        newSell++;
        newAdEvents.push({ id: scan.timestamp + '-s' + newSell, t: scan.timestamp, type: 'sell', nickname: ad.nickname, price: ad.price, available: ad.available });
      }
    }
    // ====== كشف الإعلانات التي اختفت (أُلغيت أو نفدت كميتها) ======
    // تجاهل تغيّر السعر: إن كان التاجر نفسه ما يزال موجوداً بسعر جديد فهو تعديل سعر وليس اختفاءً
    const curBuyTraders = new Set(scan.buy.spreadAds.map((a) => a.nickname));
    const curSellTraders = new Set(scan.sell.spreadAds.map((a) => a.nickname));
    for (const [k, avail] of prevBuy) {
      const nickname = k.split('|')[1];
      if (!curBuyMap.has(k) && parseFloat(avail) > 0 && !curBuyTraders.has(nickname)) {
        goneBuy++;
        const parts = k.split('|');
        goneAdEvents.push({ id: scan.timestamp + '-bg' + goneBuy, t: scan.timestamp, kind: 'gone', type: 'buy', nickname: parts[1], price: parseFloat(parts[2]), available: parseFloat(avail) });
      }
    }
    for (const [k, avail] of prevSell) {
      const nickname = k.split('|')[1];
      if (!curSellMap.has(k) && parseFloat(avail) > 0 && !curSellTraders.has(nickname)) {
        goneSell++;
        const parts = k.split('|');
        goneAdEvents.push({ id: scan.timestamp + '-sg' + goneSell, t: scan.timestamp, kind: 'gone', type: 'sell', nickname: parts[1], price: parseFloat(parts[2]), available: parseFloat(avail) });
      }
    }
  }

  // حفظ خرائط هذا المسح (المفتاح + الكمية) للمراجعة في الدورة القادمة
  fs.writeFileSync(PREV_ADS_FILE, JSON.stringify({
    buy: [...curBuyMap].map(([k, a]) => ({ k, a })),
    sell: [...curSellMap].map(([k, a]) => ({ k, a })),
  }));

  // سجل أحداث العروض الجديدة — قائمة مستقلة (أحدث أولاً)
  let recentNewAds = [];
  if (fs.existsSync(NEW_ADS_FILE)) {
    try {
      const r = JSON.parse(fs.readFileSync(NEW_ADS_FILE, 'utf8'));
      if (Array.isArray(r)) recentNewAds = r;
    } catch { recentNewAds = []; }
  }
  recentNewAds.unshift(...newAdEvents);
  recentNewAds = recentNewAds.slice(0, MAX_NEW_ADS);
  fs.writeFileSync(NEW_ADS_FILE, JSON.stringify(recentNewAds));

  // سجل أحداث العروض المنتهية — قائمة مستقلة (أحدث أولاً)
  let recentGoneAds = [];
  if (fs.existsSync(GONE_ADS_FILE)) {
    try {
      const g = JSON.parse(fs.readFileSync(GONE_ADS_FILE, 'utf8'));
      if (Array.isArray(g)) recentGoneAds = g;
    } catch { recentGoneAds = []; }
  }
  recentGoneAds.unshift(...goneAdEvents);
  recentGoneAds = recentGoneAds.slice(0, MAX_GONE_ADS);
  fs.writeFileSync(GONE_ADS_FILE, JSON.stringify(recentGoneAds));

  scan.newAds = { buy: newBuy, sell: newSell, goneBuy, goneSell, recent: recentNewAds, recentGone: recentGoneAds };

  // ====== السجل اليومي التام: دورة حياة كل عرض (وقت الإعلان ← وقت الانتهاء) ======
  let openAds = {};
  if (fs.existsSync(OPEN_ADS_FILE)) {
    try { openAds = JSON.parse(fs.readFileSync(OPEN_ADS_FILE, 'utf8')); if (typeof openAds !== 'object') openAds = {}; } catch { openAds = {}; }
  }
  const now = scan.timestamp;
  let dailyAdded = 0;

  // 1) العروض الجديدة تدخل السجل اليومي وتُفتح للتتبع
  for (const e of newAdEvents) {
    if (!openAds[e.id]) {
      openAds[e.id] = { firstSeen: e.t, type: e.type, nickname: e.nickname, price: e.price, available: e.available };
      appendDaily(e.t, { firstSeen: e.t, type: e.type, nickname: e.nickname, price: e.price, available: e.available, lastSeen: e.t, endedAt: null, durationSec: null });
      dailyAdded++;
    } else {
      openAds[e.id].lastSeen = e.t;
    }
  }

  // 2) العروض المنتهية تُغلق وتُحدّث وقت الانتهاء ومدتها في السجل اليومي
  for (const e of goneAdEvents) {
    const key = 'G|' + e.nickname + '|' + e.price;
    // نبحث عن أقرب عرض مفتوح لنفس التاجر في نفس الجهة (سعره قد تغير)
    const cand = Object.keys(openAds).filter((k) => !openAds[k].endedAt && openAds[k].type === e.type && openAds[k].nickname === e.nickname)
      .sort((a, b) => openAds[a].firstSeen - openAds[b].firstSeen)[0];
    const useKey = cand || key;
    const rec = openAds[useKey] || { firstSeen: e.t, type: e.type, nickname: e.nickname, price: e.price, available: e.available };
    rec.endedAt = e.t;
    rec.endReason = 'disappeared';
    openAds[useKey] = rec;
    appendDaily(rec.firstSeen, { firstSeen: rec.firstSeen, type: e.type, nickname: e.nickname, price: rec.price ?? e.price, available: rec.available ?? e.available, lastSeen: rec.lastSeen ?? rec.firstSeen, endedAt: e.t, durationSec: Math.round((e.t - rec.firstSeen) / 1000), endReason: 'disappeared' });
    dailyAdded++;
    delete openAds[useKey];
  }

  // 3) تحديث آخر ظهور للعروض المفتوحة التي ما زالت في السوق
  const updateSeen = (map, dir) => {
    for (const ad of map) {
      const k = adKey(ad, dir);
      if (openAds[k] && !openAds[k].endedAt) openAds[k].lastSeen = now;
    }
  };
  updateSeen(scan.buy.spreadAds, 'BUY');
  updateSeen(scan.sell.spreadAds, 'SELL');

  // 4) تنظيف: إغلاق أي عرض بقي مفتوحاً أكثر من 6 ساعات (منع التسرب)
  for (const [k, r] of Object.entries(openAds)) {
    if (!r.endedAt && now - (r.lastSeen || r.firstSeen) > OPEN_STALE_MS) {
      r.endedAt = now;
      r.endReason = 'stale';
      appendDaily(r.firstSeen, { firstSeen: r.firstSeen, type: r.type, nickname: r.nickname, price: r.price, available: r.available, lastSeen: r.lastSeen || r.firstSeen, endedAt: now, durationSec: Math.round((now - r.firstSeen) / 1000), endReason: 'stale' });
      delete openAds[k];
    }
  }

  fs.writeFileSync(OPEN_ADS_FILE, JSON.stringify(openAds));
  scan.dailyAdded = dailyAdded;
  if (dailyAdded) console.log(`📅 السجل اليومي: +${dailyAdded} حدث`);

  // فهرس الأيام المتاحة للسجل اليومي (تقرأه اللوحة لبناء قائمة التواريخ)
  if (fs.existsSync(DAILY_DIR)) {
    const days = fs.readdirSync(DAILY_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
    fs.writeFileSync(path.join(DAILY_DIR, 'index.json'), JSON.stringify(days));
  }
  if (newBuy || newSell) console.log(`🆕 إعلانات جديدة — شراء: ${newBuy} | بيع: ${newSell}`);
  if (goneBuy || goneSell) console.log(`⚠️ إعلانات اختفت — شراء: ${goneBuy} | بيع: ${goneSell}`);

  // آخر قراءة
  fs.writeFileSync(DATA_FILE, JSON.stringify(scan, null, 2));

  // السجل التاريخي للرسم البياني
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }
  history.push({ t: scan.timestamp, mid: scan.mid, buy: scan.buy.best, sell: scan.sell.best });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));

  console.log(`💾 تم حفظ data.json + history.json (${history.length} قراءة في السجل)`);
}

main().catch((err) => {
  console.error('❌ فشل المسح:', err.message);
  process.exit(1);
});
