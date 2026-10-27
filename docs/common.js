// 画面どうしで共通の小さな道具
(function () {
  var MESSAGES = {
    referrer_not_found: 'このリンクは見つかりませんでした。紹介してくれた方に確かめてください。',
    referrer_stopped: 'このリンクは、いまは使えません。',
    shop_not_found: 'このお店は、いまは紹介状を受け付けていません。',
    own_shop: '自分のお店への紹介状は作れません。',
    wrong_shop: 'このシールは、紹介状の行き先とは別のお店のものです。',
    letter_not_found: 'この紹介状は見つかりませんでした。',
    card_not_found: 'このパスポートは見つかりませんでした。リンクが途中で切れていないか確かめてください。',
    bad_key: 'このスマホのパスポートの情報が読めませんでした。ページを開き直して、もう一度お試しください。',
    pass_name_required: 'ニックネームを入れてください。',
    pass_no_stamp: 'スタンプが押されてから発行できます。',
    not_visited: 'スタンプを押してから答えられます。',
    not_yours: 'このスマホで押したスタンプではないので、変えられません。',
    no_answer: 'どれか1つ選んでください。',
    letter_used: 'この紹介状は使用済みです。',
    letter_expired: 'この紹介状は期限が切れています。',
    letter_stopped: 'この紹介状は、いまは使えません。',
    name_too_long: '呼び名が長すぎます。',
    name_required: '送る相手の呼び名を入れてください。',
    old_link: 'このリンクは以前の形のため、もう使えません。紹介してくれた人に、新しい紹介状を送ってもらってください。',
    wrong_code: '確認番号が違います。',
    too_many_tries: '確認番号の入力が続けて違っていたため、しばらく受け付けられません。',
    shop_not_ready: 'このお店の確認番号がまだ用意されていません。',
    not_configured: '準備中です（つなぎ先が設定されていません）。',
    network: '通信できませんでした。電波のよいところで、もう一度お試しください。',
    server_error: 'うまく処理できませんでした。少しおいて、もう一度お試しください。'
  };

  var MESSAGES_EN = {
    referrer_not_found: 'This link could not be found. Please check with the person who introduced you.',
    referrer_stopped: 'This link cannot be used right now.',
    shop_not_found: 'This shop is not taking letters of introduction right now.',
    wrong_shop: 'This QR code belongs to a different shop from the one on your letter.',
    letter_not_found: 'This letter could not be found.',
    card_not_found: 'This passport could not be found. Please check that the link was not cut off.',
    bad_key: 'We could not read the passport data on this phone. Please reopen the page and try again.',
    pass_name_required: 'Please enter a nickname.',
    pass_no_stamp: 'You can issue a passport after you get a stamp.',
    not_visited: 'You can answer after you get your stamp.',
    not_yours: 'This stamp was not collected on this phone, so it cannot be changed here.',
    no_answer: 'Please choose at least one answer.',
    letter_used: 'This letter has already been used.',
    letter_expired: 'This letter has expired.',
    letter_stopped: 'This letter cannot be used right now.',
    old_link: 'This link is in an old format and no longer works. Please ask the person who introduced you to send a new letter.',
    not_configured: 'Not ready yet (the service is not connected).',
    network: 'We could not connect. Please try again where the signal is better.',
    server_error: 'Something went wrong. Please wait a moment and try again.'
  };

  // 言語：受け取った人の画面（<html data-i18n>）だけ英語に切り替えられる。選んだ言語はこのスマホが覚える
  var LANG_KEY = 'shokaijo:lang';
  var I18N = document.documentElement.hasAttribute('data-i18n');
  function detectLang() {
    if (!I18N) return 'ja';
    var v = null;
    try { v = window.localStorage.getItem(LANG_KEY); } catch (e) { v = null; }
    if (v === 'ja' || v === 'en') return v;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'ja';
    return /^ja\b/i.test(nav) ? 'ja' : 'en';
  }
  var LANG = detectLang();
  var EN = LANG === 'en';
  function L(ja, en) { return EN ? en : ja; }
  function setLang(v) {
    try { window.localStorage.setItem(LANG_KEY, v); } catch (e) { /* 使えなくても、この表示の間は切り替わる */ }
  }
  // 画面に書いてある文：data-en を持つ要素は、英語のときその中身に置き換える（中身は自前の固定文だけ）
  function applyStatic() {
    if (!I18N) return;
    document.documentElement.lang = LANG;
    if (!EN) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-en]'), function (el) { el.innerHTML = el.getAttribute('data-en'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-en-placeholder]'), function (el) { el.placeholder = el.getAttribute('data-en-placeholder'); });
  }
  // 右上の切り替え：いまと違う言語の名前を、文字リンクで出す
  function mountLangSwitch() {
    if (!I18N || document.getElementById('langsw')) return;
    var main = document.querySelector('main.wrap');
    if (!main) return;
    var p = document.createElement('p');
    p.id = 'langsw';
    p.className = 'langsw';
    p.innerHTML = '<a href="#" lang="' + (EN ? 'ja' : 'en') + '">' + (EN ? '日本語' : 'English') + '</a>';
    p.firstChild.addEventListener('click', function (e) {
      e.preventDefault();
      setLang(EN ? 'ja' : 'en');
      location.reload();
    });
    main.insertBefore(p, main.firstChild);
  }

  function apiBase() {
    var u = window.SHOKAIJO_API || '';
    return /^https?:\/\//.test(u) || u.charAt(0) === '/' ? u : '';
  }

  function handle(res) {
    return res.json().then(function (body) {
      if (!body || !body.ok) throw new Error((body && body.error) || 'server_error');
      return body.data;
    });
  }

  function get(params) {
    var base = apiBase();
    if (!base) return Promise.reject(new Error('not_configured'));
    var q = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetch(base + (base.indexOf('?') >= 0 ? '&' : '?') + q, { method: 'GET' })
      .catch(function () { throw new Error('network'); })
      .then(handle);
  }

  // Apps Script はプリフライトを受けられないので text/plain で送る
  function post(body) {
    var base = apiBase();
    if (!base) return Promise.reject(new Error('not_configured'));
    return fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    })
      .catch(function () { throw new Error('network'); })
      .then(handle);
  }

  function message(err) {
    var code = err && err.message;
    if (EN) return MESSAGES_EN[code] || MESSAGES_EN.server_error;
    return MESSAGES[code] || MESSAGES.server_error;
  }

  function param(name) {
    return new URLSearchParams(location.search).get(name) || '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function jpDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
    if (!m) return ymd || '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (EN) return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    var w = '日月火水木金土'.charAt(d.getDay());
    return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日（' + w + '）';
  }

  function mapUrl(q) {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  function lineShareUrl(text) {
    return 'https://line.me/R/share?text=' + encodeURIComponent(text);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* 使えなくても動く */ }
  }

  // このスマホで開いた紹介状を覚えておく（お店のシールから探すため）
  var LETTERS_KEY = 'shokaijo:letters';
  function rememberedLetters() {
    try { return JSON.parse(storeGet(LETTERS_KEY) || '[]') || []; } catch (e) { return []; }
  }
  // opt: { name: 店名, pressed: true（押した）, pending: true（押しかけて応答を待っている） }
  function rememberLetter(id, shopId, opt) {
    if (!id) return;
    opt = opt || {};
    var old = rememberedLetters().filter(function (x) { return x.id === id; })[0] || {};
    var list = rememberedLetters().filter(function (x) { return x.id !== id; });
    var pressed = !!(opt.pressed || old.pressed);
    list.unshift({
      id: id, shop: shopId || '', name: opt.name || old.name || '', at: Date.now(),
      pressed: pressed, pending: !pressed && ('pending' in opt ? !!opt.pending : !!old.pending)
    });
    storeSet(LETTERS_KEY, JSON.stringify(list.slice(0, 20)));
  }

  // はしごパスポートの鍵。このスマホの中だけに置き、URLには載せない。保存できないブラウザでは、開いている間だけ持つ
  var KEY_KEY = 'shokaijo:key';
  var memKey = '';
  function isKey(v) { return /^K[0-9a-f]{32}$/.test(v || ''); }
  function myKey() {
    var v = storeGet(KEY_KEY) || memKey;
    return isKey(v) ? v : '';
  }
  function ensureKey() {
    var k = myKey();
    if (k) return k;
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    k = 'K' + Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    memKey = k;
    storeSet(KEY_KEY, k);
    return k;
  }
  function keyIsSaved() { return isKey(storeGet(KEY_KEY)); }

  // 見るためのURL（公開IDだけを載せる）。公開IDがなければ、このスマホのパスポートを開く
  function cardUrl(pub) {
    var u = new URL('card.html', location.href);
    u.search = pub ? '?c=' + encodeURIComponent(pub) + '&openExternalBrowser=1' : '';
    return u.toString();
  }

  // 自分のパスポートの様子（発行済みか・名前・スタンプ）。鍵がなければ null
  function myPass() {
    var k = myKey();
    if (!k) return Promise.resolve(null);
    return post({ action: 'mine', key: k });
  }

  // 自分用に送るときの文。人に送らないよう、自分用だと分かる形にする
  // 自分用リンク：見るためのURLの # のあとに鍵を付ける。# 以降はサーバーにもリファラにも送られない
  function ownerUrl(pub) {
    return cardUrl(pub) + '#k=' + myKey();
  }
  function keepText(pub) {
    if (EN) return '(Private: do not share) Your Kichijoji Hashigo Passport link with its key. If you change phones or your browser data is cleared, open this to carry on where you left off.\n' + ownerUrl(pub);
    return '（自分用・人に送らない）吉祥寺はしごパスポートの鍵つきリンクです。スマホを替えたり、ブラウザのデータが消えたりしたときは、これを開くと続きから押せます。\n' + ownerUrl(pub);
  }
  function showText(pub) {
    if (EN) return 'My Kichijoji Hashigo Passport (view-only link).\n' + cardUrl(pub);
    return '吉祥寺はしごパスポートです（見るだけのリンク）。\n' + cardUrl(pub);
  }

  // 自分用リンクから鍵を受け取る。戻り値：'none'（鍵なし）/ 'same' / 'adopted' / 'conflict'（このブラウザに別の鍵）
  function keyFromHash() {
    var m = /[#&]k=(K[0-9a-f]{32})/.exec(location.hash || '');
    if (!m) return { state: 'none' };
    var k = m[1];
    var cur = myKey();
    if (cur === k) return { state: 'same' };
    if (!cur) { adoptKey(k); return { state: 'adopted' }; }
    return { state: 'conflict', key: k };
  }
  // 鍵を切り替える。前の鍵は控えとして残す
  function adoptKey(k) {
    var cur = myKey();
    if (cur && cur !== k) {
      var old = [];
      try { old = JSON.parse(storeGet('shokaijo:oldkeys') || '[]') || []; } catch (e) { old = []; }
      if (old.indexOf(cur) < 0) old.unshift(cur);
      storeSet('shokaijo:oldkeys', JSON.stringify(old.slice(0, 5)));
    }
    memKey = k;
    storeSet(KEY_KEY, k);
  }

  // 選べる言葉は決まっているので、台紙ではアイコンで見せる
  var ICON_PATHS = {
    'ありがとう': '<path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20z"/>',
    '楽しかった': '<circle cx="12" cy="12" r="8"/><path d="M8.5 13.5a4 4 0 0 0 7 0"/><path d="M9.5 9.8v.4M14.5 9.8v.4"/>',
    'また行きたい': '<path d="M5 12a7 7 0 0 1 12-4.9L19 9"/><path d="M19 4.5V9h-4.5"/><path d="M19 12a7 7 0 0 1-12 4.9L5 15"/><path d="M5 19.5V15h4.5"/>'
  };
  // 画面に出す名前。記録は日本語のまま（集計がばらけないように）
  var LABEL_EN = {
    'ありがとう': 'Thank you', '楽しかった': 'Had fun', 'また行きたい': 'Will be back',
    '吉祥寺の近く': 'Near Kichijoji', '東京のほかの街': 'Elsewhere in Tokyo',
    '東京の外から（出張・旅行）': 'From outside Tokyo (business or travel)', '海外から': 'From overseas',
    '家で過ごしていた': 'Stayed home', '吉祥寺の別のお店で飲んでいた': 'Gone to another bar in Kichijoji',
    'ほかの街で飲んでいた': 'Gone out in another area', 'わからない': 'Not sure'
  };
  function label(v) { return EN && LABEL_EN[v] ? LABEL_EN[v] : v; }
  function wordIcon(w) {
    var d = ICON_PATHS[w];
    if (!d) return '';
    var t = esc(label(w));
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="' + t + '"><title>' + t + '</title>' + d + '</svg>';
  }

  // ひとことのシールの色（ことばごと）
  var SEAL = { 'ありがとう': 'seal-thanks', '楽しかった': 'seal-fun', 'また行きたい': 'seal-again' };

  // スタンプ1つ分。判子（お店）・シール（自分のひとこと）・ピン（地図を開く）は持ち主が違うので、見せ方を分ける
  function stampHtml(st, i) {
    var n = Array.from(st.shop || '').length;
    var size = n <= 5 ? 'l' : n <= 9 ? 'm' : 's';
    var tilt = [-7, 4, -3, 6, -5, 2][(i || 0) % 6];
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(st.date || '');
    var date = m ? m[1] + '.' + Number(m[2]) + '.' + Number(m[3]) : '';
    var word = (st.words || []).filter(function (w) { return SEAL[w]; })[0] || '';   // ひとことは1つ（前に2つ以上選んだものは最初の1つ）
    var seal = word ? '<span class="stamp-seal ' + SEAL[word] + '">' + wordIcon(word) + '</span>' : '';
    var hanko = '<div class="hanko" style="transform:rotate(' + tilt + 'deg)">' +
      '<span class="hanko-shop ' + size + '">' + esc(st.shop) + '</span>' +
      '<span class="hanko-date">' + esc(date) + '</span></div>';
    // スタンプを押すと、そのお店の地図が開く（店名が読めなくても、場所でどの店か分かる）。判子の右下にピンを重ねる
    if (st.map) {
      hanko = '<a class="stamp-link" href="' + esc(mapUrl(st.map)) + '" target="_blank" rel="noopener" aria-label="' +
        esc(L(st.shop + 'の地図を開く', 'Open ' + st.shop + ' in Maps')) + '">' + hanko + seal +
        '<span class="stamp-pin" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg></span></a>';
    } else {
      hanko = '<span class="stamp-link">' + hanko + seal + '</span>';
    }
    // 判子の下は1行：誰の紹介か（長いときは…で省く）
    return '<li class="stamp-cell">' + hanko +
      '<p class="stamp-meta"><span class="stamp-from">' + (EN ? 'via ' + esc(st.from) : esc(st.from) + 'の紹介') + '</span></p>' +
      '</li>';
  }

  // はしごパスポートの紋章：丸の中にはしご
  function passEmblem(cls) {
    return '<svg class="' + (cls || 'pass-emblem') + '" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="21"/><circle cx="24" cy="24" r="17.5" stroke-width="0.8"/>' +
      '<path d="M18 11v26M30 11v26M18 16h12M18 22h12M18 28h12M18 34h12"/></svg>';
  }

  function stampCount(n) { return EN ? n + (n === 1 ? ' stamp' : ' stamps') : 'スタンプ ' + n + '個'; }

  // 紹介状の画面から入る小さな表紙。p は myPass の結果（null なら白紙）
  function passMiniHtml(p) {
    var count = p && p.stamps ? p.stamps.length : p && p.count != null ? p.count : 0;
    var sub;
    var n = stampCount(count);
    if (!p || !count) sub = L('まだスタンプはありません', 'No stamps yet');
    else if (!p.issued) sub = L('未発行・', 'Not issued · ') + n;
    else sub = p.name + L('・', ' · ') + n;
    return passEmblem() +
      '<span class="pass-mini-text"><span class="pass-mini-area">' + L('吉祥寺', 'KICHIJOJI') + '</span><span class="pass-mini-title">' + L('はしごパスポート', 'Hashigo Passport') + '</span>' +
      '<span class="pass-mini-sub">' + esc(sub) + '</span></span>' +
      '<span class="pass-mini-go" aria-hidden="true"></span>';
  }

  // 発行の欄。名前を入れて「発行する」を押すと、パスポートが有効になる
  function issueFormHtml(mode) {
    var rename = mode === 'rename';
    return '<div class="issue">' +
      (rename ? '' :
      '<p class="issue-title serif">' + L('吉祥寺はしごパスポートを発行しませんか？', 'Get your own Kichijoji Hashigo Passport?') + '</p>' +
      '<p class="issue-lead">' + L('酒場で呼ばれたいニックネームで、自分専用のパスポートを発行できます。紹介状で行ったお店のスタンプがたまっていくので、飲み歩きの記録が残ります。今日のスタンプが、最初の1つになります。',
        'Issue a passport of your own under the nickname you like to go by at the bar. Stamps from the shops you visit with a letter collect here, so you keep a record of your nights out. Today\'s stamp will be the first.') + '</p>') +
      '<label class="field" for="pass-name">' + (rename ? L('新しいニックネーム（8文字まで）', 'New nickname (up to 8 characters)') : L('ニックネーム（8文字まで・表紙に入ります）', 'Nickname (up to 8 characters, shown on the cover)')) + '</label>' +
      '<div class="name-row"><input id="pass-name" type="text" autocomplete="off" placeholder="' + L('例：まっ、ケン', 'e.g. Mike, Ken') + '"></div>' +
      '<p class="err" id="pass-err" role="alert"></p>' +
      '<button id="pass-issue" class="btn primary" type="button">' + (rename ? L('変える', 'Change') : L('発行する', 'Issue')) + '</button>' +
      '</div>';
  }
  function bindIssueForm(root, defaultName, onDone) {
    var input = root.querySelector('#pass-name');
    var btn = root.querySelector('#pass-issue');
    var err = root.querySelector('#pass-err');
    input.value = defaultName || '';
    function check() {
      var n = input.value.replace(/\s+/g, '');
      var over = Array.from(n).length > 8;
      err.textContent = over ? L('8文字までにしてください。', 'Please use 8 characters or fewer.') : '';
      btn.disabled = !n || over;
    }
    input.addEventListener('input', check);
    check();
    btn.addEventListener('click', function () {
      btn.disabled = true;
      err.textContent = '';
      post({ action: 'issue_pass', key: myKey(), name: input.value })
        .then(function (d) { onDone(d); })
        .catch(function (e) { err.textContent = message(e); check(); });
    });
  }

  // 発行したあとの「とっておく」欄。見るためのリンクを、自分用に送ってもらう
  // とっておく欄：自分用（鍵つき）と、見せる用（見るだけ）を分けて渡す
  function keepBoxHtml(pub) {
    return '<div class="keepbox">' +
      '<div class="keep-own">' +
      '<p class="keep-h">' + L('自分用の鍵つきリンク', 'Your private link (with key)') + '</p>' +
      '<p>' + L('スマホを替えたり、ブラウザのデータが消えたりしても、このリンクを開けば続きから押せます。LINEのKeepメモに送っておいてください。',
        'If you change phones or your browser data is cleared, open this link to carry on where you left off. Send it to yourself, for example to your LINE Keep Memo.') + '</p>' +
      '<a class="btn line keep-line" href="' + esc(lineShareUrl(keepText(pub))) + '" target="_blank" rel="noopener">' + L('LINEのKeepメモに送る（自分用）', 'Send to my LINE Keep Memo') + '</a>' +
      '<button class="btn keep-copy" type="button" data-copy="own">' + L('自分用リンクをコピー', 'Copy private link') + '</button>' +
      '<p class="keep-warn">' + L('スタンプを押すための鍵が入っています。人には送らないでください。', 'This link holds the key for adding stamps. Do not send it to anyone else.') + '</p>' +
      '</div>' +
      '<div class="keep-show">' +
      '<p class="keep-h">' + L('見せる用のリンク', 'Link for showing others') + '</p>' +
      '<p>' + L('友達やお店の人に見せるときは、こちらを送ってください。見るだけで、スタンプを押されたり名前を変えられたりすることはありません。',
        'Send this one to show friends or shop staff. It is view-only: nobody can add stamps or change your name with it.') + '</p>' +
      '<a class="btn show-line" href="' + esc(lineShareUrl(showText(pub))) + '" target="_blank" rel="noopener">' + L('LINEで見せる', 'Show on LINE') + '</a>' +
      '<button class="btn keep-copy" type="button" data-copy="show">' + L('見せる用リンクをコピー', 'Copy view-only link') + '</button>' +
      '</div>' +
      '</div>';
  }
  function bindKeepBox(root, pub) {
    Array.prototype.forEach.call(root.querySelectorAll('.keep-copy'), function (b) {
      b.addEventListener('click', function () {
        var url = b.getAttribute('data-copy') === 'own' ? ownerUrl(pub) : cardUrl(pub);
        copyText(url).then(function () { toast(L('リンクをコピーしました', 'Link copied')); }, function () { toast(L('コピーできませんでした', 'Could not copy')); });
      });
    });
  }

  // 来店の問い：答えた（か、答えないを選んだ）紹介状と、「どこから」に答えたかを覚える
  function answered(id) {
    try { return (JSON.parse(storeGet('shokaijo:answered') || '[]') || []).indexOf(id) >= 0; } catch (e) { return false; }
  }
  function markAnswered(id, fromToo) {
    var list = [];
    try { list = JSON.parse(storeGet('shokaijo:answered') || '[]') || []; } catch (e) { list = []; }
    if (list.indexOf(id) < 0) list.unshift(id);
    storeSet('shokaijo:answered', JSON.stringify(list.slice(0, 50)));
    if (fromToo) storeSet('shokaijo:from-answered', '1');
  }
  function fromAnswered() { return storeGet('shokaijo:from-answered') === '1'; }

  // このスマホでスタンプを押した紹介状か（転送された人と見分ける）
  function pressedHere(id) {
    return rememberedLetters().some(function (x) { return x.id === id && x.pressed; });
  }
  // 押したが応答が届かなかったかもしれない紹介状
  function pendingHere(id) {
    return rememberedLetters().some(function (x) { return x.id === id && x.pending; });
  }

  function qrSvg(text) {
    var qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function toast(text) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  // どの画面でも、フッターの上に「試験運用中のご注意」をたたんで置く
  var NOTES = [
    'これは試験運用中のサービスです。予告なく、機能や画面を変えたり、提供をやめたりすることがあります。',
    '紹介状、スタンプ、パスポートのニックネームなどの記録は、予告なく消すことがあります。',
    '入力された呼び名やニックネームは、紹介状やパスポートを表示するためにだけ使います。',
    'パスポートの見せる用リンクを知っている人は、誰でもそのパスポートを見られます（ニックネーム、行ったお店と日付、紹介元）。',
    '紹介状やスタンプに、特典や割引はありません。',
    'お店の営業時間や定休日は変わることがあります。お出かけの前に地図などで確かめてください。',
    '記録を消してほしいときや、ご意見は、運営している貝瀬（かいせ）に直接お知らせください。'
  ];
  var NOTES_EN = [
    'This is a trial service. Features and screens may change, or the service may end, without notice.',
    'Records such as letters, stamps and passport nicknames may be deleted without notice.',
    'Names and nicknames you enter are used only to display letters and passports.',
    'Anyone with the view-only link to a passport can see it (nickname, shops and dates visited, and who introduced you).',
    'Letters and stamps come with no perks or discounts.',
    'Shop hours and closing days may change. Please check a map or similar before you go.',
    'To have your records deleted, or to share feedback, contact Kaise (かいせ), who runs this service, directly.'
  ];
  function mountNotes() {
    var foot = document.querySelector('.foot');
    if (!foot || document.getElementById('notes')) return;
    var d = document.createElement('details');
    d.id = 'notes';
    d.className = 'notes';
    d.innerHTML = '<summary>' + L('試験運用中のご注意', 'Notes on this trial') + '</summary><ul>' +
      (EN ? NOTES_EN : NOTES).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
    foot.parentNode.insertBefore(d, foot);
  }
  function mountAll() { mountNotes(); mountLangSwitch(); }
  // 画面の固定文は、ページの台本が動く前に置き換えておく（台本は body の最後で読む）
  applyStatic();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();

  window.Shokaijo = {
    get: get, post: post, message: message, param: param, esc: esc, jpDate: jpDate,
    mapUrl: mapUrl, lineShareUrl: lineShareUrl, copyText: copyText,
    storeGet: storeGet, storeSet: storeSet, qrSvg: qrSvg, toast: toast,
    rememberedLetters: rememberedLetters, rememberLetter: rememberLetter,
    cardUrl: cardUrl, wordIcon: wordIcon, stampHtml: stampHtml,
    passEmblem: passEmblem, passMiniHtml: passMiniHtml,
    myKey: myKey, ensureKey: ensureKey, keyIsSaved: keyIsSaved, myPass: myPass, keepText: keepText,
    ownerUrl: ownerUrl, keyFromHash: keyFromHash, adoptKey: adoptKey,
    issueFormHtml: issueFormHtml, bindIssueForm: bindIssueForm, keepBoxHtml: keepBoxHtml, bindKeepBox: bindKeepBox,
    pressedHere: pressedHere, pendingHere: pendingHere,
    answered: answered, markAnswered: markAnswered, fromAnswered: fromAnswered,
    lang: LANG, en: EN, L: L, label: label, stampCount: stampCount
  };
})();
