# A Little Yarn, A Lot of Love ♡

A tiny flip-through booklet website for the handmade burgundy bear-ear hood scarf.
On a computer it opens like a real booklet (two pages side by side); on a phone it shows one page at a time.
Swipe, drag a page corner, tap, or use the arrow keys to turn pages.

**Pages:** cover (Tale as Old as Time) → a little letter → "A Little Yarn, A Lot of Love" + model photo →
"Our arms are long enough to hug you!" + mannequin photos → the little details → tag with a QR code →
"wrapped in love" + price (690 EGP, free delivery) → back cover.

## Run it locally

It's a plain static site, so there's nothing to install. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Put it online (GitHub Pages)

1. In the repository on GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then click **Save**.
3. After a minute the booklet is live at `https://abdulrahman-47.github.io/card/`.

If you host it somewhere else, update the `og:url` / `og:image` links in `index.html` so WhatsApp link previews show the cover.

## Editing

| What | Where |
| --- | --- |
| All the text on the pages | `index.html` (each page is an `<article class="page">`, in order) |
| Price (`690`) | `index.html`: `data-value="690"` on `#priceNum` and the number inside it |
| QR code link | `tools/make_qr.py`: change `QR_URL`, then run `python3 tools/make_qr.py` (needs `pip install segno`) |
| Colors, fonts, layout | `assets/css/style.css` |

The QR code on the tag page opens `https://abdulrahman-47.github.io/card/`. Tapping it shares the link. It's stored in
`assets/js/qr-data.js` and drawn in the booklet's colors by `assets/js/booklet.js`.

## Presentation (`presentation/`)

An Arabic presentation for Loopie built on the same flip-through booklet, opening right-to-left like an Arabic book:
cover → logo → brand introduction → products → pricing policy (cost elements, profit percentage, formulas) →
worked example (580 + 20% = 696 EGP) → sold online with the QR page → thank-you back cover.

Once GitHub Pages is on it lives at `https://abdulrahman-47.github.io/card/presentation/`.
To present: press **F** (or the corner button) for full screen, then use the arrow keys, Page Up/Down (most clickers),
or Space. The controls and cursor hide while the mouse is still. All the text is in `presentation/index.html`.

## Images

`assets/images/` holds the pictures used by the pages. The cut-out photos (`mannequin-*.jpg`, `closeup.jpg`) and the
die-cut stickers (`sticker-*.webp`) are generated from the two sheets in `assets/images/sheets/` (the green-scribbled
parts are left out):

```bash
pip install pillow numpy
python3 tools/make_assets.py
```

---

### بالعربي

موقع صغير على شكل كتيّب بيتقلب صفحاته زي الكتاب الحقيقي. على الكمبيوتر بيظهر صفحتين جنب بعض، وعلى الموبايل صفحة صفحة.
تقدر تقلب بالسحب أو الضغط أو الأسهم.

- **عشان ترفعه أونلاين:** من إعدادات الريبو على GitHub ادخل **Settings → Pages** واختار `main` و `/ (root)` ودوس **Save**،
  وبعد دقيقة هيبقى الرابط `https://abdulrahman-47.github.io/card/`.
- **تعديل الكلام:** كله في `index.html`.
- **السعر:** في `index.html` (الرقم 690).
- **الـ QR code:** بيفتح رابط الكتيّب. لو عايز تغير الرابط، عدّل `QR_URL` في `tools/make_qr.py` وشغّل `python3 tools/make_qr.py`.
- **البريزنتيشن:** على `https://abdulrahman-47.github.io/card/presentation/`. دوس **F** عشان ملء الشاشة، وقلّب بالأسهم أو Page Up/Down أو المسطرة. الكلام كله في `presentation/index.html`.
