import os
import sys
import re

def extract_changelog_section(version):
    changelog_path = 'CHANGELOG.md'
    if not os.path.exists(changelog_path):
        return ""

    with open(changelog_path, 'r', encoding='utf-8') as f:
        content = f.read()

    clean_version = version.lstrip('v').strip()

    # Match target version header (e.g. ## [0.4.2] - 2026-09-24, ## [v0.4.2], ## 0.4.2)
    for ver in [re.escape(clean_version), re.escape(version)]:
        pattern = rf"##\s*\[?{ver}\]?.*?\n(.*?)(?=\n##\s*\[|\Z)"
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
        if match:
            section = match.group(1).strip()
            section = re.sub(r'(\n\s*---\s*)+$', '', section).strip()
            if section:
                return section

    # Fallback: if specific version is not found, check [Unreleased]
    unreleased_pattern = r"##\s*\[?Unreleased\]?.*?\n(.*?)(?=\n##\s*\[|\Z)"
    match = re.search(unreleased_pattern, content, re.DOTALL | re.IGNORECASE)
    if match:
        section = match.group(1).strip()
        section = re.sub(r'(\n\s*---\s*)+$', '', section).strip()
        if section:
            return section

    return ""

def main():
    version = os.environ.get('VERSION', '').strip()
    if not version and len(sys.argv) > 1:
        version = sys.argv[1].strip()
    if not version:
        version = 'v0.4.2'

    print(f"Extracting changelog for version: {version}")

    changelog_text = extract_changelog_section(version)

    if not changelog_text:
        header_ver = version if version.startswith('v') else f"v{version}"
        changelog_text = f"Release {header_ver} of ProtoFS."

    output_path = 'release_notes.md'
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(changelog_text + '\n')

    print(f"Release notes successfully written to `{output_path}`.")

if __name__ == '__main__':
    main()
