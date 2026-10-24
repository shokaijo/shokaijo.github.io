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

function issue(env, r, s, nickname = 'まっ', honorific = 'ちゃん') {
  return env.post({ action: 'issue', r, s, nickname, honorific });
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

test('宛名：必須で、8文字まで。敬称を選べる', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  assert.deepStrictEqual(issue(env, r, 'shop-b', ''), { ok: false, error: 'name_required' });
  assert.deepStrictEqual(issue(env, r, 'shop-b', '   '), { ok: false, error: 'name_required' });
  assert.deepStrictEqual(issue(env, r, 'shop-b', 'あいうえおかきくけ'), { ok: false, error: 'name_too_long' });
  const ok = issue(env, r, 'shop-b', 'まっちゃんたち', 'なし');
  assert.strictEqual(ok.data.nickname, 'まっちゃんたち');
  assert.strictEqual(ok.data.honorific, 'なし');
  assert.strictEqual(issue(env, r, 'shop-b', 'ケン', 'へんな敬称').data.honorific, 'さん');
  assert.strictEqual(issue(env, r, 'shop-b', '🍺🍺🍺🍺🍺🍺🍺🍺').ok, true, '絵文字も1文字として数える');
});

test('宛名：式に見える値は文字として保存する', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const res = issue(env, r, 'shop-b', '=H2', 'なし');
  assert.strictEqual(res.data.nickname, '=H2');
  assert.strictEqual(letterRow(env, res.data.id)['宛名'], "'=H2");
});

test('紹介状は作るたびに別の1枚。受け取った人の操作では増えない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const a = issue(env, r, 'shop-b').data.id;
  const b = issue(env, r, 'shop-b', 'ケン', 'さん').data.id;
  assert.notStrictEqual(a, b);
  assert.deepStrictEqual(env.post({ action: 'name', id: a, nickname: 'x' }), { ok: false, error: 'unknown_action' });
  assert.strictEqual(env.sheets['紹介状'].data.length, 3);
});

test('紹介元の画面には、紹介状を作るための情報だけを返す', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const d = env.get({ action: 'referrer', r }).data;
  assert.strictEqual(d.nameMax, 8);
  assert.deepStrictEqual(d.honorifics, ['さん', 'ちゃん', 'くん', 'なし']);
  assert.ok(!('shareId' in d));
});

test('行ってきました：使用済みになり、2回目は押せない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b', 'ケン', 'さん').data.id;
  const res = env.post({ action: 'visit', id, at: 'shop-b', words: ['楽しかった', 'また行きたい'] });
  assert.strictEqual(res.data.status, 'used');
  assert.strictEqual(res.data.nickname, 'ケン');
  assert.deepStrictEqual(res.data.words, ['楽しかった', 'また行きたい']);
  const row = letterRow(env, id);
  assert.strictEqual(row['ひとこと'], '楽しかった、また行きたい');
  assert.strictEqual(row['記録の方法'], 'シール');
  assert.ok(row['使用日時']);
  assert.deepStrictEqual(env.post({ action: 'visit', id }), { ok: false, error: 'letter_used' });
});

test('行ってきました：言葉は選ばなくてもよく、用意した言葉以外は残さない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const a = issue(env, r, 'shop-b').data.id;
  assert.deepStrictEqual(env.post({ action: 'visit', id: a }).data.words, []);
  assert.strictEqual(letterRow(env, a)['記録の方法'], '紹介状の画面');
  const b = issue(env, r, 'shop-b').data.id;
  const res = env.post({ action: 'visit', id: b, words: ['最悪だった', 'ありがとう', 'ありがとう', '=H2'] });
  assert.deepStrictEqual(res.data.words, ['ありがとう']);
  assert.strictEqual(letterRow(env, b)['ひとこと'], 'ありがとう');
  assert.deepStrictEqual(res.data.wordChoices, ['ありがとう', '楽しかった', 'また行きたい']);
});

test('行ってきました：ほかの店のシールからは押せない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  assert.deepStrictEqual(env.post({ action: 'visit', id, at: 'shop-c' }), { ok: false, error: 'wrong_shop' });
  assert.strictEqual(env.get({ action: 'letter', id }).data.status, 'unused');
});

test('古い確認番号の操作は受け付けない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  assert.deepStrictEqual(env.post({ action: 'redeem', id, code: '1234' }), { ok: false, error: 'unknown_action' });
});

test('初期設定をやり直すと、増えた列の見出しが揃う', () => {
  const env = fresh();
  const head = env.sheets['紹介状'].data[0];
  assert.strictEqual(head[13], 'ひとこと');
  assert.strictEqual(head[14], '記録の方法');
  env.sheets['紹介状'].data[0] = head.slice(0, 13);
  env.sandbox.setup();
  assert.strictEqual(env.sheets['紹介状'].data[0][14], '記録の方法');
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
  assert.deepStrictEqual(env.post({ action: 'visit', id }), { ok: false, error: 'letter_expired' });
});

test('紹介元を止めると、新しい紹介状も未使用の紹介状も使えない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('紹介元A', '店').split('r=')[1];
  const id = issue(env, r, 'shop-b').data.id;
  const d = env.sheets['紹介元'].data;
  d.find((row) => row[0] === r)[d[0].indexOf('有効')] = false;
  assert.deepStrictEqual(issue(env, r, 'shop-b'), { ok: false, error: 'referrer_stopped' });
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
  const mk = (name) => issue(env, r, 'shop-b', name, 'さん').data.id;
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
  assert.strictEqual(letterRow(env, usedOld)['宛名'], '');
  assert.ok(letterRow(env, usedOld)['呼び名を消した日時']);
  assert.strictEqual(letterRow(env, usedNew)['宛名'], 'い');
  assert.strictEqual(letterRow(env, expiredOld)['宛名'], '');
  assert.strictEqual(letterRow(env, unused)['宛名'], 'え');
});

test('壊れた入力や知らない操作には、内部のエラーを見せない', () => {
  const env = fresh();
  const bad = env.sandbox.doPost({ postData: { contents: '{not json' } });
  assert.deepStrictEqual(JSON.parse(bad.text), { ok: false, error: 'bad_request' });
  assert.deepStrictEqual(env.get({ action: 'nope' }), { ok: false, error: 'unknown_action' });
  assert.deepStrictEqual(env.get({ action: 'letter', id: 'Lnope' }), { ok: false, error: 'letter_not_found' });
});

test('店の紹介元には、自分の店が一覧に出ず、紹介状も作れない', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('見本の店B', '店', 'shop-b').split('r=')[1];
  const res = env.get({ action: 'referrer', r });
  assert.deepStrictEqual(res.data.shops.map((s) => s.id), ['shop-a', 'shop-c']);
  assert.deepStrictEqual(issue(env, r, 'shop-b'), { ok: false, error: 'own_shop' });
  assert.strictEqual(issue(env, r, 'shop-c').ok, true);
});

test('自分の店IDが空の紹介元（常連）は、全部の店が出る', () => {
  const env = fresh();
  const r = env.sandbox.addReferrer('まっちゃん', '常連').split('r=')[1];
  assert.strictEqual(env.get({ action: 'referrer', r }).data.shops.length, 3);
});

console.log(`\n${passed} 件 成功`);
