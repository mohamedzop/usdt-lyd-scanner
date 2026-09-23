// ============================================================
// خادم البث اللحظي — يخدم لوحة التحكم ويبث تحديثات الأسعار كل لحظة
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanMarket } from './scanner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT_ENV = parseInt(process.env.PORT ?? '', 10);
const PORT = Number.isInteger(PORT_ENV) && PORT_ENV > 0 ? PORT_ENV : 3000;
const REFRESH_SEC = process.env.REFRESH_SEC ? parseInt(process.env.REFRESH_SEC, 10) : 10;

// آخر مسح ناجح (يُشارك بين كل المتصلين)
let lastScan = null;
let lastError = null;
let scanning = false;
let recentNewAds = []; // آخر أحداث "عرض جديد" للبث (قائمة مستقلة)
let recentGoneAds = []; // آخر أحداث "عرض منتهٍ" للبث (قائمة مستقلة)

const clients = new Set(); // اتصالات SSE النشطة

const adKeyOf = (ad, dir) => `${dir}|${ad.nickname}|${ad.price}`;

async function doScan() {
  if (scanning) return;
  scanning = true;
  try {
    const scan = await scanMarket(2);

    // كشف الإعلانات الجديدة والمختفية (بيعاً أو شراءً) بمقارنة مع المسح السابق في الذاكرة
    // الخريطة السابقة: مفتاح الإعلان → كميته (لتمييز الاختفاء الحقيقي عن مجرد تغيّر السعر)
    let newBuy = 0;
    let newSell = 0;
    let goneBuy = 0;
    let goneSell = 0;
    if (lastScan) {
      const prevBuyMap = new Map((lastScan.buy?.spreadAds || []).map((a) => [adKeyOf(a, 'BUY'), String(a.available)]));
      const prevSellMap = new Map((lastScan.sell?.spreadAds || []).map((a) => [adKeyOf(a, 'SELL'), String(a.available)]));
      const curBuySet = new Set((scan.buy?.spreadAds || []).map((a) => adKeyOf(a, 'BUY')));
      const curSellSet = new Set((scan.sell?.spreadAds || []).map((a) => adKeyOf(a, 'SELL')));
      // إن كان التاجر ما يزال موجوداً بسعر جديد فهذا تعديل سعر وليس اختفاءً
      const curBuyTraders = new Set((scan.buy?.spreadAds || []).map((a) => a.nickname));
      const curSellTraders = new Set((scan.sell?.spreadAds || []).map((a) => a.nickname));
      const events = [];
      for (const ad of scan.buy.spreadAds || []) {
        const k = adKeyOf(ad, 'BUY');
        if (!prevBuyMap.has(k)) {
          newBuy++;
          events.push({ id: scan.timestamp + '-b' + newBuy, t: scan.timestamp, type: 'buy', nickname: ad.nickname, price: ad.price, available: ad.available });
        }
      }
      for (const ad of scan.sell.spreadAds || []) {
        const k = adKeyOf(ad, 'SELL');
        if (!prevSellMap.has(k)) {
          newSell++;
          events.push({ id: scan.timestamp + '-s' + newSell, t: scan.timestamp, type: 'sell', nickname: ad.nickname, price: ad.price, available: ad.available });
        }
      }
      // اختفاء: كان موجوداً وكميته > 0 ثم غاب من المسح الحالي (وليس مجرد تغيّر سعر التاجر نفسه)
      for (const [k, avail] of prevBuyMap) {
        if (!curBuySet.has(k) && parseFloat(avail) > 0 && !curBuyTraders.has(k.split('|')[1])) {
          goneBuy++;
          const parts = k.split('|');
          events.push({ id: scan.timestamp + '-bg' + goneBuy, t: scan.timestamp, kind: 'gone', type: 'buy', nickname: parts[1], price: parseFloat(parts[2]), available: parseFloat(avail) });
        }
      }
      for (const [k, avail] of prevSellMap) {
        if (!curSellSet.has(k) && parseFloat(avail) > 0 && !curSellTraders.has(k.split('|')[1])) {
          goneSell++;
          const parts = k.split('|');
          events.push({ id: scan.timestamp + '-sg' + goneSell, t: scan.timestamp, kind: 'gone', type: 'sell', nickname: parts[1], price: parseFloat(parts[2]), available: parseFloat(avail) });
        }
      }
      // فصل الأحداث: الجديدة في قائمة، المنتهية في قائمة مستقلة
      const newEvents = events.filter((e) => e.kind !== 'gone');
      const goneEvents = events.filter((e) => e.kind === 'gone');
      if (newEvents.length) {
        recentNewAds.unshift(...newEvents);
        recentNewAds = recentNewAds.slice(0, 30);
      }
      if (goneEvents.length) {
        recentGoneAds.unshift(...goneEvents);
        recentGoneAds = recentGoneAds.slice(0, 30);
      }
      if (newBuy || newSell) console.log(`🆕 إعلانات جديدة — شراء: ${newBuy} | بيع: ${newSell}`);
      if (goneBuy || goneSell) console.log(`⚠️ إعلانات انتهت — شراء: ${goneBuy} | بيع: ${goneSell}`);
    }
    scan.newAds = { buy: newBuy, sell: newSell, goneBuy, goneSell, recent: recentNewAds, recentGone: recentGoneAds };

    lastScan = scan;
    lastError = null;
    broadcast({ type: 'update', data: lastScan });
  } catch (err) {
    lastError = err.message;
    broadcast({ type: 'error', message: err.message });
  } finally {
    scanning = false;
  }
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// حلقة المسح الدورية — واحدة لكل الخدمة بغض النظر عن عدد المتصلين
setInterval(doScan, REFRESH_SEC * 1000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // مسار SSE للبث اللحظي
  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');

    // إرسال آخر نتيجة فور الاتصال
    if (lastScan) {
      res.write(`data: ${JSON.stringify({ type: 'update', data: lastScan })}\n\n`);
    } else if (lastError) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: lastError })}\n\n`);
    }

    clients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* noop */
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  // مسارات السجل اليومي التام (docs/daily)
  if (url.pathname === '/api/daily/days') {
    try {
      const idx = path.join(__dirname, 'docs', 'daily', 'index.json');
      const days = fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, 'utf8')) : [];
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(days));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('[]');
    }
    return;
  }
  const dailyMatch = url.pathname.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (dailyMatch) {
    const file = path.join(__dirname, 'docs', 'daily', dailyMatch[1] + '.json');
    try {
      const data = fs.readFileSync(file, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'day not found' }));
    }
    return;
  }

  // مسار REST لجلب لقطة واحدة
  if (url.pathname === '/api/snapshot') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (lastScan) {
      res.end(JSON.stringify({ ok: true, data: lastScan }));
    } else {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: lastError ?? 'لم يتم المسح بعد' }));
    }
    return;
  }

  // ملفات الواجهة
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 — غير موجود');
});

server.listen(PORT, () => {
  console.log(`✅ خادم ماسح USDT/LYD يعمل على: http://localhost:${PORT}`);
  console.log(`   ⏱️  فاصل التحديث: ${REFRESH_SEC} ثانية`);
});

// أول مسح فوري
doScan();
