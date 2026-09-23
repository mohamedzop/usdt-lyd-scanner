// ============================================================
// ماسح أسعار USDT/LYD على بايننس P2P — وحدة الجلب والتحليل
// ============================================================

const P2P_URL = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
const ASSET = 'USDT';
const FIAT = 'LYD';
const ROWS = 20; // عدد الإعلانات المجلوبة في كل طلب

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: '*/*',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * جلب إعلانات صفحة واحدة من بايننس P2P
 * tradeType: "BUY"  = المستخدم يريد شراء USDT بالدينار (نرى إعلانات البيع للمستخدم)
 *            "SELL" = المستخدم يريد بيع USDT مقابل الدينار
 */
export async function fetchPage(tradeType, page = 1, rows = ROWS) {
  const body = JSON.stringify({
    asset: ASSET,
    fiat: FIAT,
    tradeType,
    page,
    rows,
    payTypes: [],
    publisherType: null,
  });

  const res = await fetch(P2P_URL, {
    method: 'POST',
    headers: HEADERS,
    body,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} عند جلب صفحة ${page} (${tradeType})`);
  }

  const json = await res.json();
  if (json.code !== '000000' || !Array.isArray(json.data)) {
    throw new Error(
      `استجابة غير متوقعة من بايننس: ${json.code ?? '؟'} ${json.message ?? ''}`
    );
  }

  return json.data.map((entry) => {
    const adv = entry.advertiser ?? {};
    const a = entry.adv ?? {};
    return {
      price: parseFloat(a.price),
      minLimit: parseFloat(a.minSingleTransAmount ?? 0),
      maxLimit: parseFloat(a.maxSingleTransAmount ?? 0),
      available: parseFloat(a.tradableQuantity ?? a.surplusAmount ?? 0),
      completionRate: Math.round((adv.monthFinishRate ?? 0) * 10000) / 100,
      orders: adv.monthOrderCount ?? 0,
      nickname: adv.nickName ?? 'مجهول',
      isMerchant: adv.userType?.includes('MERCHANT') ?? false,
      payMethods: (a.tradeMethods ?? []).map((m) => m.tradeMethodName ?? m.payType),
    };
  });
}

/** جلب عدة صفحات مع إعادة المحاولة */
async function fetchSide(tradeType, pages = 2) {
  const all = [];
  for (let page = 1; page <= pages; page++) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const items = await fetchPage(tradeType, page);
        all.push(...items);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        await sleep(800 * attempt);
      }
    }
    if (lastErr) console.error(`⚠️  تعذر جلب ${tradeType} صفحة ${page}: ${lastErr.message}`);
    if (page < pages) await sleep(300);
  }
  return all;
}

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * تحليل جانب واحد من السوق
 */
function analyzeSide(ads) {
  if (!ads.length) {
    return { count: 0, best: 0, avg: 0, median: 0, spreadAds: [], totalAvailable: 0 };
  }
  const prices = ads.map((a) => a.price);
  const isBuy = ads[0].tradeType === 'BUY';
  const sorted = [...ads].sort((a, b) => (isBuy ? a.price - b.price : b.price - a.price));
  return {
    count: ads.length,
    best: sorted[0].price,
    bestAd: sorted[0],
    avg: Math.round(mean(prices) * 100) / 100,
    median: Math.round(median(prices) * 100) / 100,
    worst: sorted[sorted.length - 1].price,
    totalAvailable: Math.round(ads.reduce((s, a) => s + (a.available || 0), 0) * 100) / 100,
    spreadAds: sorted.slice(0, 10),
  };
}

/**
 * مسح كامل للسوق: يشمل جهتَي البيع والشراء + الحسابات التحليلية
 */
export async function scanMarket(pages = 2) {
  const now = Date.now();

  // ملاحظة هامة:
  //   tradeType=BUY  => إعلانات لمن يريدون شراء USDT (أي أن السعر هو "سعر شراء USDT من السوق")
  //   tradeType=SELL => إعلانات لمن يريدون بيع USDT (أي أن السعر هو "سعر بيع USDT للسوق")
  const [buyAds, sellAds] = await Promise.all([
    fetchSide('BUY', pages),
    fetchSide('SELL', pages),
  ]);

  for (const a of buyAds) a.tradeType = 'BUY';
  for (const a of sellAds) a.tradeType = 'SELL';

  const buy = analyzeSide(buyAds); // أسعار شراء USDT بالدينار
  const sell = analyzeSide(sellAds); // أسعار بيع USDT مقابل الدينار

  // الفارق السعري (السبريد) = فرق بين أفضل سعر بيع وأفضل سعر شراء
  const spread =
    buy.best && sell.best ? Math.round((sell.best - buy.best) * 100) / 100 : 0;
  const spreadPct =
    buy.best && sell.best ? Math.round((spread / buy.best) * 10000) / 100 : 0;

  // مؤشر متوسط السوق التقريبي
  const mid = buy.best && sell.best ? Math.round(((buy.best + sell.best) / 2) * 100) / 100 : 0;

  return {
    timestamp: now,
    timeAr: new Date(now).toLocaleString('ar-LY', { hour12: false }),
    pair: `${ASSET}/${FIAT}`,
    source: 'Binance P2P',
    buy, // شراء USDT بالدينار الليبي
    sell, // بيع USDT مقابل الدينار الليبي
    spread,
    spreadPct,
    mid,
  };
}

// ============================================================
// وضع سطر الأوامر (CLI)
// ============================================================

function printScan(s, { once = false } = {}) {
  const line = '─'.repeat(58);
  console.log('\n' + line);
  console.log(`  📡 ${s.pair} | ${s.source} | ${s.timeAr}`);
  console.log(line);

  console.log(`\n  🟢 شراء USDT (أرخص سعر تشتري به): ${s.buy.best} LYD`);
  console.log(`     متوسط: ${s.buy.avg} | وسيط: ${s.buy.median} | إعلانات: ${s.buy.count}`);
  console.log(`     المتاح: ${s.buy.totalAvailable.toLocaleString('en')} USDT`);

  console.log(`\n  🔴 بيع USDT (أعلى سعر تبيع به): ${s.sell.best} LYD`);
  console.log(`     متوسط: ${s.sell.avg} | وسيط: ${s.sell.median} | إعلانات: ${s.sell.count}`);
  console.log(`     المتاح: ${s.sell.totalAvailable.toLocaleString('en')} USDT`);

  console.log(`\n  📊 السبريد: ${s.spread} LYD (${s.spreadPct}%) | السعر الأوسط: ${s.mid} LYD`);

  const fmt = (ad, dir) =>
    `${String(ad.price).padStart(9)} LYD | متاح ${String(ad.available).padStart(9)} | حد ${ad.minLimit}-${ad.maxLimit} | ${ad.completionRate}% | ${ad.nickname.slice(0, 14)}`;

  if (s.buy.spreadAds?.length) {
    console.log(`\n  ▼ أفضل 5 إعلانات شراء (الأرخص أولاً):`);
    for (const ad of s.buy.spreadAds.slice(0, 5)) console.log('   ' + fmt(ad));
  }
  if (s.sell.spreadAds?.length) {
    console.log(`\n  ▲ أفضل 5 إعلانات بيع (الأعلى أولاً):`);
    for (const ad of s.sell.spreadAds.slice(0, 5)) console.log('   ' + fmt(ad));
  }
  console.log('\n' + line);
}

async function runCli() {
  const once = process.argv.includes('--once');
  const intervalArg = process.argv.find((a) => a.startsWith('--interval='));
  const intervalSec = intervalArg ? parseInt(intervalArg.split('=')[1], 10) : 15;

  console.log(`🚀 ماسح أسعار USDT/LYD — بايننس P2P`);
  if (!once) console.log(`   التحديث كل ${intervalSec} ثانية — اضغط Ctrl+C للخروج\n`);

  do {
    try {
      const scan = await scanMarket(2);
      printScan(scan, { once });
    } catch (err) {
      console.error('❌ خطأ أثناء المسح:', err.message);
    }
    if (!once) await sleep(intervalSec * 1000);
  } while (!once);
}

// تشغيل CLI فقط عند استدعاء الملف مباشرة
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) {
  runCli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
