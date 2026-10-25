"""画面の通し確認。dev-server を立ち上げた状態で実行する。
python3 test/e2e.py <出力フォルダ>
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8787"
out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
out.mkdir(parents=True, exist_ok=True)


def state():
    with urllib.request.urlopen(BASE + "/__state") as r:
        return json.load(r)


def letters():
    return [r for r in state()["letters"][1:] if r and r[0]]


st = state()
ref = st["refId"]
errors = []
checks = []


def check(name, cond):
    checks.append((name, bool(cond)))


def new_ctx(browser, **kw):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ja-JP", **kw)
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type == "error" and "ERR_FAILED" not in m.text and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append(str(e)))
    return pg


def line_text(page):
    href = page.get_attribute("#line", "href")
    return urllib.parse.unquote(href.split("text=", 1)[1])


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = new_ctx(browser)

    # 1. 紹介元の画面：店を選び、宛名を入れて紹介状をつくる
    page.goto(f"{BASE}/?r={ref}")
    page.wait_for_selector("#app:not(.hidden)")
    check("紹介元の呼び名が出る", "紹介元Aの紹介用ページ" in page.inner_text("h1"))
    check("店が3つある", page.locator(".shop").count() == 3)
    check("店の一覧は最初は閉じている", page.locator("#shop-sheet").is_hidden())
    page.click("#shop-pick")
    page.wait_for_selector("#shop-sheet[open]")
    page.fill("#shop-filter", "店C")
    check("店名で絞り込める", page.locator("#shops .shop:not(.hidden)").count() == 1)
    page.fill("#shop-filter", "")
    page.screenshot(path=str(out / "0_sheet.png"), full_page=False)
    page.go_back()
    page.wait_for_timeout(300)
    check("戻る操作ではドロワーが閉じるだけ", page.locator("#shop-sheet").is_hidden() and f"r={ref}" in page.url)
    page.click("#shop-pick")
    page.wait_for_selector("#shop-sheet[open]")
    check("説明は最初は閉じている", page.locator("details.about li").first.is_hidden())
    check("店を選ぶまで宛名の欄は出ない", page.locator("#to").is_hidden())
    page.locator(".shop", has_text="見本の店B").click()
    check("選ぶとドロワーが閉じて、選んだ店が出る", page.locator("#shop-sheet").is_hidden() and "見本の店B" in page.inner_text("#shop-pick"))
    page.wait_for_selector("#to:not(.hidden)")
    check("宛名が空だと、つくれない", page.is_disabled("#make"))
    page.fill("#nick", "あいうえおかきくけ")
    check("9文字ではつくれない", page.is_disabled("#make") and "8文字まで" in page.inner_text("#name-err"))
    page.fill("#nick", "まっ")
    page.locator("#hons label.chip", has_text="ちゃん").click()
    check("宛名の見本", "まっちゃんへ" in page.inner_text("#preview"))
    page.screenshot(path=str(out / "1_referrer.png"), full_page=True)
    page.click("#make")
    page.wait_for_selector("#send:not(.hidden)")
    check("つくったあとは、もう一度は押せない", page.is_disabled("#make"))
    text = line_text(page)
    check("LINEの文面は宛名から始まる", text.startswith("まっちゃんへ"))
    check("LINEの文面に店名", "見本の店Bへの紹介状です" in text)
    link = text.strip().splitlines()[-1]
    check("送るリンクは紹介状IDつき", "letter.html?id=L" in link)
    check("送るリンクはふつうのブラウザで開く印つき", "openExternalBrowser=1" in link)
    check("送るリンクに紹介元のIDは入らない", ref not in link)
    check("紹介状は送る時点で1枚できている", len(letters()) == 1)
    letter_id = urllib.parse.parse_qs(urllib.parse.urlparse(link).query)["id"][0]
    row = letters()[0]
    check("記録に宛名と敬称", row[7] == "まっ" and row[8] == "ちゃん")
    page.click("#show-qr")
    page.wait_for_selector("#qr svg")
    page.screenshot(path=str(out / "2_referrer_sent.png"), full_page=True)
    page.click("#again")
    check("別の人にも送る：宛名が空に戻る", page.input_value("#nick") == "" and page.locator("#send").is_hidden())

    # 2. 受け取った直後：読むだけ
    page.goto(link)
    page.wait_for_selector("#app:not(.hidden)")
    check("宛名が出る", page.inner_text("#addressee") == "まっちゃん")
    check("紹介元が出る", page.inner_text("#from") == "紹介元A")
    check("行き先が出る", page.inner_text("#shop-name") == "見本の店B")
    check("受け取った人の入力欄はない", page.locator("#nick").count() == 0)
    check("受け取った直後は「お店で」の案内", page.locator("#before").is_visible() and page.locator("#visit-card").is_hidden())
    check("「行ってきました」はたたんである", page.locator("#visit-btn").is_hidden())
    before = page.inner_text("#before")
    check("入るときの一言は、本体の中に出す", page.locator(".letter #enter-tip").is_visible() and "一目で紹介元Aからの紹介だとわかります" in page.inner_text(".letter"))
    check("LINEで自分に送るボタンはない", "LINEで自分に送っておく" not in page.inner_text("#app"))
    check("画面に「シール」「お店を出たあと」は出ない", "シール" not in page.inner_text("#app") and "出たあと" not in page.inner_text("#app"))
    check("お会計のときは最初は閉じている", page.locator("#howto .howto-body").is_hidden())
    check("閉じていても要点の一行は見える", "店内のQRコードを読むと、来店スタンプが押されます" in page.inner_text("#howto summary"))
    check("パスポートがなくても入り口は出る", page.locator("#mycard-before").is_visible() and "まだスタンプはありません" in page.inner_text("#mycard-before"))
    page.click("#mycard-before")
    page.wait_for_selector("#app:not(.hidden)")
    check("白紙のパスポートが開く", page.locator(".stamp-cell.empty").count() == 6 and "最初のスタンプが押されます" in page.inner_text("#empty-note") and page.locator("#keep").is_hidden())
    page.screenshot(path=str(out / "3c_blank_pass.png"), full_page=True)
    page.go_back()
    page.wait_for_selector("#app:not(.hidden)")
    page.click("#howto summary")
    check("受け取った直後は「行ってきました」を出さない", page.locator("#visit-btn").is_hidden() and page.locator("#fallback-toggle").count() == 0)
    page.screenshot(path=str(out / "3b_letter_howto_open.png"), full_page=True)
    check("上のヘッダー表記はない", page.locator("#app .eyebrow").count() == 0)
    check("営業時間・定休日・期限は出さない", all(w not in page.inner_text(".letter") for w in ["営業時間", "定休日", "まで有効"]))
    check("フッターに小さく by banzai", "by banzai" in page.inner_text(".foot"))
    check("QRを読むと何が起きるかを説明", "あなた専用の「吉祥寺はしごパスポート」にたまっていきます。" in page.inner_text("#before") and "伝わります" not in page.inner_text("#before"))
    check("「お礼」という言葉は使わない", "お礼" not in page.inner_text("#before"))
    check("地図へのリンクは出る", page.locator("#map").is_visible())
    page.goto(link)
    page.wait_for_selector("#app:not(.hidden)")
    page.screenshot(path=str(out / "3_letter_before.png"), full_page=True)
    check("開き直しても紹介状は増えない", len(letters()) == 1)

    # 3. ほかの店のシールでは見つからない
    page.goto(f"{BASE}/visit.html?s=shop-c")
    page.wait_for_selector("#none:not(.hidden)")
    check("ほかの店のシールでは見つからない案内", "見つかりませんでした" in page.inner_text("#none"))
    check("ほかの店への紹介状があることを伝える", page.locator("#other").is_visible())

    # 4. 帰り際：行き先の店のシールから開く
    page.goto(f"{BASE}/visit.html?s=shop-b")
    page.wait_for_url("**/letter.html?id=*")
    page.wait_for_selector("#app:not(.hidden)")
    check("シールから同じ紹介状が開く", f"id={letter_id}" in page.url and "at=shop-b" in page.url)
    check("帰り際の問いかけ", page.inner_text("#visit-title") == "まっちゃん、楽しんでいただけましたか")
    check("帰り際は受け取り直後の案内を出さない", page.locator("#before").is_hidden())
    check("帰り際は地図を出さない", page.locator("#facts").is_hidden())
    check("帰り際は入るときの一言を出さない", page.locator("#enter-tip").is_hidden())
    check("言葉の選択肢は3つ", page.locator('input[name="word"]').count() == 3)
    page.locator("#words label.chip", has_text="また行きたい").click()
    page.screenshot(path=str(out / "4_visit.png"), full_page=True)
    page.click("#visit-btn")
    page.wait_for_selector("#used:not(.hidden)")
    check("押したあとはお礼", page.inner_text("#used-name") == "まっちゃん、ありがとうございました")
    check("「いらっしゃいませ」は出ない", "いらっしゃいませ" not in page.inner_text("#app"))
    check("選んだ言葉が出る（アイコンつき）", "また行きたい" in page.inner_text("#used-words") and page.locator("#used-words svg").count() == 1)
    check("押されたスタンプに店名", "見本の店B" in page.inner_text("#used-stamp .hanko"))
    check("押したあとに発行の欄が出る", page.locator("#card-box .issue").is_visible() and "発行しませんか" in page.inner_text("#card-box") and "来店スタンプを押しました" in page.inner_text("#card-box"))
    check("所持人の名前は宛名が初期値", page.input_value("#pass-name") == "まっ")
    check("押したあとに「完了」の文は出さない", "これで完了です" not in page.inner_text("#used") and "お知らせします" not in page.inner_text("#used"))
    check("行ってきた日時と書く", "行ってきた日時" in page.inner_text("#used"))
    row = [r for r in letters() if r[0] == letter_id][0]
    check("記録に言葉と方法が残る", row[13] == "また行きたい" and row[14] == "シール")
    pub = row[15]
    check("記録には公開IDだけ", pub.startswith("P") and len(pub) == 25)
    key = page.evaluate("localStorage.getItem('shokaijo:key')")
    check("鍵はこのスマホだけにあり、シートにない", key and key.startswith("K") and key not in json.dumps(state()))
    page.screenshot(path=str(out / "5_used.png"), full_page=True)
    # 発行する前に開き直しても、発行の欄に戻れる（指摘3）
    page.reload()
    page.wait_for_selector("#card-box .issue")
    check("開き直しても発行の欄が出る", page.locator("#card-box .issue").is_visible())
    page.fill("#pass-name", "まつもと")
    page.click("#pass-issue")
    page.wait_for_selector("#card-box .keepbox")
    check("発行したら、とっておく案内", "このリンクが、あなたのパスポートです" in page.inner_text("#card-box") and "なくしたら再発行" in page.inner_text("#card-box"))
    keep_href = urllib.parse.unquote(page.get_attribute("#card-box .keep-line", "href"))
    check("自分用だと分かる文で送る", "（自分用メモ）" in keep_href and pub in keep_href and key not in keep_href)
    check("小さな表紙に所持人", "まつもと・スタンプ" in page.inner_text("#card-box .pass-mini"))
    page.screenshot(path=str(out / "5b_issued.png"), full_page=True)
    page.reload()
    page.wait_for_selector("#card-box .pass-mini")
    check("発行後に開き直しても表紙が出る", "まつもと・スタンプ" in page.inner_text("#card-box"))

    # 4b. 同じスマホで2枚目：同じパスポートに押される。通信が切れても二重にならない（指摘2）
    page.goto(f"{BASE}/?r={ref}")
    page.wait_for_selector("#app:not(.hidden)")
    page.click("#shop-pick")
    page.locator(".shop", has_text="見本の店A").click()
    page.fill("#nick", "まっ")
    page.click("#make")
    page.wait_for_selector("#send:not(.hidden)")
    check("つくったあとはボタンの文言が変わる", "つくりました" in page.inner_text("#make"))
    link3 = line_text(page).strip().splitlines()[-1]
    page.goto(link3)
    page.wait_for_selector("#app:not(.hidden)")
    page.wait_for_function("document.querySelector('#mycard-before').textContent.includes('スタンプ 1個')")
    check("小さな表紙に所持人とスタンプの数", "まつもと・スタンプ 1個" in page.inner_text("#mycard-before"))
    page.screenshot(path=str(out / "4c_letter_with_pass.png"), full_page=True)
    page.goto(f"{BASE}/visit.html?s=shop-a")
    page.wait_for_selector("#visit-card:not(.hidden)")
    page.locator("#words label.chip", has_text="ありがとう").click()
    page.locator("#words label.chip", has_text="楽しかった").click()
    cut = {"n": 0}
    def drop_once(route):
        if route.request.method == "POST" and '"visit"' in (route.request.post_data or "") and cut["n"] == 0:
            cut["n"] = 1
            route.fetch()          # サーバーは記録する
            return route.abort()   # 応答だけ届かない
        route.continue_()
    page.route("**/api", drop_once)
    page.click("#visit-btn")
    page.wait_for_function("document.querySelector('#visit-err').textContent.length > 0")
    check("通信が切れたら、そう伝える", "通信できませんでした" in page.inner_text("#visit-err"))
    page.click("#visit-btn")
    page.wait_for_selector("#used:not(.hidden)")
    page.unroute("**/api")
    check("押し直すと、1回目と同じ結果", page.locator("#used-mine").is_visible() and "まつもと・スタンプ" in page.inner_text("#card-box"))
    page.click("#card-box .pass-mini")
    page.wait_for_selector("#app:not(.hidden)")
    check("パスポートにスタンプが2つ（二重にならない）", page.locator(".stamp-cell:not(.empty)").count() == 2 and "スタンプ 2個" in page.inner_text("#count"))
    check("表紙に名前（NAME）", page.inner_text("#holder-name") == "まつもと" and "NAME" in page.inner_text("#holder"))
    check("パスポートの表紙が出る", "KICHIJOJI HASHIGO PASSPORT" in page.inner_text(".pass-cover"))
    check("古い順", page.locator(".stamp-cell:not(.empty) .hanko-shop").all_inner_texts() == ["見本の店B", "見本の店A"])
    check("スタンプに誰の紹介か", "紹介元Aの紹介" in page.inner_text(".stamp-cell >> nth=0"))
    check("言葉はアイコンで出る", page.locator(".stamp-cell >> nth=1").locator("svg.icon").count() == 2)
    check("自分のものなら「見るだけ」は出ない", page.locator("#view-only").is_hidden() and page.locator("#keep").is_visible())
    check("パスポートに宛名は出ない", "まっちゃん" not in page.inner_text("#app"))
    pass_url = page.url
    check("URLは公開ID", f"c={pub}" in pass_url)
    page.screenshot(path=str(out / "8_card.png"), full_page=True)
    page.click("#keep summary")
    page.screenshot(path=str(out / "8c_keep_rename_closed.png"), full_page=True)
    check("ニックネームを変える欄は最初は閉じている", page.locator("#rename-box").is_hidden())
    page.click(".rename summary")
    page.screenshot(path=str(out / "8d_keep_rename_open.png"), full_page=True)
    page.fill("#pass-name", "まっちゃん")
    page.click("#pass-issue")
    page.wait_for_function("document.querySelector('#holder-name').textContent === 'まっちゃん'")
    check("自分のパスポートでは名前を変えられる", page.inner_text("#holder-name") == "まっちゃん")
    page.screenshot(path=str(out / "8b_card_keep.png"), full_page=True)

    # 5. 2枚目：別の人あて。シールなしで紹介状の画面から押す（暗い表示）
    page.goto(f"{BASE}/?r={ref}")
    page.wait_for_selector("#app:not(.hidden)")
    page.click("#shop-pick")
    page.locator(".shop", has_text="見本の店C").click()
    page.fill("#nick", "ケン")
    page.click("#make")
    page.wait_for_selector("#send:not(.hidden)")
    link2 = line_text(page).strip().splitlines()[-1]
    p2 = new_ctx(browser, color_scheme="dark")
    p2.goto(link2)
    p2.wait_for_selector("#app:not(.hidden)")
    check("2枚目の宛名", p2.inner_text("#addressee") == "ケンさん")
    p2.screenshot(path=str(out / "6_letter_dark.png"), full_page=True)
    p2.goto(f"{BASE}/visit.html?s=shop-c")
    p2.wait_for_url("**/letter.html?id=*")
    p2.wait_for_selector("#visit-card:not(.hidden)")
    p2.click("#visit-btn")
    p2.wait_for_selector("#used:not(.hidden)")
    row2 = [r for r in letters() if r[4] == "見本の店C"][0]
    check("言葉を選ばずに押せる", row2[14] == "シール" and row2[13] == "")
    check("別のスマホでは別のパスポート", row2[15] and row2[15] != pub)
    check("別のスマホでも、押したあとは発行の欄", p2.locator("#card-box .issue").is_visible())

    # 5b. 他人がパスポートのリンクを開く：見るだけ。自分のパスポートは変わらない（指摘1）
    p2.goto(pass_url)
    p2.wait_for_selector("#app:not(.hidden)")
    check("他人には「見るだけ」", p2.locator("#view-only").is_visible() and p2.locator("#keep").is_hidden() and p2.locator("#issue-box").is_hidden())
    check("他人にも名前は見える", p2.inner_text("#holder-name") == "まっちゃん")
    check("他人には名前を変える欄がない", p2.locator(".rename").count() == 0)
    p2.screenshot(path=str(out / "9_view_only_dark.png"), full_page=True)
    p2_key = p2.evaluate("localStorage.getItem('shokaijo:key')")
    check("他人の鍵は書き換わらない", p2_key and p2_key != key)
    p2.goto(f"{BASE}/card.html")
    p2.wait_for_selector("#app:not(.hidden)")
    check("他人の自分のパスポートは未発行のまま、発行できる", p2.locator("#issue-box .issue").is_visible() and p2.locator(".stamp-cell:not(.empty)").count() == 1)

    # 6. 転送されたリンクを別のスマホで開いても、使用済みの同じ1枚
    p3 = new_ctx(browser)
    p3.goto(link)
    p3.wait_for_selector("#app:not(.hidden)")
    check("転送されても新しい紹介状はできない", len(letters()) == 3)
    check("転送先では使用済みとして出る", p3.locator("#used").is_visible())
    check("転送先には、使用済みとだけ出す", p3.locator("#used-other").is_visible() and p3.locator("#used-mine").is_hidden())
    check("転送先にはパスポートの案内を出さない", p3.locator("#card-box").is_hidden())

    # 7. 紹介状を開いていないスマホでシールを読む
    p4 = new_ctx(browser)
    p4.goto(f"{BASE}/visit.html?s=shop-b")
    p4.wait_for_selector("#none:not(.hidden)")
    check("紹介状のないスマホには案内だけ", p4.locator("#other").is_hidden())
    check("見つからないときは、直接伝えてもらう案内", "直接伝えてください" in p4.inner_text("#none"))
    p4.screenshot(path=str(out / "7_visit_none.png"), full_page=True)

    # 8. 知らないリンク・古い形のリンク
    p4.goto(f"{BASE}/letter.html?id=Lnope")
    p4.wait_for_selector("#error:not(.hidden)")
    check("知らない紹介状はお知らせ", "見つかりませんでした" in p4.inner_text("#error-text"))
    p4.goto(f"{BASE}/letter.html?k=Kold&s=shop-b")
    p4.wait_for_selector("#error:not(.hidden)")
    check("古い形のリンクは紹介状をつくらない", len(letters()) == 3)
    check("古い形のリンクには送り直しの案内", "新しい紹介状" in p4.inner_text("#error-text"))
    p4.goto(f"{BASE}/card.html?c=Pbad")
    p4.wait_for_selector("#error:not(.hidden)")
    check("知らないパスポートはお知らせ", "パスポートは見つかりませんでした" in p4.inner_text("#error-text"))

    for pg in (page, p2, p3, p4):
        check("横スクロールなし", pg.evaluate("document.documentElement.scrollWidth") <= 390)

    browser.close()

ok = sum(1 for _, c in checks if c)
for name, c in checks:
    print(("ok   " if c else "FAIL ") + name)
print(f"\n{ok}/{len(checks)} 件 成功")
print("コンソールのエラー:", errors or "なし")
sys.exit(0 if ok == len(checks) and not errors else 1)
