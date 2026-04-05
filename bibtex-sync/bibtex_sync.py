import urllib.request
import os
import re
from pathlib import Path
from datetime import datetime

# --- CONFIG ---
LOCAL_BIB_FILE = os.getenv("LOCAL_BIB_FILE")
GITHUB_USER   = os.getenv("GITHUB_USER")
GITHUB_REPO   = os.getenv("GITHUB_REPO")
GITHUB_BRANCH = os.getenv("GITHUB_BRANCH")
BIB_FILENAME  = os.getenv("BIB_FILE")
VAULT_NOTES_DIR = Path(os.getenv("OUTPUT_DIR"))
LOG_FILE      = VAULT_NOTES_DIR / os.getenv("LOG_FILE")
# --------------

def parse_bibtex_file(content):
    entries = split_entries(content)
    parsed = [parse_entry(entry) for entry in entries]

    return [extract_fields(e) for e in parsed if e]

def split_entries(text):
    entries = []
    current = []

    for line in text.splitlines():
        if line.strip().startswith("@"):
            if current:
                entries.append("\n".join(current))
                current = []
        current.append(line)

    if current:
        entries.append("\n".join(current))

    return entries

def parse_entry(entry_text):
    header_match = re.match(r"@(\w+)\s*{\s*([^,]+),", entry_text)
    if not header_match:
        return None

    entry_type = header_match.group(1).lower()
    citekey = header_match.group(2).strip()

    fields = {}
    fields["ENTRYTYPE"] = entry_type
    fields["ID"] = citekey

    body = entry_text[header_match.end():]

    key = None
    value = []
    brace_level = 0
    in_quote = False

    i = 0
    while i < len(body):
        char = body[i]

        if key is None:
            # Look for key =
            match = re.match(r"\s*([\w\-]+)\s*=", body[i:])
            if match:
                key = match.group(1).lower()
                i += match.end()
                value = []
                continue

        else:
            # Parsing value
            if char == '{':
                brace_level += 1
            elif char == '}':
                brace_level -= 1
            elif char == '"':
                in_quote = not in_quote

            if (brace_level == 0 and not in_quote and char == ','):
                fields[key] = clean_value("".join(value))
                key = None
                value = []
            else:
                value.append(char)

        i += 1

    # Catch last field (no trailing comma)
    if key and value:
        fields[key] = clean_value("".join(value))

    return fields

def clean_value(val):
    val = val.strip().strip(',')
    if val.startswith('{') and val.endswith('}'):
        val = val[1:-1]
    if val.startswith('"') and val.endswith('"'):
        val = val[1:-1]
    # Normalize internal whitespace: collapse tabs, newlines, and multiple spaces into single spaces
    val = re.sub(r'\s+', ' ', val)
    return val.strip()


def extract_fields(entry):
    def get(field):
        return entry.get(field, "")

    return {
        "citekey": entry.get("ID", ""),
        "title": get("title"),
        "authors": parse_authors(get("author")),
        "year": get("year"),
        "journal": get("journal"),
        "abstract": get("abstract"),
        "pmid": get("pmid"),
        "url": get("url"),
    }

def parse_authors(author_field):
    if not author_field:
        return []

    authors = [a.strip() for a in author_field.split(" and ")]

    parsed = []
    for a in authors:
        a_ = a.strip().replace("{","").replace("}","")

        if "," in a_:
            # Already in "last, first" format, keep as is
            parsed.append(a_)
        else:
            # Assume "first m last" format, convert to "last, first m"
            parts = a_.split()
            if len(parts) >= 2:
                # Last part is last name, everything before is first/middle
                last = parts[-1]
                first_middle = " ".join(parts[:-1])
                parsed.append(f"{last}, {first_middle}")
            else:
                # Single part, keep as is
                parsed.append(a_)

    return parsed


def get_authors_list(authors_list):
    if not authors_list:
        return "Unknown"
    return "\n".join([f"  - {a}" for a in authors_list])


def make_note(entry):
    key      = entry.get('citekey', 'unknown')
    title    = entry.get('title', 'Untitled').replace('{', '').replace('}', '')
    authors  = "; ".join(entry.get('authors', []))
    year     = entry.get('year', 'n.d.')
    journal  = entry.get('journal') or entry.get('booktitle', '')
    abstract = entry.get('abstract', '')
    pmid     = entry.get('pmid', '')
    url      = entry.get('url', '')

    title = title.replace("\n"," ")
    abstract = abstract.replace("\n"," ")

    authors_list = get_authors_list(entry.get('authors', ''))


    return f"""---
citekey: {key}
title: "{title}"
authors:
{authors_list}
year: {year}
journal: "{journal}"
url: "{url}"
pmid: "{pmid}"
tags: 
read: false
date_added: {datetime.today().strftime('%Y-%m-%d')}
---

# {title}

**Authors:** {authors}
**{journal}** ({year})

---

## Abstract

{abstract if abstract else '_No abstract available._'}

---

## Key Takeaways

- 

## Questions & Connections

- 

## Notes

- 


## Related Papers


"""

def fetch_bib_from_github():
    """Fetch .bib file from GitHub repository"""
    url = f"https://raw.githubusercontent.com/{GITHUB_USER}/{GITHUB_REPO}/{GITHUB_BRANCH}/{BIB_FILENAME}"
    if os.getenv('GITHUB_TOKEN'):
        token = os.getenv('GITHUB_TOKEN')
        request = urllib.request.Request(url, headers={"Authorization": f"token {token}"})
    else:
        request = urllib.request.Request(url)
    print(f"Fetching {BIB_FILENAME} from {GITHUB_REPO}...")
    with urllib.request.urlopen(request) as response:
        return response.read().decode('utf-8')


def load_bib_from_local_file():
    """Load .bib file from local filesystem"""
    local_path = Path(LOCAL_BIB_FILE)
    if not local_path.exists():
        raise FileNotFoundError(f"Local .bib file not found: {LOCAL_BIB_FILE}")
    print(f"Loading .bib file from local file: {LOCAL_BIB_FILE}")
    with open(local_path, 'r', encoding='utf-8') as f:
        return f.read()


def fetch_bib():
    """Fetch .bib file from configured source (local file takes precedence)"""
    if LOCAL_BIB_FILE:
        return load_bib_from_local_file()
    else:
        return fetch_bib_from_github()


def write_log(total, new_notes):
    with open(LOG_FILE, 'w') as f:
        f.write("# BibTex Sync Log\n\n")
        f.write(f"**Last synced:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write(f"**Total in library:** {total}\n")
        f.write(f"**New notes this sync:** {len(new_notes)}\n\n")
        if new_notes:
            f.write("## Added\n\n")
            for key in new_notes:
                f.write(f"- [[{key}]]\n")
        else:
            f.write("_No new papers since last sync._\n")

def main():
    # Debug: print environment variables
    print("Environment variables:")
    print(f"  LOCAL_BIB_FILE: {LOCAL_BIB_FILE if LOCAL_BIB_FILE else 'NOT SET'}")
    print(f"  GITHUB_USER: {GITHUB_USER if GITHUB_USER else 'NOT SET'}")
    print(f"  GITHUB_REPO: {GITHUB_REPO if GITHUB_REPO else 'NOT SET'}")
    print(f"  GITHUB_BRANCH: {GITHUB_BRANCH if GITHUB_BRANCH else 'NOT SET'}")
    print(f"  BIB_FILENAME: {BIB_FILENAME if BIB_FILENAME else 'NOT SET'}")
    print(f"  GITHUB_TOKEN: {'***' if os.getenv('GITHUB_TOKEN') else 'NOT SET'}")
    print(f"  OUTPUT_DIR: {os.getenv('OUTPUT_DIR')}")
    print(f"  LOG_FILE: {os.getenv('LOG_FILE')}")
    print()
    
    # Determine which source will be used
    if LOCAL_BIB_FILE:
        print("✓ Using LOCAL .bib file (GitHub config will be ignored)")
    else:
        print("✓ Using GITHUB repository")
    print()

    VAULT_NOTES_DIR.mkdir(parents=True, exist_ok=True)

    bib_content = fetch_bib()
    library     = parse_bibtex_file(bib_content)

    print(f"Found {len(library)} entries in library.")

    new_notes = []
    for entry in library:
        key = entry.get('citekey', 'unknown')
        filename = VAULT_NOTES_DIR / f"{key}.md"
        if not filename.exists():
            filename.write_text(make_note(entry))
            new_notes.append(key)
            print(f"  ✓ Created: {key}.md")

    write_log(len(library), new_notes)
    print(f"\nDone. {len(new_notes)} new notes created.")

if __name__ == "__main__":
    main()
    