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
    if has_cjk(name) or not given:
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


def doi_link(it):
    """APA style: the DOI goes at the end as a https://doi.org/ URL."""
    doi = ((it.get("identifiers") or {}).get("doi") or [None])[0]
    if not doi:
        return ""
    url = f"https://doi.org/{esc(doi)}"
    return f'<a class="doi" href="{url}">{url}</a>'


def page_range(start, end):
    if start and end and start != end:
        return f"{esc(start)}–{esc(end)}"
    return esc(start)


def paper_parts(it):
    # Japanese-language papers: original title with the English translation in brackets
    ja = is_japanese(it)
    original = pick(it.get("paper_title"), ja)
    english = pick(it.get("paper_title"))
    title = esc(original)
    if english and english != original:
        title += f" [{esc(english)}]"
    venue = pick(it.get("publication_name"), ja)
    # Japanese text is not set in italics
    source = esc(venue) if has_cjk(venue) else f"<i>{esc(venue)}</i>"
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
    names = [apa_editor(n) for n in re.split(r"\s*,\s*(?:&\s*)?|\s+&\s+", m.group(2)) if n]
    if len(names) <= 2:
        joined = " &amp; ".join(esc(n) for n in names)
    else:
        joined = ", ".join(esc(n) for n in names[:-1]) + f", &amp; {esc(names[-1])}"
    return f"{joined} ({label}), "


def book_parts(it):
    book = esc(pick(it.get("book_title")))
    chapter = esc(pick(it.get("book_owner_range")))
    publisher = esc(pick(it.get("publisher")))
    if chapter:
        # A chapter: "Chapter. In Book (pp. x–y). Publisher"
        title = chapter
        source = f"In {editors_of(it)}<i>{book}</i>"
        pages = (it.get("rep_page") or "").replace("-", "–")
        if pages:
            source += f" (pp. {esc(pages)})"
    else:
        # A whole book: "Book. Publisher"
        title = f"<i>{book}</i>"
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
        lines.append(f"        {source}.{note}")
    elif note:
        lines[-1] += note
    doi = doi_link(it)
    if doi:
        lines.append(f"        {doi}")
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
            out.append(f'    <div class="pub-group">\n    <h2 class="pub-year">{y}</h2>\n    <ol class="pubs">\n')
            year = y
        out.append(render_item(it))
    if year is not None:
        out.append("    </ol></div>\n")
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
