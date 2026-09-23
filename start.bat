@echo off
chcp 65001 >nul
title ماسح أسعار USDT/LYD - التشغيل التلقائي

REM ============================================================
REM سكريبت التشغيل التلقائي - يشغل الخادم + النفق العام معاً
REM التشغيل: نقر مزدوج على الملف
REM ============================================================

set PORT=3000

echo.
echo ==============================================
echo   ماسح أسعار USDT/LYD - بدء التشغيل التلقائي
echo ==============================================
echo.

REM 1) التحقق من الخادم الحالي
curl -s -o nul --max-time 3 http://localhost:%PORT%/ 2>nul
if %errorlevel%==0 (
    echo [INFO] خادم يعمل أصلاً على المنفذ %PORT% - سيتم استخدامه
    goto TUNNEL
)

echo [1/3] تشغيل الخادم المحلي...
start /b "" node server.js > server.log 2>&1

REM انتظار جاهزية الخادم
set /a tries=0
:waitserver
timeout /t 1 /nobreak >nul
curl -s -o nul --max-time 2 http://localhost:%PORT%/ 2>nul
if %errorlevel%==0 (
    echo [OK] الخادم يعمل على http://localhost:%PORT%
    goto TUNNEL
)
set /a tries+=1
if %tries% lss 20 goto waitserver
echo [ERROR] فشل تشغيل الخادم - راجع server.log
goto END

:TUNNEL
echo [2/3] فتح النفق العام عبر serveo...
start "tunnel" /min bash -c "ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -R 80:localhost:%PORT% serveo.net > tunnel.log 2>&1"

REM انتظار ظهور الرابط
set /a tries=0
set PUBLIC_URL=
:waittunnel
timeout /t 1 /nobreak >nul
for /f "tokens=*" %%u in ('findstr /r "https://[a-zA-Z0-9.-]*serveousercontent.com" tunnel.log 2^>nul') do set PUBLIC_URL=%%u
if not "%PUBLIC_URL%"=="" goto FOUND
set /a tries+=1
if %tries% lss 20 goto waittunnel
echo [ERROR] تعذر إنشاء النفق - تأكد من الاتصال بالإنترنت
echo [INFO] الخادم المحلي يعمل على http://localhost:%PORT%
goto END

:FOUND
echo [3/3] التحقق من الرابط...
timeout /t 2 /nobreak >nul
echo.
echo ==============================================
echo   الرابط العام:
echo     %PUBLIC_URL%
echo.
echo   محلياً: http://localhost:%PORT%
echo ==============================================
echo.
echo ملاحظات:
echo   - الرابط يعمل طالما هذه النافذة مفتوحة
echo   - لإيقاف كل شيء: أغلق النافذتين (النفق + الخادم)
echo   - عند إعادة التشغيل قد يتغير الرابط
echo.
start "" "%PUBLIC_URL%"

:END
echo.
pause
