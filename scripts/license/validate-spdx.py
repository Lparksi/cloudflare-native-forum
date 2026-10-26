"""Use SPDX's official validator bundled in the checksummed ScanCode release."""
import sys
from spdx_tools.spdx.parser.parse_anything import parse_file
from spdx_tools.spdx.validation.document_validator import validate_full_spdx_document

path = sys.argv[1]
document = parse_file(path)
messages = validate_full_spdx_document(document)
for message in messages:
    print(message)
if messages:
    raise SystemExit("SPDX validation failed")
if not document.packages:
    raise SystemExit("Empty SPDX package inventory")
print(f"SPDX 2.3 validation passed: {len(document.packages)} packages")
