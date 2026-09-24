import os
import sys
import re

# Ensure standard output/error handle UTF-8 / emojis without crashing on Windows / CI runners
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

def extract_changelog_section(version):
    changelog_path = 'CHANGELOG.md'
    if not os.path.exists(changelog_path):
        print(f"Warning: {changelog_path} not found.")
        return ""

    with open(changelog_path, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()

    clean_version = version.lstrip('v').strip()

    # 1. Match specific target version header (e.g. ## [0.4.2] - 2026-09-24, ## [v0.4.2], ## 0.4.2)
    for ver in [re.escape(clean_version), re.escape(version)]:
        pattern = rf"##\s*\[?{ver}\]?.*?\n(.*?)(?=\n##\s*\[|\Z)"
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
        if match:
            section = match.group(1).strip()
            section = re.sub(r'(\n\s*---\s*)+$', '', section).strip()
            if section:
                return section

    # 2. Fallback: check [Unreleased] section if not empty
    unreleased_pattern = r"##\s*\[?Unreleased\]?.*?\n(.*?)(?=\n##\s*\[|\Z)"
    match = re.search(unreleased_pattern, content, re.DOTALL | re.IGNORECASE)
    if match:
        section = match.group(1).strip()
        section = re.sub(r'(\n\s*---\s*)+$', '', section).strip()
        if section:
            return section

    # 3. Fallback: extract the top-most released version section
    latest_pattern = r"##\s*\[\d+\.\d+\.\d+[^\]]*\][^\n]*\n(.*?)(?=\n##\s*\[|\Z)"
    match = re.search(latest_pattern, content, re.DOTALL)
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

    print(f"=== Extracted Release Notes ({len(changelog_text)} chars) ===")
    print(changelog_text)
    print("==================================================")
    print(f"Release notes successfully written to `{output_path}`.")

if __name__ == '__main__':
    main()
