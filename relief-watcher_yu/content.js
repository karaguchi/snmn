// ==========================================
// チケット出現監視【代表者：結】
// version: 6.8.2
// ==========================================


// ==========================================
// ★切り替えスイッチ & 設定
// ==========================================

// 公演ページ設定
    // timelesz 11/121
    // ジュニア(合同) 15/132
    // ジュニア(B&ZAI) 15/134
    // Snow Man 31/118
    // Travis Japan 38/124
    // ‼️選択中‼️ SixTONES 40/127
    // King & Prince 41/129
    // 中島健人 42/131
const ARTIST_ID = "40";
const EVENT_ID = "127";

// 狙う枚数
    // 入力例→"1"
    // 入力例→"2"
    // 空なら枚数不問→""
const TARGET_PIECES = "1";

// 狙う日程の曜日
    // 左側から優先 (日)(月)(火)(水)(木)(金)(土)
const allowedDays = ["(土)","(日)","(月)","(金)"];

// 狙う時間
    // この時間以外はスルー→["13:00"]
    // 左から優先→["13:00","18:00"]
    // 空配列なら時間不問→[]
const TARGET_TIMES = ["12:00","13:00"];

// コンソールのログ
const DEBUG_LOG = true;
// コンソール貼り付け用
// JSON.parse(localStorage.getItem("ticket_logs") || []).join("\n")

const TARGET_DETAIL_URL = `https://relief-ticket.jp/events/artist/${ARTIST_ID}/${EVENT_ID}`;
const ARTIST_LIST_PATH = `/events/artist/${ARTIST_ID}`;

// ==========================================
// 0. フェーズ管理
// ==========================================
const PHASE = {
  SEARCH: "search",
  AUTH: "auth",
  AFTER_BUY: "after_buy",
};

let phase = PHASE.SEARCH;


// ==========================================
// 1. ユーティリティ & ログ
// ==========================================
const saveLog = (msg) => {
  const ts = new Date().toLocaleString("ja-JP");
  const line = `[${ts}] ${msg}`;

  const logs = JSON.parse(localStorage.getItem("ticket_logs") || "[]");
  logs.push(line);
  if (logs.length > 100) logs.shift();
  localStorage.setItem("ticket_logs", JSON.stringify(logs));

  if (DEBUG_LOG) console.log(line);
};


// ==========================================
// 2. フラッシュ通知
// ==========================================
const flashScreen = (color = "#93ab27ab") => {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: ${color};
    z-index: 999999;
    pointer-events: none;
    opacity: 0;
  `;
  document.body.appendChild(overlay);

  let count = 0;
  const interval = setInterval(() => {
    overlay.style.opacity = overlay.style.opacity === "1" ? "0" : "1";
    count++;
    if (count >= 20) { // 点灯と消灯で2回 × 10セット
      clearInterval(interval);
      overlay.remove();
    }
  }, 150); // 0.15秒ごとにパチパチ光る
};


// ==========================================
// 3. ページ制御
// ==========================================
const reloadWithCacheBust = (targetUrl = location.href) => {
  if (phase !== PHASE.SEARCH) return;
  const url = new URL(targetUrl);
  url.searchParams.set("t", Date.now());
  location.href = url.toString();
};


// ==========================================
// 4. 判定ロジック
// ==========================================
const isTargetTickets = (text) => {
  if (!TARGET_PIECES) return /\d+\s*枚/.test(text);
  const zenkaku = String.fromCharCode(TARGET_PIECES.charCodeAt(0) + 0xFEE0);
  const reg = new RegExp(`(^|\\D)[${TARGET_PIECES}${zenkaku}]\\s*枚`);
  return reg.test(text);
};

const isAuthPage = () =>
  location.href.includes("/checkout/attention") ||
  location.href.includes("/checkout/phone_auth");

const isAfterBuyPage = () =>
  location.href.includes("/checkout/set_seats/") ||
  document.body.innerText.includes("同行者情報入力");


// ==========================================
// 5. 曜日判定、時間取得
// ==========================================
const getDayFromSelect = (select) => {
  const container =
    select.closest(".perform-list") ||
    select.closest(".card") ||
    select.closest(".event-row") ||
    select.closest(".form-group") ||
    select.parentElement;

  if (!container) return null;

  const m = container.innerText.match(/\((月|火|水|木|金|土|日)\)/);
  return m ? m[0] : null;
};

const getTimeFromRow = (row) => {
  const m = row.innerText.match(/\b\d{1,2}:\d{2}\b/);
  return m ? m[0] : null;
};


// ==========================================
// 6. 認証画面処理
// ==========================================
const handleAuthPage = () => {
  if (
    location.href.includes("/checkout/attention") &&
    !sessionStorage.getItem("authEntered")
  ) {
    flashScreen();
    const t = sessionStorage.getItem("selected_show_time") || "不明";
    saveLog(`⚠️⚠️⚠️SMS認証フローに突入（${t}）⚠️⚠️⚠️`);
    sessionStorage.setItem("authEntered", "1");
    sessionStorage.setItem("authEnterTime", Date.now().toString());
    return;
  }
  // ★ 選択した公演時間を画面に表示
  const selectedTime = sessionStorage.getItem("selected_show_time");
  if (selectedTime && !document.getElementById("selected-show-time-badge")) {
      const badge = document.createElement("div");
      badge.id = "selected-show-time-badge";
      badge.innerText = `🎫 選択回：${selectedTime}`;
      badge.style.cssText = `
        position: fixed;
        top: 12px;
        right: 12px;
        font-size: 24px;
        font-weight: bold;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 10px 16px;
        border-radius: 10px;
        z-index: 1000001;
        pointer-events: none;
      `;
      document.body.appendChild(badge);
    }

  
  // ★認証画面突入後ガード(今後のための保険)
  // 認証画面突入後ガード時間
  const AUTH_GUARD_TIME = 1500; // ms
  const enterTime = Number(sessionStorage.getItem("authEnterTime"));
  if (enterTime && Date.now() - enterTime < AUTH_GUARD_TIME) {
    return;
  }
  // 安全ゾーン
};


// ==========================================
// 7. 検知 & 購入処理
// ==========================================
let hasClickedBuy = false;
let reloadTimer = null;
let isCoolDown = false;

const checkAndProcess = () => {
  if (phase !== PHASE.SEARCH || isCoolDown) return;
  if (reloadTimer) clearTimeout(reloadTimer);

  // ★スキャン開始ログ
  saveLog("🔍 スキャン中...");

  let rows = document.querySelectorAll(
    ".perform-list, .card, .event-row, .mt-3, .card-body, .form-group"
  );
  if (!rows.length) rows = [document.body];

  const candidates = [];

  for (const row of rows) {
    const select =
      row.querySelector("select.ticket-select") ||
      row.querySelector("select");
    if (!select) continue;

    const day = getDayFromSelect(select);
    if (!day || !allowedDays.includes(day)) continue;

    const time = getTimeFromRow(row);
    let timePriority = 0;
    if (TARGET_TIMES.length) {
      timePriority = TARGET_TIMES.indexOf(time);
      if (timePriority === -1) continue;
    }

    for (let i = 0; i < select.options.length; i++) {
      const optTxt = select.options[i].text.trim();
      if (!isTargetTickets(optTxt)) continue;

      const btn =
        row.querySelector("button[value='commit'].btn-warning") ||
        row.querySelector(".btn-buy-ticket");

      if (!btn) continue;

      candidates.push({
        day,
        dayIndex: allowedDays.indexOf(day),
        timePriority,
        select,
        optionIndex: i,
        optionText: optTxt,
        button: btn,
      });
    }
  }

  if (!candidates.length) {
    const delay = Math.floor(Math.random() * 300 + 1200);
    saveLog(`条件に合うチケットなし。 ${delay}ms後リロード`);
    
    reloadTimer = setTimeout(
      reloadWithCacheBust,
      delay
    );
    return;
  }

  // ★ 時間 → 曜日 の優先順
  candidates.sort((a, b) => {
    if (a.timePriority !== b.timePriority) {
      return a.timePriority - b.timePriority;
    }
    return a.dayIndex - b.dayIndex;
  });

  const c = candidates[0];

  const notifyKey = `found_${c.day}_${c.optionText}`;
  if (!sessionStorage.getItem(notifyKey)) {
    saveLog(`💚💚💚発見: ${c.day} ${c.optionText}💚💚💚`);
    sessionStorage.setItem(notifyKey, "1");
  }
  
  c.select.selectedIndex = c.optionIndex;
  c.select.dispatchEvent(new Event("change", { bubbles: true }));

if (!hasClickedBuy) {
  hasClickedBuy = true;
  isCoolDown = true;
  phase = PHASE.AUTH;

  const selectedTime = TARGET_TIMES.length
    ? TARGET_TIMES[c.timePriority]
    : getTimeFromRow(
        c.select.closest(".perform-list, .card, .event-row")
      ) || "不明";

  sessionStorage.setItem("selected_show_time", selectedTime);

  saveLog(`❄️❄️❄️購入ボタンクリック: ${c.day} ${c.optionText}❄️❄️❄️`);
  c.button.click();

  const coolDownTime = Math.floor(Math.random() * 2019 + 1993);
  setTimeout(() => {
      hasClickedBuy = false;
      isCoolDown = false;
      phase = PHASE.SEARCH;
      saveLog(`🔄 ${coolDownTime}ms 経過：次のアタックを解禁`);
    }, coolDownTime);
  }
};


// ==========================================
// 8. 同行者自動入力
// ==========================================
let companionRetry = 0;
let companionFilled = false;
let companionSubmitted = false;

const fillCompanionInfo = () => {
  if (companionSubmitted) return;

  const info = {
    name: "池田尚",
    tel: "09028497825",
    birthYear: "1989",
    birthMonth: "8",
    birthDay: "1",
  };

  const name = document.querySelector(".userName");
  const tel = document.querySelector(".userTelno");

  if (!name || !tel) {
    if (companionRetry++ < 10) {
      setTimeout(fillCompanionInfo, 500);
    }
    return;
  }

  if (!companionFilled) {
    name.value = info.name;
    tel.value = info.tel;

    const b = document.querySelectorAll(".user-birthday");
    if (b.length >= 3) {
      b[0].value = info.birthYear;
      b[1].value = info.birthMonth;
      b[2].value = info.birthDay;
    }

    document.querySelectorAll("input, select").forEach((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

    companionFilled = true;
    saveLog("👥 同行者情報を入力しました");
    showStopWarning();
  }
};
  // ★ 認証画面突入後ガード
  const AUTH_GUARD_TIME = 4000; // ms
  const showStopWarning = () => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); z-index: 1000000;
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      color: white; font-family: sans-serif; text-align: center; padding: 20px; pointer-events: all;
    `;
    overlay.innerHTML = `
      <h1 style="font-size: 6rem;">⚠️</h1>
      <p style="font-size: 3rem; color: #ff3b30;">同行者が自動入力された後は<br>手動で拡張機能をOFFにしてから次に進む！</p>
    `;
    document.body.appendChild(overlay);
    saveLog("🛑 ロック画面を表示しました。");

    // ★ 設定秒経過後に、自動でロックを解除する
    setTimeout(() => {
      overlay.remove();
      saveLog("✅ ガード解除。手動で確定ボタンをクリックしてください");
    }, AUTH_GUARD_TIME);
  };

// ==========================================
// 9. 起動制御
// ==========================================
const startApp = () => {
  // 起動時の設定表示
  saveLog(`👤 代表者: 結`);
  saveLog(`狙い: ${ARTIST_ID} の ${allowedDays.join(", ")} / ${TARGET_TIMES.join(", ") || "時間不問"} / ${TARGET_PIECES || "枚数不問"}`);

  const bodyText = document.body.innerText || "";

  if (
    /5[0-9]{2}/.test(document.title) ||
    bodyText.includes("502") ||
    bodyText.includes("504") ||
    bodyText.includes("エラー")
  ) {

    const errorDelay = Math.floor(Math.random() * 2800 + 3200);
    saveLog(`⚠️ サーバーエラーを検知。${errorDelay}ms 後にリダイレクト。`);
    setTimeout(() => reloadWithCacheBust(TARGET_DETAIL_URL), errorDelay);
    return;
  }

  if (isAuthPage()) {
    phase = PHASE.AUTH;
    handleAuthPage();
    return;
  }

  if (isAfterBuyPage()) {
    phase = PHASE.AFTER_BUY;
    fillCompanionInfo();
    return;
  }

  if (
    location.pathname === "/" ||
    location.pathname === ARTIST_LIST_PATH
  ) {
    saveLog("対象ページへ自動移動します");
    setTimeout(() => reloadWithCacheBust(TARGET_DETAIL_URL), 500);
    return;
  }

  checkAndProcess();
};

startApp();