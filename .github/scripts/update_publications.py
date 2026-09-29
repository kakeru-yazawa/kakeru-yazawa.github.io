"""Rebuild the publication list in publications.html from researchmap.

Usage:
  python .github/scripts/update_publications.py              # fetch from the researchmap API
  python .github/scripts/update_publications.py a.json b.json # use saved API responses instead

Papers (published_papers) and books/chapters (books_etc) are merged and grouped by year.
Book editors are read from an "Editor: ..." or "Editors: ..." line in the description (概要).
Only the part of publications.html between the researchmap markers is replaced.
"""

import html
import json
import re
import sys
import urllib.request
from pathlib import Path

PERMALINK = "kakeruyazawa"
TYPES = ["published_papers", "books_etc"]
PAGE = Path(__file__).resolve().parents[2] / "publications.html"
START = "<!-- researchmap:start -->"
END = "<!-- researchmap:end -->"
MY_NAMES = {"Kakeru Yazawa", "Yazawa Kakeru", "矢澤 翔", "矢澤翔"}
PAGE_SIZE = 100
IN_PRESS = "In press"


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


def pick(field):
    """Prefer English, fall back to Japanese."""
    if not field:
        return ""
    return field.get("en") or field.get("ja") or ""


def esc(text):
    return html.escape(text or "")


def join_authors(names):
    names = [f"<b>{esc(n)}</b>" if n in MY_NAMES else esc(n) for n in names]
    if len(names) <= 1:
        return "".join(names)
    if len(names) == 2:
        return f"{names[0]} &amp; {names[1]}"
    return ", ".join(names[:-1]) + f", &amp; {names[-1]}"


def year_of(it):
    return (it.get("publication_date") or "")[:4] or IN_PRESS


def linked(text, it):
    doi = ((it.get("identifiers") or {}).get("doi") or [None])[0]
    if doi:
        return f'<a href="https://doi.org/{esc(doi)}">{text}</a>'
    return text


def page_range(start, end):
    if start and end and start != end:
        return f"{esc(start)}–{esc(end)}"
    return esc(start)


def paper_parts(it):
    title = linked(esc(pick(it.get("paper_title"))), it)
    source = f"<i>{esc(pick(it.get('publication_name')))}</i>"
    if it.get("volume"):
        source += f", <i>{esc(it['volume'])}</i>"
        if it.get("number"):
            source += f"({esc(it['number'])})"
    pages = page_range(it.get("starting_page"), it.get("ending_page"))
    if pages:
        source += f", {pages}"
    return title, source


def editors_of(it):
    """Read an "Editor: ..." / "Editors: ..." line from the researchmap description (概要)."""
    text = re.sub(r"<[^>]+>", "\n", pick(it.get("description")))
    m = re.search(r"^\s*(Editors?)\s*:\s*(.+?)\s*$", text, re.M | re.I)
    if not m:
        return ""
    label = "Eds." if m.group(1).lower() == "editors" else "Ed."
    return f"{esc(m.group(2))} ({label}), "


def book_parts(it):
    book = esc(pick(it.get("book_title")))
    chapter = esc(pick(it.get("book_owner_range")))
    publisher = esc(pick(it.get("publisher")))
    if chapter:
        # A chapter: "Chapter. In Book (pp. x–y). Publisher"
        title = linked(chapter, it)
        source = f"In {editors_of(it)}<i>{book}</i>"
        pages = (it.get("rep_page") or "").replace("-", "–")
        if pages:
            source += f" (pp. {esc(pages)})"
    else:
        # A whole book: "Book. Publisher"
        title = linked(f"<i>{book}</i>", it)
        source = ""
    if publisher:
        source = f"{source}. {publisher}" if source else publisher
    return title, source


def render_item(it):
    authors = (it.get("authors") or {}).get("en") or (it.get("authors") or {}).get("ja") or []
    names = join_authors([a.get("name", "") for a in authors])
    year = year_of(it)
    year = "in press" if year == IN_PRESS else year
    title, source = book_parts(it) if "book_title" in it else paper_parts(it)
    note = " (in Japanese)" if "jpn" in (it.get("languages") or []) else ""
    lines = [f"        {names} ({year}).", f"        {title}."]
    if source:
        lines.append(f"        {source}.{note}")
    elif note:
        lines[-1] += note
    return "      <li>\n" + "\n".join(lines) + "\n      </li>\n"


def render(items):
    # Newest first; items without a date (in press) go on top.
    items = sorted(items, key=lambda it: it.get("publication_date") or "9999", reverse=True)
    out, year = [], None
    for it in items:
        y = year_of(it)
        if y != year:
            if year is not None:
                out.append("    </ol>\n")
            out.append(f'    <h2 class="pub-year">{y}</h2>\n    <ol class="pubs">\n')
            year = y
        out.append(render_item(it))
    if year is not None:
        out.append("    </ol>\n")
    return "".join(out)


def main():
    if len(sys.argv) > 1:
        items = []
        for path in sys.argv[1:]:
            items += json.loads(Path(path).read_text(encoding="utf-8"))["items"]
    else:
        items = [it for t in TYPES for it in fetch_all(t)]
    if not items:
        sys.exit("No items found; leaving publications.html unchanged.")

    page = PAGE.read_text(encoding="utf-8")
    pattern = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
    if not pattern.search(page):
        sys.exit("Markers not found in publications.html.")
    block = f"{START}\n{render(items)}    {END}"
    PAGE.write_text(pattern.sub(lambda _: block, page), encoding="utf-8")
    print(f"Wrote {len(items)} items to {PAGE.name}")


if __name__ == "__main__":
    main()
