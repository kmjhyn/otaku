from pathlib import Path
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[1]
MAIN_PATH = ROOT / "main.py"
DATA_PATH = ROOT / "otaku_data.json"

spec = importlib.util.spec_from_file_location("otaku_main", MAIN_PATH)
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

if not main.use_supabase():
    raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.")

if not DATA_PATH.exists():
    raise SystemExit("No otaku_data.json found to migrate.")

with DATA_PATH.open("r", encoding="utf-8") as file:
    data = json.load(file)

main.save_data(data)
print("Uploaded otaku_data.json to Supabase.")
