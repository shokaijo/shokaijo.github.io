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
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
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
    check("店が3つ並ぶ", page.locator(".shop").count() == 3)
    check("説明は最初は閉じている", page.locator("details.about li").first.is_hidden())
    check("店を選ぶまで宛名の欄は出ない", page.locator("#to").is_hidden())
    page.locator(".shop", has_text="見本の店B").click()
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
    check("宛名が出る", page.inner_text("#addressee") == "まっちゃんへ")
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
    check("閉じていても要点の一行は見える", "店内のQRコードを読むと、お店のスタンプが押されます" in page.inner_text("#howto summary"))
    check("台紙がまだないうちは、台紙へのリンクを出さない", page.locator("#mycard-before").is_hidden())
    page.click("#howto summary")
    check("受け取った直後は「行ってきました」を出さない", page.locator("#visit-btn").is_hidden() and page.locator("#fallback-toggle").count() == 0)
    page.screenshot(path=str(out / "3b_letter_howto_open.png"), full_page=True)
    check("上のヘッダー表記はない", page.locator("#app .eyebrow").count() == 0)
    check("営業時間・定休日・期限は出さない", all(w not in page.inner_text(".letter") for w in ["営業時間", "定休日", "まで有効"]))
    check("フッターに小さく by banzai", "by banzai" in page.inner_text(".foot"))
    check("QRを読むと何が起きるかを説明", "あなた専用の「はしごパスポート」にたまっていきます。紹介元Aにも、行ってきたことが伝わります" in page.inner_text("#before"))
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
    check("台紙の案内が出る", page.locator("#card-box").is_visible())
    check("別のブラウザでは新しい台紙になる注釈", "新しいパスポートになります" in page.inner_text("#card-box"))
    card_href = page.get_attribute("#card-open", "href")
    check("台紙のリンクは長いIDつき", "card.html?c=C" in card_href and "openExternalBrowser=1" in card_href)
    card_id = urllib.parse.parse_qs(urllib.parse.urlparse(card_href).query)["c"][0]
    check("台紙をLINEで自分に送れる", card_id in urllib.parse.unquote(page.get_attribute("#card-line", "href")))
    check("押したあとは、これで完了と分かる", "これで完了です" in page.inner_text("#used") and "紹介元Aへ「行ってきました」をお知らせします" in page.inner_text("#used"))
    row = [r for r in letters() if r[0] == letter_id][0]
    check("記録に言葉と方法が残る", row[13] == "また行きたい" and row[14] == "シール")
    check("記録に台紙ID", row[15] == card_id)
    page.screenshot(path=str(out / "5_used.png"), full_page=True)

    # 4b. 同じスマホで2枚目：同じ台紙に押される
    page.goto(f"{BASE}/?r={ref}")
    page.wait_for_selector("#app:not(.hidden)")
    page.locator(".shop", has_text="見本の店A").click()
    page.fill("#nick", "まっ")
    page.click("#make")
    page.wait_for_selector("#send:not(.hidden)")
    link3 = line_text(page).strip().splitlines()[-1]
    page.goto(link3)
    page.wait_for_selector("#app:not(.hidden)")
    check("台紙があれば、受け取った画面に台紙へのリンク", page.locator("#mycard-before").is_visible())
    page.goto(f"{BASE}/visit.html?s=shop-a")
    page.wait_for_selector("#visit-card:not(.hidden)")
    page.locator("#words label.chip", has_text="ありがとう").click()
    page.locator("#words label.chip", has_text="楽しかった").click()
    page.click("#visit-btn")
    page.wait_for_selector("#used:not(.hidden)")
    check("2枚目も同じ台紙", card_id in page.get_attribute("#card-open", "href"))
    page.click("#card-open")
    page.wait_for_selector("#app:not(.hidden)")
    check("台紙にスタンプが2つ", page.locator(".stamp-cell:not(.empty)").count() == 2 and "スタンプ 2個" in page.inner_text("#count"))
    check("台紙は古い順", page.locator(".stamp-cell:not(.empty) .hanko-shop").all_inner_texts() == ["見本の店B", "見本の店A"])
    check("スタンプに誰の紹介か", "紹介元Aの紹介" in page.inner_text(".stamp-cell >> nth=0"))
    check("言葉はアイコンで出る", page.locator(".stamp-cell >> nth=1").locator("svg.icon").count() == 2)
    check("空いた枠も並ぶ", page.locator(".stamp-cell.empty").count() == 4)
    check("台紙に宛名は出ない", "まっ" not in page.inner_text("#app"))
    page.screenshot(path=str(out / "8_card.png"), full_page=True)
    page.click("#keep summary")
    check("台紙のページにも注釈", "先にこのパスポートのリンクを開いてから" in page.inner_text("#keep"))
    page.screenshot(path=str(out / "8b_card_keep.png"), full_page=True)

    # 5. 2枚目：別の人あて。シールなしで紹介状の画面から押す（暗い表示）
    page.goto(f"{BASE}/?r={ref}")
    page.wait_for_selector("#app:not(.hidden)")
    page.locator(".shop", has_text="見本の店C").click()
    page.fill("#nick", "ケン")
    page.click("#make")
    page.wait_for_selector("#send:not(.hidden)")
    link2 = line_text(page).strip().splitlines()[-1]
    p2 = new_ctx(browser, color_scheme="dark")
    p2.goto(link2)
    p2.wait_for_selector("#app:not(.hidden)")
    check("2枚目の宛名", p2.inner_text("#addressee") == "ケンさんへ")
    p2.screenshot(path=str(out / "6_letter_dark.png"), full_page=True)
    p2.goto(f"{BASE}/visit.html?s=shop-c")
    p2.wait_for_url("**/letter.html?id=*")
    p2.wait_for_selector("#visit-card:not(.hidden)")
    p2.click("#visit-btn")
    p2.wait_for_selector("#used:not(.hidden)")
    row2 = [r for r in letters() if r[4] == "見本の店C"][0]
    check("言葉を選ばずに押せる", row2[14] == "シール" and row2[13] == "")
    check("別のスマホでは別の台紙", row2[15] and row2[15] != card_id)

    # 6. 転送されたリンクを別のスマホで開いても、使用済みの同じ1枚
    p3 = new_ctx(browser)
    p3.goto(link)
    p3.wait_for_selector("#app:not(.hidden)")
    check("転送されても新しい紹介状はできない", len(letters()) == 3)
    check("転送先では使用済みとして出る", p3.locator("#used").is_visible())
    check("転送先には台紙の案内を出さない", p3.locator("#card-box").is_hidden())

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
    p4.goto(f"{BASE}/card.html?c=Cbad")
    p4.wait_for_selector("#error:not(.hidden)")
    check("知らない台紙はお知らせ", "パスポートは見つかりませんでした" in p4.inner_text("#error-text"))

    for pg in (page, p2, p3, p4):
        check("横スクロールなし", pg.evaluate("document.documentElement.scrollWidth") <= 390)

    browser.close()

ok = sum(1 for _, c in checks if c)
for name, c in checks:
    print(("ok   " if c else "FAIL ") + name)
print(f"\n{ok}/{len(checks)} 件 成功")
print("コンソールのエラー:", errors or "なし")
sys.exit(0 if ok == len(checks) and not errors else 1)
