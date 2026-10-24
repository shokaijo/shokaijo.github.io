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


st = state()
ref, codes = st["refId"], st["codes"]
errors = []
checks = []


def check(name, cond):
    checks.append((name, bool(cond)))


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ja-JP")
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1. 紹介元の画面
    page.goto(f"{BASE}/?r={ref}")
    page.wait_for_selector("#app:not(.hidden)")
    check("紹介元の呼び名が出る", "紹介元Aの紹介用ページ" in page.inner_text("h1"))
    check("店が3つ並ぶ", page.locator(".shop").count() == 3)
    check("説明は最初は閉じている", page.locator("details.about li").first.is_hidden())
    page.click("details.about summary")
    check("タップで説明が開く", page.locator("details.about li").first.is_visible())
    page.click("details.about summary")
    page.screenshot(path=str(out / "1_referrer.png"), full_page=True)

    page.locator(".shop", has_text="見本の店B").click()
    page.wait_for_selector("#send:not(.hidden)")
    line = page.get_attribute("#line", "href")
    text = urllib.parse.unquote(line.split("text=", 1)[1])
    check("LINEの文面に紹介元と店名", "紹介元Aから、見本の店Bへの紹介状です。" in text)
    check("LINEの文面に有効日数", "30日間有効" in text)
    letter_link = text.strip().splitlines()[-1]
    check("送るリンクは共有IDと店入り", "k=K" in letter_link and "s=shop-b" in letter_link)
    check("送るリンクに紹介元のIDは入らない", ref not in letter_link)
    check("送るリンクはふつうのブラウザで開く印つき", "openExternalBrowser=1" in letter_link)
    page.click("#show-qr")
    page.wait_for_selector("#qr svg")
    page.screenshot(path=str(out / "2_referrer_qr.png"), full_page=True)

    # 2. 受け取った人の画面
    page.goto(letter_link)
    page.wait_for_selector("#app:not(.hidden)")
    check("URLが紹介状IDに置き換わる", "id=L" in page.url)
    letter_id = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)["id"][0]
    check("紹介元が出る", page.inner_text("#from") == "紹介元A")
    check("行き先が出る", "見本の店B" in page.inner_text("#to"))
    check("期限が日付で出る", "年" in page.inner_text("#expires"))
    page.screenshot(path=str(out / "3_letter.png"), full_page=True)

    # 同じ端末で元のリンクを開き直しても、2枚目はできない
    page.goto(letter_link)
    page.wait_for_selector("#app:not(.hidden)")
    letters = [r for r in state()["letters"][1:] if r[0]]
    check("開き直しても紹介状は1枚のまま", len(letters) == 1 and letters[0][0] == letter_id)

    # 呼び名：5文字は保存できない、4文字以内は保存できる
    page.fill("#nick", "まっちゃんだ")
    check("5文字以上でボタンが押せない", page.is_disabled("#save"))
    check("5文字以上でエラーが出る", "4文字まで" in page.inner_text("#name-err"))
    page.fill("#nick", "まっ")
    page.locator("label.chip", has_text="ちゃん").click()
    check("呼び名の見本", "まっちゃん" in page.inner_text("#preview"))
    page.click("#save")
    page.wait_for_function("document.querySelector('#save').textContent.includes('変える')")
    row = [r for r in state()["letters"][1:] if r[0] == letter_id][0]
    check("呼び名が記録に残る", row[7] == "まっ" and row[8] == "ちゃん")
    page.screenshot(path=str(out / "4_letter_named.png"), full_page=True)

    # お店のシールから開く：ほかの店のシールでは、この紹介状は見つからない
    page.goto(f"{BASE}/visit.html?s=shop-c")
    page.wait_for_selector("#none:not(.hidden)")
    check("ほかの店のシールでは見つからない案内", "見つかりませんでした" in page.inner_text("#none"))
    check("ほかの店への紹介状があることを伝える", page.locator("#other").is_visible())

    # 行き先の店のシールから開くと、紹介状が開き「行ってきました」へ進む
    page.goto(f"{BASE}/visit.html?s=shop-b")
    page.wait_for_url("**/letter.html?id=*")
    page.wait_for_selector("#app:not(.hidden)")
    check("シールから同じ紹介状が開く", f"id={letter_id}" in page.url and "at=shop-b" in page.url)
    check("言葉の選択肢は3つ", page.locator('input[name="word"]').count() == 3)
    check("確認番号の欄はない", page.locator("#code").count() == 0)
    page.locator("label.chip", has_text="また行きたい").click()
    page.screenshot(path=str(out / "4b_visit.png"), full_page=True)
    page.click("#visit-btn")
    page.wait_for_selector("#used:not(.hidden)")
    check("使用済みで呼び名つきのあいさつ", page.inner_text("#used-name") == "まっちゃん" and "いらっしゃいませ" in page.inner_text("#used"))
    check("選んだ言葉が出る", "また行きたい" in page.inner_text("#used-words"))
    check("未使用の部品は隠れる", page.locator("#unused").is_hidden())
    row = [r for r in state()["letters"][1:] if r[0] == letter_id][0]
    check("記録に言葉と方法が残る", row[13] == "また行きたい" and row[14] == "シール")
    page.screenshot(path=str(out / "5_used.png"), full_page=True)

    # 使ったあとに元のリンクを開いても、使用済みのまま（2枚目を作らない）
    page.goto(letter_link)
    page.wait_for_selector("#app:not(.hidden)")
    letters = [r for r in state()["letters"][1:] if r[0]]
    check("使用後に開き直しても新しい紹介状はできない", len(letters) == 1)
    check("使用後に開き直すと使用済みの表示", page.locator("#used").is_visible())

    # 別の端末（別の人）が同じリンクを開くと、新しい紹介状ができる
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ja-JP", color_scheme="dark")
    p2 = ctx2.new_page()
    p2.on("pageerror", lambda e: errors.append(str(e)))
    p2.goto(letter_link)
    p2.wait_for_selector("#app:not(.hidden)")
    letters = [r for r in state()["letters"][1:] if r[0]]
    check("別の人が開くと2枚目ができる", len(letters) == 2)
    # 紹介状の画面から押す（シールなし）
    p2.click("#visit-btn")
    p2.wait_for_selector("#used:not(.hidden)")
    row = [r for r in state()["letters"][1:] if r[0] != letter_id and r[0]][0]
    check("画面から押すと、方法は紹介状の画面", row[14] == "紹介状の画面" and row[13] == "")
    p2.screenshot(path=str(out / "6_used_dark.png"), full_page=True)

    # 紹介状を一度も開いていないスマホでシールを読む
    ctx3 = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ja-JP")
    p3 = ctx3.new_page()
    p3.on("pageerror", lambda e: errors.append(str(e)))
    p3.goto(f"{BASE}/visit.html?s=shop-b")
    p3.wait_for_selector("#none:not(.hidden)")
    check("紹介状のないスマホには案内だけ", p3.locator("#other").is_hidden())
    p3.screenshot(path=str(out / "7_visit_none.png"), full_page=True)

    # 知らないリンク
    p2.goto(f"{BASE}/letter.html?id=Lnope")
    p2.wait_for_selector("#error:not(.hidden)")
    check("知らない紹介状はお知らせ", "見つかりませんでした" in p2.inner_text("#error-text"))

    # 横にはみ出さない
    for pg in (page, p2):
        w = pg.evaluate("document.documentElement.scrollWidth")
        check("横スクロールなし", w <= 390)

    browser.close()

ok = sum(1 for _, c in checks if c)
for name, c in checks:
    print(("ok   " if c else "FAIL ") + name)
print(f"\n{ok}/{len(checks)} 件 成功")
print("コンソールのエラー:", errors or "なし")
sys.exit(0 if ok == len(checks) and not errors else 1)
