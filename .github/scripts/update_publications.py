"""Rebuild publications.html from researchmap.

Usage:
  python .github/scripts/update_publications.py            # fetch from the researchmap API
  python .github/scripts/update_publications.py --data DIR # use saved API responses (DIR/<type>.json)

Papers (published_papers) and books/chapters (books_etc) are merged and grouped by year.
Book editors are read from an "Editor: ..." or "Editors: ..." line in the description (概要).
Only the part of the page between the researchmap markers is replaced.
"""

import html
import json
import re
import sys
import urllib.request
from pathlib import Path

PERMALINK = "kakeruyazawa"
ROOT = Path(__file__).resolve().parents[2]
START = "<!-- researchmap:start -->"
END = "<!-- researchmap:end -->"
MY_NAMES = {"Kakeru Yazawa", "Yazawa Kakeru", "矢澤 翔", "矢澤翔"}
PAGE_SIZE = 100
IN_PRESS = "In press"
IN_PRESS_HEADING = 'In press <span lang="ja">印刷中</span>'


def fetch_all(achievement_type):
    items, start = [], 1
    while True:
        url = (f"https://api.researchmap.jp/{PERMALINK}/{achievement_type}"
               f"?format=json&limit={PAGE_SIZE}&start={start}")
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as res:
            data = json.load(res)
        batch = data.get("items", [])
        items += batch
        total = data.get("total_items", len(items))
        if not batch or len(items) >= total:
            return items
        start += len(batch)


def pick(field, ja=False):
    """Prefer English (or Japanese when ja=True), falling back to the other."""
    if not field:
        return ""
    if ja:
        return field.get("ja") or field.get("en") or ""
    return field.get("en") or field.get("ja") or ""


def is_japanese(it):
    return "jpn" in (it.get("languages") or [])


def has_cjk(text):
    return bool(re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", text or ""))


def esc(text):
    return html.escape(text or "")


def initials(given):
    """ "Mary Ann" -> "M. A.", "Jean-Pierre" -> "J.-P." """
    return " ".join("-".join(p[0] + "." for p in word.split("-") if p) for word in given.split())


def split_name(name):
    """Treat the last word as the family name ("Kakeru Yazawa" -> "Kakeru", "Yazawa")."""
    parts = name.split()
    return " ".join(parts[:-1]), parts[-1] if parts else ""


def apa_author(name):
    """APA: "Kakeru Yazawa" -> "Yazawa, K." Japanese names stay as they are."""
    given, family = split_name(name)
    if has_cjk(name) or not given:
        return name
    return f"{family}, {initials(given)}"


def apa_editor(name):
    """APA editors: "Mark Amengual" -> "M. Amengual" """
    given, family = split_name(name)
    # Group editors (e.g. "The Scottish Consortium for ICPhS 2015") stay as they are
    if has_cjk(name) or not given or re.search(r"\d", name) or len(name.split()) > 4:
        return name
    return f"{initials(given)} {family}"


def join_authors(names):
    japanese = any(has_cjk(n) for n in names)
    names = [
        f"<b>{esc(apa_author(n))}</b>" if n in MY_NAMES else esc(apa_author(n))
        for n in names
    ]
    if japanese:
        return "・".join(names)
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + f", &amp; {names[-1]}"


def year_of(it):
    return (it.get("publication_date") or "")[:4] or IN_PRESS


def link_of(it):
    """APA style: the DOI (as a https://doi.org/ URL), or else a URL, goes at the end."""
    doi = ((it.get("identifiers") or {}).get("doi") or [None])[0]
    if doi:
        url = f"https://doi.org/{doi}"
    else:
        # Links researchmap adds automatically (e.g. ORCID) are not about the paper itself
        urls = [s["@id"] for s in it.get("see_also") or []
                if s.get("label") == "url" and "orcid.org" not in s.get("@id", "")]
        if not urls:
            return ""
        url = urls[0]
    return f'<a class="doi" href="{esc(url)}">{esc(url)}</a>'


def page_range(start, end):
    if start and end and start != end:
        return f"{esc(start)}–{esc(end)}"
    return esc(start)


def italic(text):
    # Japanese text is not set in italics
    return esc(text) if has_cjk(text) else f"<i>{esc(text)}</i>"


def paper_parts(it):
    # Japanese-language papers: original title with the English translation in brackets
    ja = is_japanese(it)
    original = pick(it.get("paper_title"), ja)
    english = pick(it.get("paper_title"))
    title = esc(original)
    if english and english != original:
        title += f" [{esc(english)}]"
    venue = pick(it.get("publication_name"), ja)
    publisher = pick(it.get("publisher"), ja)
    if it.get("published_paper_type") == "doctoral_thesis":
        # APA: "*Title* [Doctoral dissertation, Institution]. Archive"
        title = f"<i>{title}</i> [Doctoral dissertation, {esc(publisher)}]" if publisher else f"<i>{title}</i>"
        return title, esc(venue)
    editors = editors_of(it)
    if category_of(it) == "proceedings" and (publisher or editors):
        # APA proceedings: "In Editors (Eds.), Proceedings (Vol. x, pp. x–y). Publisher"
        start, end = it.get("starting_page"), it.get("ending_page")
        details = []
        if it.get("volume"):
            details.append(f"Vol. {esc(it['volume'])}")
        if start and not end:
            # Start page only = paper number (e.g. ICPhS 2015), like "Article" for journals
            details.append(f"Paper {esc(start)}")
        elif start:
            prefix = "pp." if end != start else "p."
            details.append(f"{prefix} {page_range(start, end)}")
        # "In" reads oddly before a Japanese title, so it is left out there
        lead = "" if has_cjk(venue) else "In "
        source = f"{lead}{editors}{italic(venue)}"
        if details:
            source += f" ({', '.join(details)})"
        if publisher:
            source += f". {esc(publisher)}"
        return title, source
    source = italic(venue)
    if it.get("volume"):
        source += f", <i>{esc(it['volume'])}</i>"
        if it.get("number"):
            source += f"({esc(it['number'])})"
    start, end = it.get("starting_page"), it.get("ending_page")
    if start and not end:
        # Journals with article numbers (e.g. Frontiers): start page only -> "Article 1303511"
        source += f", Article {esc(start)}"
    elif start:
        source += f", {page_range(start, end)}"
    return title, source


def editors_of(it):
    """Read an "Editor: ..." / "Editors: ..." line from the researchmap description (概要)."""
    text = re.sub(r"<[^>]+>", "\n", pick(it.get("description")))
    m = re.search(r"^\s*(Editors?)\s*:\s*(.+?)\s*$", text, re.M | re.I)
    if not m:
        return ""
    label = "Eds." if m.group(1).lower() == "editors" else "Ed."
    names = [apa_editor(n) for n in re.split(r"\s*,\s*(?:&\s*)?|\s+&\s+", m.group(2)) if n]
    if any(has_cjk(n) for n in names):
        # Japanese editors: "大和 太郎・山田 花子（編）"
        return "・".join(esc(n) for n in names) + "（編）"
    if len(names) <= 2:
        joined = " &amp; ".join(esc(n) for n in names)
    else:
        joined = ", ".join(esc(n) for n in names[:-1]) + f", &amp; {esc(names[-1])}"
    return f"{joined} ({label}), "


EDITIONS = {"second": "2nd", "third": "3rd", "fourth": "4th", "fifth": "5th"}


def split_edition(book):
    """ "Companion, second edition" -> ("Companion", "2nd ed.") """
    m = re.search(r",?\s*\b(\w+) edition$", book, re.I)
    if not m or m.group(1).lower() not in EDITIONS:
        return book, ""
    return book[:m.start()], f"{EDITIONS[m.group(1).lower()]} ed."


def book_parts(it):
    book, edition = split_edition(pick(it.get("book_title")))
    book = esc(book)
    chapter = esc(pick(it.get("book_owner_range")))
    publisher = esc(pick(it.get("publisher")))
    if chapter:
        # A chapter: "Chapter. In Book (pp. x–y). Publisher"
        title = chapter
        source = f"In {editors_of(it)}<i>{book}</i>"
        pages = (it.get("rep_page") or "").replace("-", "–")
        details = [edition] if edition else []
        if pages:
            details.append(f"pp. {esc(pages)}")
        if details:
            source += f" ({', '.join(details)})"
    else:
        # A whole book: "Book (2nd ed.). Publisher"
        title = f"<i>{book}</i>" + (f" ({edition})" if edition else "")
        source = ""
    if publisher:
        source = f"{source}. {publisher}" if source else publisher
    return title, source


# Filter buttons shown above the list, in this order: (key, English label, Japanese label)
CATEGORIES = [
    ("journal", "Journals", "学術雑誌"),
    ("book", "Books", "書籍"),
    ("proceedings", "Proceedings", "予稿集"),
    ("other", "Other", "その他"),
]


def category_of(it):
    if "book_title" in it:
        return "book"
    kind = it.get("published_paper_type")
    if kind == "scientific_journal":
        return "journal"
    if kind in ("international_conference_proceedings", "research_society"):
        return "proceedings"
    return "other"


def render_filters(items):
    counts = {}
    for it in items:
        counts[category_of(it)] = counts.get(category_of(it), 0) + 1
    buttons = [("all", "All", "すべて", len(items))] + [
        (key, en, ja, counts[key]) for key, en, ja in CATEGORIES if counts.get(key)
    ]
    out = ['    <div class="pub-filters" role="group" aria-label="Filter by type" hidden>\n']
    for key, en, ja, n in buttons:
        pressed = "true" if key == "all" else "false"
        out.append(
            f'      <button type="button" data-filter="{key}" aria-pressed="{pressed}">'
            f'{en} <span class="ja" lang="ja">{ja}</span> <span class="count">{n}</span></button>\n'
        )
    out.append("    </div>\n")
    return "".join(out)


def render_item(it):
    ja = is_japanese(it)
    authors = pick(it.get("authors"), ja) or []
    names = join_authors([a.get("name", "") for a in authors])
    year = year_of(it)
    year = "in press" if year == IN_PRESS else year
    title, source = book_parts(it) if "book_title" in it else paper_parts(it)
    # Flag Japanese-language work only when the title itself doesn't show it
    note = " (in Japanese)" if ja and not has_cjk(title) else ""
    lines = [f"        {names} ({year}).", f"        {title}."]
    if source:
        # Avoid a double period after names like "Co., Ltd."
        end = "" if source.endswith(".") else "."
        lines.append(f"        {source}{end}{note}")
    elif note:
        lines[-1] += note
    link = link_of(it)
    if link:
        lines.append(f"        {link}")
    lang = ' lang="ja"' if has_cjk(title) else ""
    return f'      <li data-type="{category_of(it)}"{lang}>\n' + "\n".join(lines) + "\n      </li>\n"


def render(items):
    # Newest first; items without a date (in press) go on top.
    items = sorted(items, key=lambda it: it.get("publication_date") or "9999", reverse=True)
    out, year = [render_filters(items)], None
    for it in items:
        y = year_of(it)
        if y != year:
            if year is not None:
                out.append("    </ol></div>\n")
            heading = IN_PRESS_HEADING if y == IN_PRESS else y
            out.append(f'    <div class="pub-group">\n    <h2 class="pub-year">{heading}</h2>\n    <ol class="pubs">\n')
            year = y
        out.append(render_item(it))
    if year is not None:
        out.append("    </ol></div>\n")
    return "".join(out)


# ---------- Pages ----------

# (page, researchmap types, renderer)
PAGES = [
    ("publications.html", ["published_papers", "books_etc"], render),
]


def write_block(name, html_block):
    path = ROOT / name
    page = path.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
    if not pattern.search(page):
        sys.exit(f"Markers not found in {name}.")
    block = f"{START}\n{html_block}    {END}"
    path.write_text(pattern.sub(lambda _: block, page), encoding="utf-8")


def main():
    data_dir = None
    if len(sys.argv) == 3 and sys.argv[1] == "--data":
        data_dir = Path(sys.argv[2])
    for name, types, renderer in PAGES:
        items = []
        for t in types:
            if data_dir:
                items += json.loads((data_dir / f"{t}.json").read_text(encoding="utf-8"))["items"]
            else:
                items += fetch_all(t)
        if not items:
            sys.exit(f"No items found; leaving {name} unchanged.")
        write_block(name, renderer(items))
        print(f"Wrote {len(items)} items to {name}")


if __name__ == "__main__":
    main()
