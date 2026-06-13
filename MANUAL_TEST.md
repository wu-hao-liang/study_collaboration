# Manual Test Guide

This checklist validates the completed application through speech control. Hand gesture
recognition is intentionally excluded.

## 1. Prepare And Start

1. Connect the Windows PC and iPhone to the same trusted Wi-Fi.
2. Open PowerShell in `C:\Users\admin\live_background`.
3. Build and start the application:

```powershell
uv sync
npm.cmd --prefix frontend install
npm.cmd --prefix frontend run build
$env:APP_HOST="0.0.0.0"
$env:APP_DEV_MODE="false"
uv run live-background
```

4. Keep this PowerShell window open.
5. In desktop Chrome, open `http://127.0.0.1:8000/studio`.

Expected:

- The left side contains a fixed 9:16 live capture frame.
- The right side contains the private desktop console.
- The status reads `实时连接正常`.
- Product search, device details, errors, QR codes, and tokens appear only on the right.

Resolution check:

1. Change `输出分辨率` through all four presets.
2. Confirm the live header changes to the selected dimensions.
3. Refresh Chrome and confirm the last selection is restored.
4. Configure Douyin Live Companion output to the same resolution before a real stream.

## 2. Desktop Studio Smoke Test

1. Resize Chrome wider and narrower.
2. Shorten the Chrome window and confirm the live frame remains at the selected pixel size.
3. Confirm its top-left stays anchored and the excess height extends below the viewport.
4. Confirm only the private right panel scrolls and no private panel overlaps the output.
5. Search for `法式`.
6. Confirm only the two French-door products remain in the private result list.
7. Select `容声 452L 法式多门冰箱`.

Expected:

- The live frame immediately displays the selected product.
- Search results never appear inside the live frame.
- The revision number increases.

## 3. Price And Product Persistence

1. Enter `4599` as the live price and select `更新价格`.
2. Confirm the live frame displays `¥4,599.00`.
3. Select another product and enter a different price.
4. Return to the first product.
5. Refresh the browser.

Expected:

- Each product keeps its own temporary price.
- The selected product, price, and panel survive a browser refresh.
- Updating the current price triggers the price-highlight animation.

## 4. Panels And Animations

1. Select `产品摘要`, then `参数详情`.
2. Trigger `价格高亮`.
3. Trigger `产品聚焦`.
4. Trigger each animation several times.

Expected:

- Exactly one panel is visible at a time.
- Details show the correct image and specifications without an internal scrollbar.
- Animations replay every time and do not change the revision number.

## 5. Pair The iPhone

1. In the desktop `手机控制` section, select `生成配对二维码`.
2. Scan the QR code with the iPhone Camera app.
3. Open the link in Safari.

Expected:

- Safari shows `冰箱咨询控制台` and `已连接`.
- The desktop live product and phone current product match.
- The phone page does not expose `结束场次`.
- The phone page does not visibly display the pairing token.

If Safari cannot open the page:

- Confirm both devices are on the same Wi-Fi.
- Allow Python through Windows Defender Firewall for private networks.
- Confirm the application was started with `APP_HOST=0.0.0.0`.
- Do not use a guest Wi-Fi network that isolates devices.

## 6. Phone Controls

From the iPhone:

1. Search for `三门`.
2. Select `TCL 256L 三门冰箱`.
3. Enter price `2599`.
4. Switch between summary and details.
5. Trigger both animations.
6. Toggle gesture control on and off.
7. Switch the voice target between product search and live price.

Expected:

- Every action updates the desktop in about one second or less.
- Price becomes `¥2,599.00`.
- Buttons are comfortably touchable and the page has no horizontal scrolling.
- Gesture toggle changes state, although camera gesture recognition is not implemented yet.

## 7. Single-Phone And Reconnect Test

1. Keep the first iPhone connected.
2. Open the same QR link on a second phone or another Safari private tab.

Expected:

- The second client displays `控制端已被占用`.
- It cannot control the session.

Then:

1. Briefly disable Wi-Fi on the original iPhone.
2. Re-enable it within 15 seconds.

Expected:

- The original phone reconnects and restores the current state.
- Desktop controls continue working while the phone is disconnected.

## 8. Desktop Speech Initialization

Use desktop Chrome for this section.

1. In `桌面语音`, select `初始化语音`.
2. Allow microphone access when Chrome asks.

Expected:

- Status changes to `可用`.
- The phone `按住说话` button becomes enabled.

Fallback checks:

- If permission is denied, the desktop shows `权限被拒绝`.
- Manual product search and price input remain usable.
- No raw audio is saved by the application.

## 9. Speech Search Test

1. On the phone, select voice target `产品搜索`.
2. Hold `按住说话`.
3. Say `法式多门`.
4. Release the button.

Expected:

- The private desktop console shows the recognized draft.
- A three-second countdown appears.
- Before it expires, the draft can be edited, confirmed, or canceled.
- On commit, the desktop private search becomes `法式多门`.
- Speech text never appears in the live capture frame.

Repeat once and select `撤销`. Confirm the search is not changed.

## 10. Speech Price Test

1. Ensure a product is selected.
2. On the phone, select voice target `直播价格`.
3. Hold the speech button, say `四千二百`, and release.
4. Let the three-second countdown expire.

Expected:

- The current product price becomes `¥4,200.00`.
- A price-highlight animation plays.

Invalid input check:

1. Repeat and say `便宜一点`.

Expected:

- A private error reports that the price is invalid.
- The previous valid price remains unchanged.

## 11. Session End Test

1. Note the current selected product and prices.
2. On the desktop, select `结束场次`.
3. Select `取消`.
4. Confirm nothing changed.
5. Select `结束场次` again and confirm.

Expected:

- Temporary prices and speech drafts are cleared.
- Gesture state returns to off.
- The old phone loses control.
- The old QR link becomes invalid.
- A newly generated QR code can pair a phone again.

## 12. Restart Recovery Test

Before ending a new session:

1. Select a product and set a price.
2. Stop the PowerShell process with `Ctrl+C`.
3. Run `uv run live-background` again with the same environment variables.
4. Reopen the desktop studio.

Expected:

- The unfinished session restores its selected product, price, and panel.
- A session that was explicitly ended does not restore old temporary prices.

## Test Record

| Area | Pass/Fail | Notes |
| --- | --- | --- |
| Desktop layout and privacy boundary |  |  |
| Product search and selection |  |  |
| Per-product prices and persistence |  |  |
| Panels and animations |  |  |
| iPhone pairing |  |  |
| Phone controls |  |  |
| Single-phone slot and reconnect |  |  |
| Speech initialization and fallback |  |  |
| Speech search |  |  |
| Speech price and invalid input |  |  |
| End session and token rotation |  |  |
| Restart recovery |  |  |
