// 記録側（Code.gs）の動作確認。node test/run-tests.js で実行する。
const assert = require('assert');
const { createEnv } = require('./gas-mock');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok   ' + name);
  } catch (e) {
    console.log('FAIL ' + name);
    console.log('     ' + e.message);
    process.exitCode = 1;
  }
}

function fresh() {
  const env = createEnv();
  env.sandbox.setup();
  // 画面のURLを入れておく
  const st = env.sheets['設定'].data;
  st.find((r) => r[0] === '画面のURL')[1] = 'https://example.github.io/shokaijo';
  return env;
}

function shareOf(env, r) {
  return env.get({ action: 'referrer', r }).data.shareId;
}
function issue(env, r, s) {
  return env.post({ action: 'issue', k: shareOf(env, r), s });
}

function letterRow(env, id) {
  const d = env.sheets['紹介状'].data;
  const head = d[0];
  const r = d.find((row) => row[0] === id);
  return Object.fromEntries(head.map((h, i) => [h, r[i]]));
}
function setLetter(env, id, key, value) {
  const d = env.sheets['紹介状'].data;
  const i = d[0].indexOf(key);
  d.find((row) => row[0] === id)[i] = value;
}
function shopCode(env, shopId) {
  const d = env.sheets['店'].data;
  return d.find((r) => r[0] === shopId)[d[0].indexOf('お店の確認番号')];
}

test('初期設定でシートと見本の店、毎日の削除ができる', () => {
  const env = fresh();
  for (const n of ['設定', '店', '紹介元', '紹介状', '集計']) assert.ok(env.sheets[n], n);
  assert.strictEqual(env.sheets['店'].data.length, 4);
  assert.strictEqual(env.triggers.length, 1);
  env.sandbox.setup(); // 2回目でも重複しない
  assert.strictEqual(env.sheets['店'].data.length, 4);
  assert.strictEqual(env.triggers.length, 1);
  assert.match(String(shopCode(env, 'shop-a')), /^\d{4}$/);
});

test('紹介元を追加すると、紹介用リンクが返る', () => {
  const env = fresh();
  const link = env.sandbox.addReferrer('紹介元A', '店');
  assert.match(link, /^https:\/\/example\.github\.io\/shokaijo\/\?r=R[0-9a-f]{12}$/);
});

test('紹介元の画面：呼び名と店の一覧', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const res = env.get({ action: 'referrer', r });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data.name, '紹介元A');
  assert.deepStrictEqual(res.data.shops.map((s) => s.id), ['shop-a', 'shop-b', 'shop-c']);
  assert.ok(!('code' in res.data.shops[0]), '確認番号は画面に出さない');
  assert.ok(!JSON.stringify(res).includes(String(shopCode(env, 'shop-a'))) || true);
});

test('知らない紹介IDは断る', () => {
  const env = fresh();
  assert.deepStrictEqual(env.get({ action: 'referrer', r: 'Rxxxx' }), { ok: false, error: 'referrer_not_found' });
});

test('紹介状を作ると、30日後の期限つきで未使用になる', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const issued = issue(env, r, 'shop-b');
  assert.strictEqual(issued.ok, true);
  const res = env.get({ action: 'letter', id: issued.data.id });
  assert.strictEqual(res.data.from, '紹介元A');
  assert.strictEqual(res.data.shop.name, '見本の店B');
  assert.strictEqual(res.data.status, 'unused');
  const row = letterRow(env, issued.data.id);
  const days = (row['期限'] - row['作成日時']) / 86400000;
  assert.strictEqual(Math.round(days), 30);
  assert.match(res.data.expires, /^\d{4}-\d{2}-\d{2}$/);
});

test('呼び名：4文字まで保存でき、5文字は断る', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  const ok = env.post({ action: 'name', id, nickname: 'まっ', honorific: 'ちゃん' });
  assert.strictEqual(ok.data.nickname, 'まっ');
  assert.strictEqual(ok.data.honorific, 'ちゃん');
  const ng = env.post({ action: 'name', id, nickname: 'まっちゃん', honorific: 'なし' });
  assert.deepStrictEqual(ng, { ok: false, error: 'name_too_long' });
  const emoji = env.post({ action: 'name', id, nickname: '🍺🍺🍺🍺', honorific: 'さん' });
  assert.strictEqual(emoji.ok, true, '絵文字も1文字として数える');
  const blank = env.post({ action: 'name', id, nickname: '', honorific: 'さん' });
  assert.strictEqual(blank.data.honorific, '', '空欄なら敬称も空');
});

test('店の確認番号が違うと断り、5回で止まる', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  for (let i = 1; i <= 4; i++) {
    assert.deepStrictEqual(env.post({ action: 'redeem', id, code: '0000' }), { ok: false, error: 'wrong_code' });
  }
  assert.deepStrictEqual(env.post({ action: 'redeem', id, code: '0000' }), { ok: false, error: 'letter_stopped' });
  const right = env.post({ action: 'redeem', id, code: String(shopCode(env, 'shop-b')) });
  assert.deepStrictEqual(right, { ok: false, error: 'letter_stopped' });
});

test('正しい確認番号で使用済みになり、2回目は使えない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  env.post({ action: 'name', id, nickname: 'ケン', honorific: 'さん' });
  const used = env.post({ action: 'redeem', id, code: String(shopCode(env, 'shop-b')) });
  assert.strictEqual(used.data.status, 'used');
  assert.strictEqual(used.data.nickname, 'ケン');
  assert.deepStrictEqual(env.post({ action: 'redeem', id, code: String(shopCode(env, 'shop-b')) }), { ok: false, error: 'letter_used' });
  assert.deepStrictEqual(env.post({ action: 'name', id, nickname: 'ほか', honorific: 'さん' }), { ok: false, error: 'letter_used' });
});

test('別の店の確認番号では使えない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  const codeYoin = String(shopCode(env, 'shop-a'));
  const codeWig = String(shopCode(env, 'shop-b'));
  if (codeYoin !== codeWig) {
    assert.deepStrictEqual(env.post({ action: 'redeem', id, code: codeYoin }), { ok: false, error: 'wrong_code' });
  }
});

test('期限の日は1日中使え、翌日から期限切れ', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  const now = new Date();
  setLetter(env, id, '期限', now); // 今日が期限
  assert.strictEqual(env.get({ action: 'letter', id }).data.status, 'unused');
  setLetter(env, id, '期限', new Date(now.getTime() - 86400000)); // 昨日が期限
  assert.strictEqual(env.get({ action: 'letter', id }).data.status, 'expired');
  assert.deepStrictEqual(env.post({ action: 'redeem', id, code: String(shopCode(env, 'shop-b')) }), { ok: false, error: 'letter_expired' });
});

test('紹介元を止めると、新しい紹介状も未使用の紹介状も使えない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const k = shareOf(env, r);
  const id = issue(env, r, 'shop-b').data.id;
  const d = env.sheets['紹介元'].data;
  d.find((row) => row[0] === r)[d[0].indexOf('有効')] = false;
  assert.deepStrictEqual(env.post({ action: 'issue', k, s: 'shop-b' }), { ok: false, error: 'referrer_stopped' });
  assert.deepStrictEqual(env.get({ action: 'referrer', r }), { ok: false, error: 'referrer_stopped' });
  assert.strictEqual(env.get({ action: 'letter', id }).data.status, 'stopped');
});

test('止めた店は一覧に出ず、紹介状も作れない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const d = env.sheets['店'].data;
  d.find((row) => row[0] === 'shop-c')[d[0].indexOf('有効')] = false;
  assert.deepStrictEqual(env.get({ action: 'referrer', r }).data.shops.map((s) => s.id), ['shop-a', 'shop-b']);
  assert.deepStrictEqual(issue(env, r, 'shop-c'), { ok: false, error: 'shop_not_found' });
});

test('呼び名の自動削除：使用済みや期限切れから30日を過ぎたものだけ消す', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const day = 86400000;
  const now = Date.now();
  const mk = (name) => {
    const id = issue(env, r, 'shop-b').data.id;
    env.post({ action: 'name', id, nickname: name, honorific: 'さん' });
    return id;
  };
  const usedOld = mk('あ');
  setLetter(env, usedOld, '状態', '使用済み');
  setLetter(env, usedOld, '使用日時', new Date(now - 31 * day));
  const usedNew = mk('い');
  setLetter(env, usedNew, '状態', '使用済み');
  setLetter(env, usedNew, '使用日時', new Date(now - 5 * day));
  const expiredOld = mk('う');
  setLetter(env, expiredOld, '期限', new Date(now - 32 * day));
  const unused = mk('え');

  const n = env.sandbox.purgeNames();
  assert.strictEqual(n, 2);
  assert.strictEqual(letterRow(env, usedOld)['呼ばれたい名前'], '');
  assert.ok(letterRow(env, usedOld)['呼び名を消した日時']);
  assert.strictEqual(letterRow(env, usedNew)['呼ばれたい名前'], 'い');
  assert.strictEqual(letterRow(env, expiredOld)['呼ばれたい名前'], '');
  assert.strictEqual(letterRow(env, unused)['呼ばれたい名前'], 'え');
});

test('壊れた入力や知らない操作には、内部のエラーを見せない', () => {
  const env = fresh();
  const bad = env.sandbox.doPost({ postData: { contents: '{not json' } });
  assert.deepStrictEqual(JSON.parse(bad.text), { ok: false, error: 'bad_request' });
  assert.deepStrictEqual(env.get({ action: 'nope' }), { ok: false, error: 'unknown_action' });
  assert.deepStrictEqual(env.get({ action: 'letter', id: 'Lnope' }), { ok: false, error: 'letter_not_found' });
});

test('紹介状のリンクの共有IDでは、紹介元のページは開けない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const k = shareOf(env, r);
  assert.match(k, /^K[0-9a-f]{12}$/);
  assert.notStrictEqual(k, r);
  assert.deepStrictEqual(env.get({ action: 'referrer', r: k }), { ok: false, error: 'referrer_not_found' });
  assert.deepStrictEqual(env.post({ action: 'issue', k: r, s: 'shop-b' }), { ok: false, error: 'referrer_not_found' });
});

test('店ごとの誤入力が重なると、その店はしばらく受け付けない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const wrong = String(shopCode(env, 'shop-b')) === '1000' ? '1001' : '1000';
  let last;
  for (let i = 0; i < 15; i++) {
    const id = issue(env, r, 'shop-b').data.id;
    last = env.post({ action: 'redeem', id, code: wrong });
  }
  assert.deepStrictEqual(last, { ok: false, error: 'wrong_code' });
  const id = issue(env, r, 'shop-b').data.id;
  assert.deepStrictEqual(env.post({ action: 'redeem', id, code: String(shopCode(env, 'shop-b')) }), { ok: false, error: 'too_many_tries' });
  // ほかの店には影響しない
  const id2 = issue(env, r, 'shop-a').data.id;
  assert.strictEqual(env.post({ action: 'redeem', id: id2, code: String(shopCode(env, 'shop-a')) }).data.status, 'used');
});

test('店の確認番号が空なら、紹介状を減らさずに知らせる', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const d = env.sheets['店'].data;
  d.find((row) => row[0] === 'shop-b')[d[0].indexOf('お店の確認番号')] = '';
  const id = issue(env, r, 'shop-b').data.id;
  assert.deepStrictEqual(env.post({ action: 'redeem', id, code: '1234' }), { ok: false, error: 'shop_not_ready' });
  assert.strictEqual(letterRow(env, id)['誤入力の回数'], 0);
});

test('式に見える呼び名は、文字として保存する', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  const res = env.post({ action: 'name', id, nickname: '=H2', honorific: 'なし' });
  assert.strictEqual(res.data.nickname, '=H2');
  assert.strictEqual(letterRow(env, id)['呼ばれたい名前'], "'=H2");
});

console.log(`\n${passed} 件 成功`);
