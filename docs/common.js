// 画面どうしで共通の小さな道具
(function () {
  var MESSAGES = {
    referrer_not_found: 'このリンクは見つかりませんでした。紹介してくれた方に確かめてください。',
    referrer_stopped: 'このリンクは、いまは使えません。',
    shop_not_found: 'このお店は、いまは紹介状を受け付けていません。',
    own_shop: '自分のお店への紹介状は作れません。',
    wrong_shop: 'このシールは、紹介状の行き先とは別のお店のものです。',
    letter_not_found: 'この紹介状は見つかりませんでした。',
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
    rememberedLetters: rememberedLetters, rememberLetter: rememberLetter
  };
})();
