"""Validate shared fixtures and their repository evidence references."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
schema = json.loads((ROOT / "contracts/v1.schema.json").read_text(encoding="utf-8"))
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema, format_checker=FormatChecker())
fixtures = list((ROOT / "fixtures").glob("*.json"))
for path in fixtures:
    envelope = json.loads(path.read_text(encoding="utf-8"))
    validator.validate(envelope)
    data = envelope["data"]
    for evidence in data.get("evidence", []):
        uri = evidence["uri"]
        if uri.startswith("repo://"):
            target = (ROOT / uri.removeprefix("repo://")).resolve()
            if not target.is_relative_to(ROOT) or not target.is_file():
                raise ValueError(f"Unresolvable evidence in {path.name}: {uri}")
    if data.get("status") == "approved":
        assert data["approval"]["recommendation_version"] == data["version"]
    print(f"PASS {path.name}")
wrong = json.loads((ROOT / "fixtures/completion-wrong-asset.json").read_text(encoding="utf-8"))["data"]
assert any(e["asset_id"] != wrong["asset_id"] for e in wrong["evidence"])
print(f"Validated {len(fixtures)} fixtures. Wrong-asset mismatch remains intentional.")
