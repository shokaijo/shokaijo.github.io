"""画面の通し確認。dev-server を立ち上げた状態で実行する。
python3 test/e2e.py <出力フォルダ>
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

import os
BASE = os.environ.get("BASE", "http://localhost:8787")
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


def new_ctx(browser, locale="ja-JP", **kw):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale=locale, **kw)
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
    check("フッターに by banzai は出さない", "banzai" not in page.inner_text(".foot") and "試験運用中" in page.inner_text(".foot"))
    check("試験運用中のご注意は、たたんで置く", page.locator("#notes").is_visible() and page.locator("#notes li").first.is_hidden())
    page.click("#notes summary")
    check("ご注意に、予告なく消すことと連絡先", "予告なく消すことがあります" in page.inner_text("#notes") and "貝瀬（かいせ）" in page.inner_text("#notes"))
    page.screenshot(path=str(out / "3e_notes.png"), full_page=True)
    page.click("#notes summary")
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
    check("ほかの店への紹介状があることを、店名つきで先に伝える", page.locator("#other-box").is_visible() and "見本の店B" in page.inner_text("#other-lead") and page.locator("#none-box").is_hidden())
    check("その紹介状を開ける", page.locator("#other-links a").count() == 1)
    page.screenshot(path=str(out / "3d_wrong_shop.png"), full_page=True)

    # 4. 帰り際：行き先の店のシールから開く
    page.goto(f"{BASE}/visit.html?s=shop-b")
    page.wait_for_url("**/letter.html?id=*")
    page.wait_for_selector("#app:not(.hidden)")
    check("シールから同じ紹介状が開く", f"id={letter_id}" in page.url and "at=shop-b" in page.url)
    check("帰り際の見出し", "来店記念にスタンプを押しましょう" in page.inner_text("#visit-card") and "あなた専用のパスポート" in page.inner_text("#visit-card"))
    check("帰り際は受け取り直後の案内を出さない", page.locator("#before").is_hidden())
    check("帰り際は地図を出さない", page.locator("#facts").is_hidden())
    check("帰り際は入るときの一言を出さない", page.locator("#enter-tip").is_hidden())
    check("押す前は言葉を選ばせない（ボタンは1つ）", page.locator("#visit-card input").count() == 0 and page.inner_text("#visit-btn") == "スタンプを押す")
    page.screenshot(path=str(out / "4_visit.png"), full_page=True)
    page.click("#visit-btn")
    page.wait_for_selector("#used:not(.hidden)")
    check("押したあとは、押したことを伝える", page.inner_text("#used-name").replace("\n", "") == "見本の店Bのスタンプを押しました")
    check("「いらっしゃいませ」は出ない", "いらっしゃいませ" not in page.inner_text("#app"))
    check("言葉の選択肢は3つ（押したあと）", page.locator('#words input[name="word"]').count() == 3)
    page.locator("#words label.chip", has_text="また行きたい").click()
    check("選ぶとすぐスタンプに出る", page.locator("#used-stamp .stamp-words svg").count() == 1 and page.locator("#used-stamp .stamp-words").is_visible())
    page.wait_for_function("document.getElementById('toast').textContent.includes('添えました')")
    check("押されたスタンプに店名", "見本の店B" in page.inner_text("#used-stamp .hanko"))
    check("押したあとに発行の欄が出る", page.locator("#card-box .issue").is_visible() and "発行しませんか" in page.inner_text("#card-box"))
    check("ニックネームの欄は空（宛名を流用しない）", page.input_value("#pass-name") == "" and page.is_disabled("#pass-issue"))
    check("押したあとに「完了」の文は出さない", "これで完了です" not in page.inner_text("#used") and "お知らせします" not in page.inner_text("#used"))
    check("押した日時と書く", "押した日時" in page.inner_text("#used"))
    row = [r for r in letters() if r[0] == letter_id][0]
    check("記録に言葉と方法が残る", row[13] == "また行きたい" and row[14] == "シール")
    pub = row[15]
    check("記録には公開IDだけ", pub.startswith("P") and len(pub) == 25)
    key = page.evaluate("localStorage.getItem('shokaijo:key')")
    check("鍵はこのスマホだけにあり、シートにない", key and key.startswith("K") and key not in json.dumps(state()))
    check("来店の問いは畳んで出る", page.locator("#ask").is_visible() and page.evaluate("!document.getElementById('ask').open") and "よかったら教えてください（任意）" in page.inner_text("#ask summary") and "紹介状の改善に役立てます" in page.inner_text("#ask summary"))
    page.screenshot(path=str(out / "5_used.png"), full_page=True)
    page.click("#ask summary")
    check("開くと2問", page.locator("#ask-from-box").is_visible() and page.locator('#ask input[name="ask-else"]').count() == 4 and page.locator("#ask-skip").count() == 0)
    page.screenshot(path=str(out / "5_used_open.png"), full_page=True)
    page.locator("#ask-from label.chip", has_text="海外から").click()
    page.locator("#ask-else label.chip", has_text="家で過ごしていた").click()
    page.click("#ask-send")
    page.wait_for_selector("#ask-thanks:not(.hidden)")
    check("答えたら問いは消え、お礼が一行だけ出る", page.locator("#ask").is_hidden() and page.inner_text("#ask-thanks") == "ご回答ありがとうございました。")
    page.screenshot(path=str(out / "5_answered.png"), full_page=True)
    ans = state().get("answers") or []
    check("答えは店・時間帯とともに残り、紹介状IDは残らない", len(ans) == 2 and ans[1][2] == "shop-b" and ans[1][6] == "海外から" and ans[1][7] == "家で過ごしていた" and letter_id not in json.dumps(ans))
    # 発行する前に開き直しても、発行の欄に戻れる（指摘3）
    page.reload()
    page.wait_for_selector("#card-box .issue")
    check("開き直しても発行の欄が出る", page.locator("#card-box .issue").is_visible())
    page.fill("#pass-name", "まつもと")
    page.click("#pass-issue")
    page.wait_for_selector("#card-box .keepbox")
    check("発行したら、とっておく案内", "自分用の鍵つきリンク" in page.inner_text("#card-box") and "見せる用のリンク" in page.inner_text("#card-box") and "人には送らないでください" in page.inner_text("#card-box"))
    keep_href = urllib.parse.unquote(page.get_attribute("#card-box .keep-line", "href"))
    check("自分用は鍵つきリンクで、人に送らないと分かる文", "（自分用・人に送らない）" in keep_href and f"c={pub}" in keep_href and f"#k={key}" in keep_href)
    show_href = urllib.parse.unquote(page.get_attribute("#card-box .show-line", "href"))
    check("見せる用には鍵が入らない", pub in show_href and key not in show_href and "見るだけ" in show_href)
    owner_url = keep_href.strip().splitlines()[-1]
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
    ask2_checked = False
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
    page.unroute("**/api")
    # 押し直さずに読み直しても、本人として出る（押しかけを覚えていて、同じ鍵で確かめる）
    page.reload()
    page.wait_for_selector("#used:not(.hidden)")
    page.wait_for_selector("#card-box .pass-mini")
    check("2回目は「どこから」を聞かず、紹介がなかったらだけ聞く", page.locator("#ask").is_visible() and page.locator("#ask-from-box").is_hidden())
    page.locator("#words label.chip", has_text="ありがとう").click()
    page.locator("#words label.chip", has_text="楽しかった").click()
    page.wait_for_function("document.getElementById('toast').textContent.includes('添えました')")
    page.reload()
    page.wait_for_selector("#card-box .pass-mini")
    check("添えた言葉は読み直しても選ばれている", page.locator('#words input[name="word"]:checked').count() == 2)
    check("読み直しても本人として出る", page.locator("#used-mine").is_visible() and page.locator("#used-other").is_hidden() and "まつもと・スタンプ 2個" in page.inner_text("#card-box"))
    # 同じ店のQRをもう一度読む
    page.goto(f"{BASE}/visit.html?s=shop-a")
    page.wait_for_url("**/letter.html?id=*")
    page.wait_for_selector("#used:not(.hidden)")
    check("もう一度読むと、押してある日を伝える", page.locator("#used-again").is_visible() and "押してあります" in page.inner_text("#used-again"))
    page.screenshot(path=str(out / "5c_again.png"), full_page=True)
    page.click("#card-box .pass-mini")
    page.wait_for_selector("#app:not(.hidden)")
    check("パスポートにスタンプが2つ（二重にならない）", page.locator(".stamp-cell:not(.empty)").count() == 2 and "スタンプ 2個" in page.inner_text("#count"))
    check("表紙に名前（NAME）", page.inner_text("#holder-name") == "まつもと" and "NAME" in page.inner_text("#holder"))
    check("パスポートの表紙が出る", "KICHIJOJI HASHIGO PASSPORT" in page.inner_text(".pass-cover"))
    check("古い順", page.locator(".stamp-cell:not(.empty) .hanko-shop").all_inner_texts() == ["見本の店B", "見本の店A"])
    check("スタンプに誰の紹介か", "紹介元Aの紹介" in page.inner_text(".stamp-cell >> nth=0"))
    check("言葉はアイコンで出る", page.locator(".stamp-cell >> nth=1").locator(".stamp-words svg.icon").count() == 2)
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

    # 5c. 自分用リンク：鍵のないブラウザで開くと、続きから押せるようになる。別のパスポートがあれば聞く
    p5 = new_ctx(browser)
    p5.goto(owner_url)
    p5.wait_for_selector("#app:not(.hidden)")
    check("自分用リンクで鍵が戻る", p5.evaluate("localStorage.getItem('shokaijo:key')") == key)
    check("鍵はアドレスバーから消える", "#k=" not in p5.url)
    check("戻したあとは自分のものとして出る", p5.locator("#view-only").is_hidden() and p5.locator("#keep").is_visible())
    p2.goto(owner_url)
    p2.wait_for_selector("#switch:not(.hidden)")
    check("別のパスポートがあれば、切り替えるか聞く", "切り替えますか" in p2.inner_text("#switch-text"))
    p2.screenshot(path=str(out / "9b_switch_dark.png"), full_page=True)
    p2.click("#switch-no")
    p2.wait_for_selector("#app:not(.hidden)")
    check("切り替えなければ見るだけ", p2.locator("#view-only").is_visible() and p2.evaluate("localStorage.getItem('shokaijo:key')") == p2_key)
    p2.goto(owner_url)
    p2.wait_for_selector("#switch:not(.hidden)")
    p2.click("#switch-yes")
    p2.wait_for_selector("#app:not(.hidden)")
    check("切り替えると自分のものになり、前の鍵は控えに残る", p2.locator("#keep").is_visible() and p2_key in (p2.evaluate("localStorage.getItem('shokaijo:oldkeys')") or ""))

    # 6. 転送されたリンクを別のスマホで開いても、使用済みの同じ1枚
    p3 = new_ctx(browser)
    p3.goto(link)
    p3.wait_for_selector("#app:not(.hidden)")
    check("転送されても新しい紹介状はできない", len(letters()) == 3)
    check("転送先では使用済みとして出る", p3.locator("#used").is_visible())
    check("転送先には、使用済みとだけ出す", p3.locator("#used-other").is_visible() and p3.locator("#used-mine").is_hidden())
    check("転送先にはパスポートの案内を出さない", p3.locator("#card-box").is_hidden())
    check("転送先には来店の問いを出さない", p3.locator("#ask").is_hidden())

    # 7. 紹介状を開いていないスマホでシールを読む
    p4 = new_ctx(browser)
    p4.goto(f"{BASE}/visit.html?s=shop-b")
    p4.wait_for_selector("#none:not(.hidden)")
    check("紹介状のないスマホには案内だけ", p4.locator("#other-box").is_hidden())
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

    # 9. 英語：スマホの言語が英語なら英語で開き、本人が切り替えられる。記録は日本語のまま
    page.goto(f"{BASE}/?r={ref}")
    page.wait_for_selector("#app:not(.hidden)")
    check("紹介元の画面には切り替えを出さない", page.locator("#langsw").count() == 0)
    page.click("#shop-pick")
    page.locator(".shop", has_text="見本の店C").click()
    page.fill("#nick", "Mike")
    page.click("#make")
    page.wait_for_selector("#send:not(.hidden)")
    link_en = line_text(page).strip().splitlines()[-1]
    en_id = urllib.parse.parse_qs(urllib.parse.urlparse(link_en).query)["id"][0]
    pe = new_ctx(browser, locale="en-US")
    pe.goto(link_en)
    pe.wait_for_selector("#app:not(.hidden)")
    check("英語：スマホの言語に合わせて英語で開く", pe.evaluate("document.documentElement.lang") == "en" and pe.inner_text("#langsw") == "日本語")
    check("英語：宛名に「さん」を付けない", pe.inner_text("#addressee") == "Mike")
    check("英語：入るときの一言に紹介元の名前", "紹介元A sent you" in pe.inner_text("#enter-tip"))
    check("英語：券面は日本語の店名のまま", pe.inner_text("#shop-name") == "見本の店C" and "行きつけの紹介状" in pe.inner_text(".ticket-head"))
    check("英語：地図・案内・ご注意も英語", pe.inner_text("#map") == "Open in Maps" and "When you pay" in pe.inner_text("#howto summary") and "Notes on this trial" in pe.inner_text("#notes summary"))
    check("英語：日本語が残っていない（店名・紹介元・券面を除く）", all(w not in pe.inner_text("#app") for w in ["お会計", "地図で見る", "スタンプ"]))
    pe.screenshot(path=str(out / "9_en_letter.png"), full_page=True)
    pe.goto(f"{BASE}/visit.html?s=shop-c")
    pe.wait_for_selector("#visit-card:not(.hidden)")
    check("英語：店内の画面", pe.inner_text("#visit-btn") == "Get your stamp" and "Get a stamp to remember your visit" in pe.inner_text("#visit-card"))
    pe.screenshot(path=str(out / "9_en_visit.png"), full_page=True)
    pe.click("#visit-btn")
    pe.wait_for_selector("#used:not(.hidden)")
    check("英語：押したあと", "Your stamp from" in pe.inner_text("#used-name") and "Stamped:" in pe.inner_text("#used-mine"))
    check("英語：ひとことの選択肢", pe.locator("#words label.chip", has_text="Had fun").count() == 1)
    pe.locator("#words label.chip", has_text="Had fun").click()
    pe.wait_for_function("document.getElementById('toast').textContent.includes('Added to your stamp')")
    row = [r for r in letters() if r[0] == en_id][0]
    check("英語：ひとことは日本語で残る", row[13] == "楽しかった")
    pe.wait_for_selector("#card-box .issue")
    check("英語：発行の欄", "Get your own Kichijoji Hashigo Passport?" in pe.inner_text("#card-box") and pe.inner_text("#pass-issue") == "Issue")
    pe.click("#ask summary")
    pe.locator("#ask-from label.chip", has_text="From overseas").click()
    pe.locator("#ask-else label.chip", has_text="Stayed home").click()
    pe.screenshot(path=str(out / "9_en_used.png"), full_page=True)
    pe.click("#ask-send")
    pe.wait_for_selector("#ask-thanks:not(.hidden)")
    ans = state().get("answers") or []
    check("英語：問いの答えは日本語で残る", ans[-1][6] == "海外から" and ans[-1][7] == "家で過ごしていた")
    pe.click("#langsw a")
    pe.wait_for_selector("#used:not(.hidden)")
    check("切り替え：日本語になり、覚える", pe.evaluate("document.documentElement.lang") == "ja" and "スタンプを押しました" in pe.inner_text("#used-name") and pe.inner_text("#langsw") == "English" and pe.evaluate("localStorage.getItem('shokaijo:lang')") == "ja")
    check("切り替え：日本語では敬称が付く", pe.inner_text("#addressee") == "Mikeさん")
    pe.click("#langsw a")
    pe.wait_for_selector("#used:not(.hidden)")
    pe.goto(f"{BASE}/card.html")
    pe.wait_for_selector("#app:not(.hidden)")
    href = pe.get_attribute("#grid .stamp-cell:not(.empty) a.stamp-link", "href") or ""
    check("スタンプから地図が開く", href.startswith("https://www.google.com/maps/search/") and pe.get_attribute("#grid a.stamp-link", "target") == "_blank" and "Map" in pe.inner_text("#grid .stamp-pin"))
    check("英語：パスポートも英語のまま", pe.inner_text("#count") == "1 stamp" and "via 紹介元A" in pe.inner_text("#grid") and pe.inner_text("#langsw") == "日本語")
    pe.screenshot(path=str(out / "9_en_card.png"), full_page=True)
    pe.goto(f"{BASE}/visit.html?s=shop-a")
    pe.wait_for_selector("#none:not(.hidden)")
    check("英語：QRで紹介状が見つからないとき", "Came with a letter of introduction?" in pe.inner_text("#none"))
    pe.goto(f"{BASE}/letter.html?id=Lnope")
    pe.wait_for_selector("#error:not(.hidden)")
    check("英語：エラーも英語", pe.inner_text("#error-text") == "This letter could not be found.")

    for pg in (page, p2, p3, p4, p5):
        check("どの画面にもご注意がある", pg.locator("#notes").count() == 1)
    for pg in (page, p2, p3, p4, p5, pe):
        check("横スクロールなし", pg.evaluate("document.documentElement.scrollWidth") <= 390)

    browser.close()

ok = sum(1 for _, c in checks if c)
for name, c in checks:
    print(("ok   " if c else "FAIL ") + name)
print(f"\n{ok}/{len(checks)} 件 成功")
print("コンソールのエラー:", errors or "なし")
sys.exit(0 if ok == len(checks) and not errors else 1)
