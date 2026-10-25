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
  function keepText(pub) {
    return '（自分用メモ）吉祥寺はしごパスポートのリンクです。なくしたら再発行になります。\n' + cardUrl(pub);
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

  // 紹介状の画面から入る小さな表紙。p は myPass の結果（null なら白紙）
  function passMiniHtml(p) {
    var count = p && p.stamps ? p.stamps.length : p && p.count != null ? p.count : 0;
    var sub;
    if (!p || !count) sub = 'まだスタンプはありません';
    else if (!p.issued) sub = '未発行・スタンプ ' + count + '個';
    else sub = p.name + '・スタンプ ' + count + '個';
    return passEmblem() +
      '<span class="pass-mini-text"><span class="pass-mini-area">吉祥寺</span><span class="pass-mini-title">はしごパスポート</span>' +
      '<span class="pass-mini-sub">' + esc(sub) + '</span></span>' +
      '<span class="pass-mini-go" aria-hidden="true"></span>';
  }

  // 発行の欄。名前を入れて「発行する」を押すと、パスポートが有効になる
  function issueFormHtml(mode) {
    var rename = mode === 'rename';
    return '<div class="issue">' +
      (rename ? '' :
      '<p class="issue-title serif">吉祥寺はしごパスポートを発行しませんか？</p>' +
      '<p class="issue-lead">酒場で呼ばれたいニックネームで、自分専用のパスポートを発行できます。紹介状で行ったお店のスタンプがたまっていくので、飲み歩きの記録が残ります。今日のスタンプが、最初の1つになります。</p>') +
      '<label class="field" for="pass-name">' + (rename ? '新しいニックネーム（8文字まで）' : 'ニックネーム（8文字まで・表紙に入ります）') + '</label>' +
      '<div class="name-row"><input id="pass-name" type="text" autocomplete="off" placeholder="例：まっ、ケン"></div>' +
      '<p class="err" id="pass-err" role="alert"></p>' +
      '<button id="pass-issue" class="btn primary" type="button">' + (rename ? '変える' : '発行する') + '</button>' +
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
      err.textContent = over ? '8文字までにしてください。' : '';
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
  function keepBoxHtml(pub) {
    return '<div class="keepbox">' +
      '<p><b>このリンクが、あなたのパスポートです。</b>なくしたら再発行になるので、ブックマークするか、LINEのKeepメモに送っておいてください。</p>' +
      '<a class="btn line keep-line" href="' + esc(lineShareUrl(keepText(pub))) + '" target="_blank" rel="noopener">LINEのKeepメモに送る</a>' +
      '<button class="btn keep-copy" type="button" data-url="' + esc(cardUrl(pub)) + '">リンクをコピー</button>' +
      '<p class="muted small">リンクは見るためのものです。友達に見せても、スタンプを押されたり名前を変えられたりすることはありません。スタンプを押せるのは、このスマホのこのブラウザだけです。</p>' +
      '</div>';
  }
  function bindKeepBox(root) {
    var b = root.querySelector('.keep-copy');
    if (!b) return;
    b.addEventListener('click', function () {
      copyText(b.getAttribute('data-url')).then(function () { toast('リンクをコピーしました'); }, function () { toast('コピーできませんでした'); });
    });
  }

  // このスマホで「行ってきました」を押した紹介状か（転送された人と見分ける）
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

  window.Shokaijo = {
    get: get, post: post, message: message, param: param, esc: esc, jpDate: jpDate,
    mapUrl: mapUrl, lineShareUrl: lineShareUrl, copyText: copyText,
    storeGet: storeGet, storeSet: storeSet, qrSvg: qrSvg, toast: toast,
    rememberedLetters: rememberedLetters, rememberLetter: rememberLetter,
    cardUrl: cardUrl, wordIcon: wordIcon, stampHtml: stampHtml,
    passEmblem: passEmblem, passMiniHtml: passMiniHtml,
    myKey: myKey, ensureKey: ensureKey, keyIsSaved: keyIsSaved, myPass: myPass, keepText: keepText,
    issueFormHtml: issueFormHtml, bindIssueForm: bindIssueForm, keepBoxHtml: keepBoxHtml, bindKeepBox: bindKeepBox,
    pressedHere: pressedHere, pendingHere: pendingHere
  };
})();
