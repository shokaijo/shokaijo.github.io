/**
 * 紹介状（プロトタイプ）の記録側。
 * スプレッドシートに紐づけた Apps Script として置き、ウェブアプリとして公開する。
 *
 * シート
 *   設定        … 有効期限の日数、呼び名を消すまでの日数、画面のURL
 *   店          … 紹介先になる店。お店の確認番号は店で「使用済み」にするときに使う
 *   紹介元  … 紹介元ごとに1行。有効を FALSE にすると、そのリンクは止まる
 *   紹介状      … 受け取った人がリンクを開くたびに1行できる
 *   集計        … 紹介元ごと・店ごとの数（式で自動）
 */

var SHEET = {
  SETTINGS: '設定',
  SHOPS: '店',
  REFERRERS: '紹介元',
  LETTERS: '紹介状',
  SUMMARY: '集計'
};

var HEAD = {
  SETTINGS: ['項目', '値', '説明'],
  SHOPS: ['店ID', '店名', 'エリア', '営業時間', '定休日', '地図の検索語', 'お店の確認番号', '有効'],
  REFERRERS: ['紹介ID', '共有ID', '呼び名', '種類', '有効', '紹介用リンク', 'メモ', '自分の店ID'],
  LETTERS: ['紹介状ID', '紹介ID', '紹介元', '行き先の店ID', '行き先', '作成日時', '期限',
            '宛名', '敬称', '状態', '使用日時', '誤入力の回数', '呼び名を消した日時',
            'ひとこと', '記録の方法']
};

var STATUS = { UNUSED: '未使用', USED: '使用済み', STOPPED: '停止', EXPIRED: '期限切れ' };
var HONORIFICS = ['さん', 'ちゃん', 'くん', 'なし'];
var NAME_MAX = 8;   // 宛名の文字数（「まっちゃんたち」のようなグループ宛ても入る長さ）
// 「行ってきました」に添えられる言葉。前向きなものだけを置く（自由記述は受け付けない）
var WORDS = ['ありがとう', '楽しかった', 'また行きたい'];
var TZ = 'Asia/Tokyo';

/* ------------------------------------------------------------------ */
/* ウェブアプリの入口                                                  */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  return respond_(function () {
    if (p.action === 'referrer') return getReferrer_(p.r);
    if (p.action === 'letter') return getLetter_(p.id);
    throw userError_('unknown_action');
  });
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return respond_(function () { throw userError_('bad_request'); });
  }
  return respond_(function () {
    if (body.action === 'issue') return withLock_(function () { return issueLetter_(body.r, body.s, body.nickname, body.honorific); });
    if (body.action === 'visit') return withLock_(function () { return visit_(body.id, body.at, body.words); });
    throw userError_('unknown_action');
  });
}

function respond_(fn) {
  var out;
  try {
    out = { ok: true, data: fn() };
  } catch (err) {
    if (err && err.isUserError) {
      out = { ok: false, error: err.code };
    } else {
      console.error(err && err.stack ? err.stack : err);
      out = { ok: false, error: 'server_error' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function userError_(code) {
  var e = new Error(code);
  e.isUserError = true;
  e.code = code;
  return e;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* 読み取り                                                            */
/* ------------------------------------------------------------------ */

/** 紹介元の画面：呼び名と、紹介できる店の一覧 */
function getReferrer_(refId) {
  var ref = findReferrer_('紹介ID', refId);
  if (!ref) throw userError_('referrer_not_found');
  if (!ref.active) throw userError_('referrer_stopped');
  var shops = readTable_(SHEET.SHOPS, HEAD.SHOPS, true)
    .filter(function (s) { return isTrue_(s['有効']) && s['店ID'] && String(s['店ID']) !== ref.ownShopId; })
    .map(publicShop_);
  return { name: ref.name, shops: shops, expiryDays: settingNumber_('有効期限（日）', 30), nameMax: NAME_MAX, honorifics: HONORIFICS };
}

/** 受け取った人の画面：紹介状の中身 */
function getLetter_(letterId) {
  var hit = findLetter_(letterId);
  if (!hit) throw userError_('letter_not_found');
  return publicLetter_(hit.row);
}

/* ------------------------------------------------------------------ */
/* 書き込み                                                            */
/* ------------------------------------------------------------------ */

/**
 * 紹介元が、宛名を入れて紹介状を1枚つくる。宛名は必須。
 * 名前を知っている相手にしか送れないことで、紹介状が顔見知りの間だけで回るようにする。
 * できた紹介状のリンクは1人に1枚。転送されても使えるのは一度だけ。
 */
function issueLetter_(refId, shopId, nickname, honorific) {
  var ref = findReferrer_('紹介ID', refId);
  if (!ref) throw userError_('referrer_not_found');
  if (!ref.active) throw userError_('referrer_stopped');
  if (ref.ownShopId && String(shopId) === ref.ownShopId) throw userError_('own_shop');
  var shop = findShop_(shopId);
  if (!shop || !isTrue_(shop['有効'])) throw userError_('shop_not_found');

  var name = String(nickname || '').replace(/\s+/g, '');
  if (!name) throw userError_('name_required');
  if (Array.from(name).length > NAME_MAX) throw userError_('name_too_long');
  var hon = HONORIFICS.indexOf(honorific) >= 0 ? honorific : 'さん';

  var now = new Date();
  var expires = addDays_(now, settingNumber_('有効期限（日）', 30));
  var id = newId_('L');
  var row = {};
  row['紹介状ID'] = id;
  row['紹介ID'] = ref.id;
  row['紹介元'] = ref.name;
  row['行き先の店ID'] = shop['店ID'];
  row['行き先'] = shop['店名'];
  row['作成日時'] = now;
  row['期限'] = expires;
  row['宛名'] = asText_(name);
  row['敬称'] = hon;
  row['状態'] = STATUS.UNUSED;
  row['使用日時'] = '';
  row['誤入力の回数'] = 0;
  row['呼び名を消した日時'] = '';
  appendRow_(SHEET.LETTERS, HEAD.LETTERS, row);
  row['宛名'] = name;
  return publicLetter_(row);
}

/**
 * お客さんが「行ってきました」を押したとき。使用済みにして、選んだ言葉を残す。
 * at はお店のシールから来たときの店ID（紹介状の画面から押したときは空）。
 * 特典がないので来店を厳しくは確かめない。シールの店と行き先が違うときだけ止める。
 */
function visit_(letterId, atShopId, words) {
  var hit = findLetter_(letterId);
  if (!hit) throw userError_('letter_not_found');
  var state = effectiveStatus_(hit.row);
  if (state !== STATUS.UNUSED) throw userError_('letter_' + statusCode_(state));

  var at = String(atShopId || '').trim();
  if (at && at !== String(hit.row['行き先の店ID'])) throw userError_('wrong_shop');

  var picked = (Array.isArray(words) ? words : []).filter(function (w, i, a) {
    return WORDS.indexOf(w) >= 0 && a.indexOf(w) === i;
  });

  var now = new Date();
  var patch = {
    '状態': STATUS.USED,
    '使用日時': now,
    'ひとこと': picked.join('、'),
    '記録の方法': at ? 'シール' : '紹介状の画面'
  };
  setCells_(SHEET.LETTERS, HEAD.LETTERS, hit.rowIndex, patch);
  Object.keys(patch).forEach(function (k) { hit.row[k] = patch[k]; });
  return publicLetter_(hit.row);
}

/* ------------------------------------------------------------------ */
/* 呼び名の自動削除（毎日動かす）                                      */
/* ------------------------------------------------------------------ */

/** 使用済みまたは期限切れのあと、決めた日数を過ぎた呼び名を消す */
function purgeNames() {
  return withLock_(purgeNamesLocked_);
}

function purgeNamesLocked_() {
  var keepDays = settingNumber_('呼び名を消すまで（日）', 30);
  var now = new Date();
  var sh = sheet_(SHEET.LETTERS);
  var values = sh.getDataRange().getValues();
  var col = indexOf_(HEAD.LETTERS);
  var count = 0;
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[col['宛名']]) continue;
    var base = null;
    if (r[col['状態']] === STATUS.USED && r[col['使用日時']]) base = toDate_(r[col['使用日時']]);
    else if (r[col['期限']]) base = toDate_(r[col['期限']]);
    if (!base) continue;
    var ended = r[col['状態']] === STATUS.USED || r[col['状態']] === STATUS.STOPPED || endOfDay_(base) < now;
    if (ended && addDays_(base, keepDays) < now) {
      sh.getRange(i + 1, col['宛名'] + 1).setValue('');
      sh.getRange(i + 1, col['敬称'] + 1).setValue('');
      sh.getRange(i + 1, col['呼び名を消した日時'] + 1).setValue(now);
      count++;
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* スプレッドシートのメニューと初期設定                                */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('紹介状')
    .addItem('初期設定（最初に1回）', 'setup')
    .addItem('紹介元を追加', 'addReferrerFromMenu')
    .addItem('呼び名の自動削除をいま実行', 'purgeNamesFromMenu')
    .addToUi();
}

/** シートを作り、見出し・初期値・集計の式・毎日の削除を用意する。何度実行しても壊れない */
function setup() {
  ensureSheet_(SHEET.SETTINGS, HEAD.SETTINGS);
  ensureSheet_(SHEET.SHOPS, HEAD.SHOPS);
  ensureSheet_(SHEET.REFERRERS, HEAD.REFERRERS);
  ensureSheet_(SHEET.LETTERS, HEAD.LETTERS);

  var settings = sheet_(SHEET.SETTINGS);
  if (settings.getLastRow() < 2) {
    settings.getRange(2, 1, 3, 3).setValues([
      ['有効期限（日）', 30, '紹介状ができてから使えるまでの日数'],
      ['呼び名を消すまで（日）', 30, '使用済み・期限切れのあと、呼び名を消すまでの日数（仮）'],
      ['画面のURL', 'https://あなたのユーザー名.github.io/リポジトリ名/', 'GitHub Pages の公開URL（末尾の / まで）']
    ]);
  }

  var shops = sheet_(SHEET.SHOPS);
  shops.getRange('A:A').setNumberFormat('@');
  shops.getRange('G:G').setNumberFormat('@');
  if (shops.getLastRow() < 2) {
    shops.getRange(2, 1, 3, HEAD.SHOPS.length).setValues([
      ['shop-a', '見本の店A', '（エリア）', '17:00〜23:00', '月曜', '見本の店A', randomCode_(), true],
      ['shop-b', '見本の店B', '（エリア）', '17:00〜24:00', '木曜', '見本の店B', randomCode_(), true],
      ['shop-c', '見本の店C', '（エリア）', '18:00〜翌1:00', '日曜', '見本の店C', randomCode_(), true]
    ]);
  }
  sheet_(SHEET.LETTERS).getRange('H:H').setNumberFormat('@');
  sheet_(SHEET.LETTERS).getRange('D:D').setNumberFormat('@');
  sheet_(SHEET.LETTERS).getRange('F:G').setNumberFormat('yyyy/mm/dd hh:mm');
  sheet_(SHEET.LETTERS).getRange('K:K').setNumberFormat('yyyy/mm/dd hh:mm');
  sheet_(SHEET.LETTERS).getRange('M:M').setNumberFormat('yyyy/mm/dd hh:mm');

  buildSummary_();

  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'purgeNames';
  });
  if (!exists) {
    ScriptApp.newTrigger('purgeNames').timeBased().everyDays(1).atHour(4).create();
  }
}

function addReferrerFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var nameRes = ui.prompt('紹介元を追加', '画面に出る呼び名。敬称まで入れてください（例：〇〇さん、まっちゃん）', ui.ButtonSet.OK_CANCEL);
  if (nameRes.getSelectedButton() !== ui.Button.OK) return;
  var name = nameRes.getResponseText().trim();
  if (!name) return;
  var typeRes = ui.prompt('種類', '「店」または「常連」', ui.ButtonSet.OK_CANCEL);
  if (typeRes.getSelectedButton() !== ui.Button.OK) return;
  var kind = typeRes.getResponseText().trim() || '常連';
  var own = '';
  if (kind === '店') {
    var ownRes = ui.prompt('自分の店', 'その店の店ID（「店」シートのA列）。入れると、一覧から自分の店を外します', ui.ButtonSet.OK_CANCEL);
    if (ownRes.getSelectedButton() === ui.Button.OK) own = ownRes.getResponseText().trim();
  }
  var link = addReferrer(name, kind, own);
  ui.alert('追加しました', name + ' の紹介用リンク：\n' + link, ui.ButtonSet.OK);
}

/** 紹介元を1行足して、紹介用リンクを返す */
function addReferrer(name, kind, ownShopId) {
  var id = newId_('R');
  var row = {};
  row['紹介ID'] = id;
  row['共有ID'] = '';   // 使っていない（以前の仕組みの名残り。列の位置を保つために残す）
  row['呼び名'] = name;
  row['種類'] = kind;
  row['有効'] = true;
  row['紹介用リンク'] = referrerLink_(id);
  row['メモ'] = '';
  row['自分の店ID'] = ownShopId || '';
  appendRow_(SHEET.REFERRERS, HEAD.REFERRERS, row);
  return row['紹介用リンク'];
}

function purgeNamesFromMenu() {
  var n = purgeNames();
  SpreadsheetApp.getUi().alert('呼び名を消した件数：' + n);
}

function buildSummary_() {
  var sh = ensureSheet_(SHEET.SUMMARY, []);
  sh.clear();
  sh.getRange('A1:F1').setValues([['紹介ID', '紹介元', '紹介状の数', '来店', '期限切れ', '来店までの平均日数']]);
  sh.getRange('A2').setFormula("=IFERROR(FILTER('紹介元'!A2:A, '紹介元'!A2:A<>\"\"), \"\")");
  sh.getRange('B2').setFormula("=ARRAYFORMULA(IF(A2:A=\"\",, IFERROR(VLOOKUP(A2:A, {'紹介元'!A2:A, '紹介元'!C2:C}, 2, FALSE), \"\")))");
  sh.getRange('C2').setFormula("=ARRAYFORMULA(IF(A2:A=\"\",, COUNTIFS('紹介状'!B2:B, A2:A)))");
  sh.getRange('D2').setFormula("=ARRAYFORMULA(IF(A2:A=\"\",, COUNTIFS('紹介状'!B2:B, A2:A, '紹介状'!J2:J, \"使用済み\")))");
  sh.getRange('E2').setFormula("=ARRAYFORMULA(IF(A2:A=\"\",, COUNTIFS('紹介状'!B2:B, A2:A, '紹介状'!J2:J, \"未使用\", '紹介状'!G2:G, \"<\"&TODAY())))");
  sh.getRange('F2').setFormula("=ARRAYFORMULA(IF(A2:A=\"\",, IFERROR(ROUND(AVERAGEIFS('紹介状'!K2:K, '紹介状'!B2:B, A2:A, '紹介状'!J2:J, \"使用済み\") - AVERAGEIFS('紹介状'!F2:F, '紹介状'!B2:B, A2:A, '紹介状'!J2:J, \"使用済み\"), 1), \"\")))");
  sh.getRange('H1:K1').setValues([['行き先の店', '紹介状の数', '来店', '「また行きたい」']]);
  sh.getRange('H2').setFormula("=IFERROR(FILTER('店'!B2:B, '店'!B2:B<>\"\"), \"\")");
  sh.getRange('I2').setFormula("=ARRAYFORMULA(IF(H2:H=\"\",, COUNTIFS('紹介状'!E2:E, H2:H)))");
  sh.getRange('J2').setFormula("=ARRAYFORMULA(IF(H2:H=\"\",, COUNTIFS('紹介状'!E2:E, H2:H, '紹介状'!J2:J, \"使用済み\")))");
  sh.getRange('K2').setFormula("=ARRAYFORMULA(IF(H2:H=\"\",, COUNTIFS('紹介状'!E2:E, H2:H, '紹介状'!N2:N, \"*また行きたい*\")))");
  sh.setFrozenRows(1);
}

/* ------------------------------------------------------------------ */
/* 画面に返す形                                                        */
/* ------------------------------------------------------------------ */

function publicShop_(s) {
  return {
    id: String(s['店ID']),
    name: String(s['店名']),
    area: String(s['エリア'] || ''),
    hours: String(s['営業時間'] || ''),
    closed: String(s['定休日'] || ''),
    mapQuery: String(s['地図の検索語'] || s['店名'])
  };
}

function publicLetter_(row) {
  var shop = findShop_(row['行き先の店ID']);
  return {
    id: row['紹介状ID'],
    from: row['紹介元'],
    shop: shop ? publicShop_(shop) : { id: row['行き先の店ID'], name: row['行き先'] },
    expires: formatDate_(toDate_(row['期限'])),
    status: statusCode_(effectiveStatus_(row)),
    nickname: row['宛名'] || '',
    honorific: row['敬称'] || '',
    usedAt: row['使用日時'] ? formatDateTime_(toDate_(row['使用日時'])) : '',
    words: row['ひとこと'] ? String(row['ひとこと']).split('、') : [],
    wordChoices: WORDS
  };
}

/** シート上の状態に、期限と紹介元の停止を重ねた「いまの状態」 */
function effectiveStatus_(row) {
  var s = row['状態'] || STATUS.UNUSED;
  if (s !== STATUS.UNUSED) return s;
  var ref = findReferrer_('紹介ID', row['紹介ID']);
  if (ref && !ref.active) return STATUS.STOPPED;
  var exp = toDate_(row['期限']);
  if (exp && endOfDay_(exp) < new Date()) return STATUS.EXPIRED;
  return STATUS.UNUSED;
}

function statusCode_(s) {
  if (s === STATUS.USED) return 'used';
  if (s === STATUS.STOPPED) return 'stopped';
  if (s === STATUS.EXPIRED) return 'expired';
  return 'unused';
}

/* ------------------------------------------------------------------ */
/* シート操作の下まわり                                                */
/* ------------------------------------------------------------------ */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('シートがありません：' + name + '（メニューの「初期設定」を実行してください）');
  return sh;
}

function ensureSheet_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (head.length) {
    // 列が増えたときも見出しが揃うよう、毎回1行目を書き直す（データには触れない）
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function indexOf_(head) {
  var m = {};
  head.forEach(function (h, i) { m[h] = i; });
  return m;
}

/** display=true なら表示どおりの文字で読む（店・紹介元の表は日付や数字に化けさせない） */
function readTable_(name, head, display) {
  var range = sheet_(name).getDataRange();
  var values = display ? range.getDisplayValues() : range.getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _rowIndex: i + 1 };
    head.forEach(function (h, j) { o[h] = values[i][j]; });
    out.push(o);
  }
  return out;
}

function appendRow_(name, head, obj) {
  sheet_(name).appendRow(head.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
}

function setCells_(name, head, rowIndex, patch) {
  var sh = sheet_(name);
  var col = indexOf_(head);
  Object.keys(patch).forEach(function (k) {
    sh.getRange(rowIndex, col[k] + 1).setValue(patch[k]);
  });
}

function findReferrer_(field, value) {
  if (!value) return null;
  var rows = readTable_(SHEET.REFERRERS, HEAD.REFERRERS, true);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][field]) === String(value)) {
      return {
        id: rows[i]['紹介ID'],
        shareId: rows[i]['共有ID'],
        name: String(rows[i]['呼び名']),
        active: isTrue_(rows[i]['有効']),
        ownShopId: String(rows[i]['自分の店ID'] || '').trim()
      };
    }
  }
  return null;
}

function findShop_(shopId) {
  if (!shopId) return null;
  var rows = readTable_(SHEET.SHOPS, HEAD.SHOPS, true);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['店ID']) === String(shopId)) return rows[i];
  }
  return null;
}

function findLetter_(letterId) {
  if (!letterId) return null;
  var rows = readTable_(SHEET.LETTERS, HEAD.LETTERS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['紹介状ID']) === String(letterId)) return { row: rows[i], rowIndex: rows[i]._rowIndex };
  }
  return null;
}

function settingNumber_(key, fallback) {
  var rows = sheet_(SHEET.SETTINGS).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      var n = Number(rows[i][1]);
      return isFinite(n) && n > 0 ? n : fallback;
    }
  }
  return fallback;
}

function settingText_(key) {
  var rows = sheet_(SHEET.SETTINGS).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) return String(rows[i][1] || '');
  }
  return '';
}

function referrerLink_(refId) {
  var base = settingText_('画面のURL');
  if (base && base.slice(-1) !== '/') base += '/';
  return base + '?r=' + encodeURIComponent(refId);
}

/* ------------------------------------------------------------------ */
/* 小さな道具                                                          */
/* ------------------------------------------------------------------ */

/** 式として解釈されないよう、先頭が = + - @ のときは ' を付けて文字として書く */
function asText_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function randomCode_() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function toDate_(v) {
  if (!v) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return v;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function addDays_(d, n) {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

/** その日（日本時間）の終わり。期限の日は1日中使える */
function endOfDay_(d) {
  var ymd = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  return new Date(ymd + 'T23:59:59+09:00');
}

function formatDate_(d) {
  return d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : '';
}

function formatDateTime_(d) {
  return d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm') : '';
}
