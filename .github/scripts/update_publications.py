"""Rebuild the publication list in publications.html from researchmap.

Usage:
  python .github/scripts/update_publications.py            # fetch from the researchmap API
  python .github/scripts/update_publications.py data.json  # use a saved API response instead

Only the part of publications.html between the researchmap markers is replaced.
"""

import html
import json
import re
import sys
import urllib.request
from pathlib import Path

PERMALINK = "kakeruyazawa"
API = f"https://api.researchmap.jp/{PERMALINK}/published_papers"
PAGE = Path(__file__).resolve().parents[2] / "publications.html"
START = "<!-- researchmap:start -->"
END = "<!-- researchmap:end -->"
MY_NAMES = {"Kakeru Yazawa", "Yazawa Kakeru", "矢澤 翔", "矢澤翔"}
PAGE_SIZE = 100


def fetch_all():
    items, start = [], 1
    while True:
        url = f"{API}?format=json&limit={PAGE_SIZE}&start={start}"
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


def join_authors(names):
    names = [f"<b>{html.escape(n)}</b>" if n in MY_NAMES else html.escape(n) for n in names]
    if len(names) <= 1:
        return "".join(names)
    if len(names) == 2:
        return f"{names[0]} &amp; {names[1]}"
    return ", ".join(names[:-1]) + f", &amp; {names[-1]}"


def render_item(it):
    authors = (it.get("authors") or {}).get("en") or (it.get("authors") or {}).get("ja") or []
    year = (it.get("publication_date") or "")[:4]
    title = html.escape(pick(it.get("paper_title")))
    doi = ((it.get("identifiers") or {}).get("doi") or [None])[0]
    if doi:
        title = f'<a href="https://doi.org/{html.escape(doi)}">{title}</a>'

    source = f"<i>{html.escape(pick(it.get('publication_name')))}</i>"
    vol, num = it.get("volume"), it.get("number")
    if vol:
        source += f", <i>{html.escape(vol)}</i>"
        if num:
            source += f"({html.escape(num)})"
    sp, ep = it.get("starting_page"), it.get("ending_page")
    if sp and ep and sp != ep:
        source += f", {html.escape(sp)}–{html.escape(ep)}"
    elif sp:
        source += f", {html.escape(sp)}"

    note = " (in Japanese)" if "jpn" in (it.get("languages") or []) else ""
    names = join_authors([a.get("name", "") for a in authors])
    return (
        "      <li>\n"
        f"        {names} ({year}).\n"
        f"        {title}.\n"
        f"        {source}.{note}\n"
        "      </li>\n"
    )


def render(items):
    items = sorted(items, key=lambda it: it.get("publication_date") or "", reverse=True)
    out, year = [], None
    for it in items:
        y = (it.get("publication_date") or "")[:4] or "n.d."
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
        items = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["items"]
    else:
        items = fetch_all()
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
