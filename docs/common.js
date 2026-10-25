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
  function rememberLetter(id, shopId) {
    if (!id) return;
    var list = rememberedLetters().filter(function (x) { return x.id !== id; });
    list.unshift({ id: id, shop: shopId || '', at: Date.now() });
    storeSet(LETTERS_KEY, JSON.stringify(list.slice(0, 20)));
  }

  // 自分の台紙（スタンプ）のID。押したときと、台紙のリンクを開いたときに覚え直す
  var CARD_KEY = 'shokaijo:card';
  function myCard() {
    var v = storeGet(CARD_KEY) || '';
    return /^C[0-9a-f]{24}$/.test(v) ? v : '';
  }
  function rememberCard(id) {
    if (/^C[0-9a-f]{24}$/.test(id || '')) storeSet(CARD_KEY, id);
  }
  function cardUrl(id) {
    var u = new URL('card.html', location.href);
    u.search = '?c=' + encodeURIComponent(id) + '&openExternalBrowser=1';
    return u.toString();
  }

  // 選べる言葉は決まっているので、台紙ではアイコンで見せる
  var ICON_PATHS = {
    'ありがとう': '<path d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20z"/>',
    '楽しかった': '<circle cx="12" cy="12" r="8"/><path d="M8.5 13.5a4 4 0 0 0 7 0"/><path d="M9.5 9.8v.4M14.5 9.8v.4"/>',
    'また行きたい': '<path d="M5 12a7 7 0 0 1 12-4.9L19 9"/><path d="M19 4.5V9h-4.5"/><path d="M19 12a7 7 0 0 1-12 4.9L5 15"/><path d="M5 19.5V15h4.5"/>'
  };
  function wordIcon(w) {
    var d = ICON_PATHS[w];
    if (!d) return '';
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="' + esc(w) + '"><title>' + esc(w) + '</title>' + d + '</svg>';
  }

  // スタンプ1つ分。店名・行った日・誰の紹介か・選んだ言葉（アイコン）
  function stampHtml(st, i) {
    var n = Array.from(st.shop || '').length;
    var size = n <= 5 ? 'l' : n <= 9 ? 'm' : 's';
    var tilt = [-7, 4, -3, 6, -5, 2][(i || 0) % 6];
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(st.date || '');
    var date = m ? m[1] + '.' + Number(m[2]) + '.' + Number(m[3]) : '';
    var icons = (st.words || []).map(wordIcon).join('');
    return '<li class="stamp-cell">' +
      '<div class="hanko" style="transform:rotate(' + tilt + 'deg)">' +
      '<span class="hanko-shop ' + size + '">' + esc(st.shop) + '</span>' +
      '<span class="hanko-date">' + esc(date) + '</span></div>' +
      '<p class="stamp-from">' + esc(st.from) + 'の紹介</p>' +
      (icons ? '<p class="stamp-words">' + icons + '</p>' : '') +
      '</li>';
  }

  // はしごパスポートの紋章：丸の中にはしご
  function passEmblem(cls) {
    return '<svg class="' + (cls || 'pass-emblem') + '" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="24" cy="24" r="21"/><circle cx="24" cy="24" r="17.5" stroke-width="0.8"/>' +
      '<path d="M18 11v26M30 11v26M18 16h12M18 22h12M18 28h12M18 34h12"/></svg>';
  }

  // 紹介状の画面から入る小さな表紙。count が分からないときは数を出さない
  function passMiniHtml(count) {
    var sub = count == null ? 'スタンプを見る' : count ? 'スタンプ ' + count + '個' : 'まだスタンプはありません';
    return passEmblem() +
      '<span class="pass-mini-text"><span class="pass-mini-title">はしごパスポート</span>' +
      '<span class="pass-mini-sub">' + esc(sub) + '</span></span>' +
      '<span class="pass-mini-go" aria-hidden="true"></span>';
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

  window.Shokaijo = {
    get: get, post: post, message: message, param: param, esc: esc, jpDate: jpDate,
    mapUrl: mapUrl, lineShareUrl: lineShareUrl, copyText: copyText,
    storeGet: storeGet, storeSet: storeSet, qrSvg: qrSvg, toast: toast,
    rememberedLetters: rememberedLetters, rememberLetter: rememberLetter,
    myCard: myCard, rememberCard: rememberCard, cardUrl: cardUrl, wordIcon: wordIcon, stampHtml: stampHtml,
    passEmblem: passEmblem, passMiniHtml: passMiniHtml
  };
})();
