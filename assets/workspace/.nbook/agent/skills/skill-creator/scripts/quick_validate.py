#!/usr/bin/env python3
"""
Lightweight validator for Neuro Book skills.
"""

import re
import sys
from pathlib import Path

MAX_SKILL_NAME_LENGTH = 64
FORBIDDEN_TERMS = (
    "CODEX_HOME",
    "~/.codex/skills",
    "agents/openai.yaml",
    "generate_openai_yaml.py",
)


def parse_frontmatter(content: str) -> tuple[dict[str, str], str] | tuple[None, str]:
    """Extract a flat YAML-like frontmatter block with string values."""
    match = re.match(r"^---\n(.*?)\n---\n?(.*)$", content, re.DOTALL)
    if not match:
        return None, "Missing or invalid YAML frontmatter"

    raw_frontmatter = match.group(1)
    frontmatter: dict[str, str] = {}

    for raw_line in raw_frontmatter.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if raw_line[:1].isspace():
            return None, "Frontmatter must be flat and must not contain nested keys"
        if ":" not in line:
            return None, f"Invalid frontmatter line: {line}"

        key, raw_value = line.split(":", 1)
        key = key.strip()
        value = raw_value.strip()
        if not key:
            return None, f"Invalid frontmatter line: {line}"
        if value.startswith(("'", '"')) and value.endswith(("'", '"')) and len(value) >= 2:
            if value[0] == value[-1]:
                value = value[1:-1]
        frontmatter[key] = value

    return frontmatter, ""


def is_valid_skill_name(name: str) -> bool:
    """Return True when the name matches the current project token rules."""
    if not name or len(name) > MAX_SKILL_NAME_LENGTH:
        return False

    first_char = name[0]
    if not (first_char.isalpha() or first_char in {"_", "-"}):
        return False

    for char in name[1:]:
        if not (char.isalpha() or char.isdigit() or char in {"_", "-"}):
            return False
    return True


def validate_skill(skill_path: Path) -> tuple[bool, str]:
    """Validate the skill folder against the current Neuro Book conventions."""
    skill_md = skill_path / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md not found"

    content = skill_md.read_text(encoding="utf-8")
    parsed_frontmatter, error = parse_frontmatter(content)
    if parsed_frontmatter is None:
        return False, error

    allowed_keys = {"name", "description"}
    unexpected_keys = sorted(set(parsed_frontmatter.keys()) - allowed_keys)
    if unexpected_keys:
        joined_keys = ", ".join(unexpected_keys)
        return False, f"Unexpected frontmatter keys: {joined_keys}"

    name = parsed_frontmatter.get("name", "").strip()
    description = parsed_frontmatter.get("description", "").strip()

    if not name:
        return False, "Missing 'name' in frontmatter"
    if not is_valid_skill_name(name):
        return False, "name must be a single token usable as `$name`"
    if not description:
        return False, "Missing 'description' in frontmatter"

    for forbidden_term in FORBIDDEN_TERMS:
        if forbidden_term in content:
            return False, f"Outdated Codex residue found: {forbidden_term}"

    return True, "Skill is valid."


def main() -> int:
    """Parse CLI arguments and run validation."""
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        return 1

    skill_path = Path(sys.argv[1]).resolve()
    is_valid, message = validate_skill(skill_path)
    print(message)
    return 0 if is_valid else 1


if __name__ == "__main__":
    sys.exit(main())
