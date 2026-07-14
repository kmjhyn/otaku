from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import hashlib
import json
import os
import secrets
import string
import threading
import time


ROOT = Path(__file__).parent.resolve()
WEB_ROOT = ROOT / "web"
DATA_FILE = ROOT / "otaku_data.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
if SUPABASE_URL.endswith("/rest/v1"):
    SUPABASE_URL = SUPABASE_URL[:-8]
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_TABLE = os.environ.get("SUPABASE_TABLE", "otaku_state")
SUPABASE_ROW_ID = os.environ.get("SUPABASE_ROW_ID", "app")
LOCK = threading.Lock()


STATUS_EMOJI = {
    "watched": "✅",
    "watching": "👀",
    "dislike": "👎",
    "blank": "",
}

SUGGESTION_VALUES = {"", "yes", "no"}
MEMO_MAX_LENGTH = 160


def now_ms():
    return int(time.time() * 1000)


def empty_data():
    return {
        "users": {},
        "groups": {},
        "contents": {},
        "notifications": [],
    }


def use_supabase():
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def supabase_headers(extra=None):
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def supabase_request(path, method="GET", payload=None, extra_headers=None):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{SUPABASE_URL}{path}",
        data=body,
        method=method,
        headers=supabase_headers(extra_headers),
    )
    try:
        with urlopen(request, timeout=12) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase error {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Supabase connection error: {exc.reason}") from exc


def load_data():
    if use_supabase():
        rows = supabase_request(
            f"/rest/v1/{SUPABASE_TABLE}?id=eq.{SUPABASE_ROW_ID}&select=data"
        )
        if rows:
            return rows[0].get("data") or empty_data()
        data = empty_data()
        save_data(data)
        return data
    if not DATA_FILE.exists():
        return empty_data()
    with DATA_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_data(data):
    if use_supabase():
        supabase_request(
            f"/rest/v1/{SUPABASE_TABLE}",
            method="POST",
            payload={"id": SUPABASE_ROW_ID, "data": data, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
            extra_headers={"Prefer": "resolution=merge-duplicates"},
        )
        return
    tmp = DATA_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


def make_id(prefix):
    return f"{prefix}_{secrets.token_hex(8)}"


def make_code(existing_codes):
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if code not in existing_codes:
            return code


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()
    return salt, digest


def normalize_title(title):
    return " ".join(title.casefold().strip().split())


def public_user(user):
    return {
        "id": user["id"],
        "nickname": user["nickname"],
        "groups": user.get("groups", []),
    }


def group_summary(group):
    return {
        "id": group["id"],
        "name": group["name"],
        "code": group["code"],
        "members": group["members"],
        "createdBy": group["createdBy"],
    }


class OtakuHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print(f"[otaku] {self.address_string()} - {fmt % args}")

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def require_user(self, data, payload):
        user_id = payload.get("userId")
        user = data["users"].get(user_id or "")
        if not user:
            raise ValueError("다시 로그인해 주세요.")
        return user

    def do_POST(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(404)
            return
        try:
            payload = self.read_json()
            with LOCK:
                data = load_data()
                response = self.handle_api(parsed.path, data, payload)
                save_data(data)
            self.send_json(response)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, 400)
        except Exception as exc:
            self.send_json({"error": f"서버 오류: {exc}"}, 500)

    def handle_api(self, path, data, payload):
        if path == "/api/signup":
            nickname = payload.get("nickname", "").strip()
            password = payload.get("password", "")
            if len(nickname) < 2:
                raise ValueError("이름은 2글자 이상이어야 해요.")
            if len(password) < 4:
                raise ValueError("비밀번호는 4글자 이상이어야 해요.")
            if any(u["nickname"].casefold() == nickname.casefold() for u in data["users"].values()):
                raise ValueError("이미 사용 중인 이름이에요.")
            salt, digest = hash_password(password)
            user_id = make_id("usr")
            data["users"][user_id] = {
                "id": user_id,
                "nickname": nickname,
                "salt": salt,
                "passwordHash": digest,
                "groups": [],
            }
            return {"user": public_user(data["users"][user_id])}

        if path == "/api/login":
            nickname = payload.get("nickname", "").strip()
            password = payload.get("password", "")
            user = next((u for u in data["users"].values() if u["nickname"].casefold() == nickname.casefold()), None)
            if not user:
                raise ValueError("이름 또는 비밀번호가 올바르지 않아요.")
            _, digest = hash_password(password, user["salt"])
            if digest != user["passwordHash"]:
                raise ValueError("이름 또는 비밀번호가 올바르지 않아요.")
            return {"user": public_user(user)}

        user = self.require_user(data, payload)

        if path == "/api/state":
            return self.app_state(data, user)

        if path == "/api/group/create":
            name = payload.get("name", "").strip()
            if len(name) < 2:
                raise ValueError("그룹 이름은 2글자 이상이어야 해요.")
            existing_codes = {group["code"] for group in data["groups"].values()}
            group_id = make_id("grp")
            group = {
                "id": group_id,
                "name": name,
                "code": make_code(existing_codes),
                "members": [user["id"]],
                "createdBy": user["id"],
            }
            data["groups"][group_id] = group
            user["groups"].append(group_id)
            return self.app_state(data, user)

        if path == "/api/group/join":
            code = payload.get("code", "").strip().upper()
            group = next((g for g in data["groups"].values() if g["code"] == code), None)
            if not group:
                raise ValueError("해당 코드의 그룹을 찾을 수 없어요.")
            if user["id"] not in group["members"]:
                group["members"].append(user["id"])
            if group["id"] not in user["groups"]:
                user["groups"].append(group["id"])
            return self.app_state(data, user)

        if path == "/api/content/add":
            title = payload.get("title", "").strip()
            group_id = payload.get("groupId", "")
            status = payload.get("status", "blank")
            suggestion = payload.get("suggestion", "")
            if not title:
                raise ValueError("콘텐츠 이름을 입력해 주세요.")
            if status not in STATUS_EMOJI:
                raise ValueError("알 수 없는 상태예요.")
            if suggestion not in SUGGESTION_VALUES:
                raise ValueError("알 수 없는 징기스칸 선택이에요.")
            group = data["groups"].get(group_id)
            if not group or user["id"] not in group["members"]:
                raise ValueError("내가 속한 그룹 중 하나를 선택해 주세요.")
            key = normalize_title(title)
            content = next((c for c in data["contents"].values() if c["key"] == key), None)
            if not content:
                content_id = make_id("cnt")
                content = {
                    "id": content_id,
                    "title": title,
                    "key": key,
                    "createdBy": user["id"],
                    "entries": {},
                    "createdAt": now_ms(),
                }
                data["contents"][content_id] = content
            content.setdefault("entries", {})
            group_entries = content["entries"].setdefault(group_id, {})
            if user["id"] in group_entries:
                raise ValueError("이미 이 그룹에 추가한 콘텐츠예요.")
            group_entries[user["id"]] = status
            if suggestion:
                content.setdefault("suggestions", {}).setdefault(group_id, {})[user["id"]] = suggestion
            return self.app_state(data, user)

        if path == "/api/content/update-status":
            content_id = payload.get("contentId", "")
            group_id = payload.get("groupId", "")
            status = payload.get("status", "blank")
            if status not in STATUS_EMOJI:
                raise ValueError("알 수 없는 상태예요.")
            group = data["groups"].get(group_id)
            content = data["contents"].get(content_id)
            if not group or user["id"] not in group["members"] or not content:
                raise ValueError("이 콘텐츠를 수정할 수 없어요.")
            content.setdefault("entries", {}).setdefault(group_id, {})[user["id"]] = status
            return self.group_detail(data, user, group_id)

        if path == "/api/content/update-suggestion":
            content_id = payload.get("contentId", "")
            group_id = payload.get("groupId", "")
            suggestion = payload.get("suggestion", "")
            if suggestion not in SUGGESTION_VALUES:
                raise ValueError("알 수 없는 징기스칸 선택이에요.")
            group = data["groups"].get(group_id)
            content = data["contents"].get(content_id)
            if not group or user["id"] not in group["members"] or not content:
                raise ValueError("이 콘텐츠를 수정할 수 없어요.")
            suggestions = content.setdefault("suggestions", {}).setdefault(group_id, {})
            if suggestion:
                suggestions[user["id"]] = suggestion
            else:
                suggestions.pop(user["id"], None)
            return self.group_detail(data, user, group_id)

        if path == "/api/content/update-memo":
            content_id = payload.get("contentId", "")
            group_id = payload.get("groupId", "")
            memo = payload.get("memo", "").strip()
            group = data["groups"].get(group_id)
            content = data["contents"].get(content_id)
            if not group or user["id"] not in group["members"] or not content:
                raise ValueError("이 콘텐츠를 수정할 수 없어요.")
            if not memo:
                raise ValueError("한마디를 입력해 주세요.")
            if len(memo) > MEMO_MAX_LENGTH:
                raise ValueError(f"한마디는 {MEMO_MAX_LENGTH}자 이하로 입력해 주세요.")
            content.setdefault("memos", {}).setdefault(group_id, {})[user["id"]] = memo
            return self.group_detail(data, user, group_id)

        if path == "/api/content/rename":
            content_id = payload.get("contentId", "")
            group_id = payload.get("groupId", "")
            title = payload.get("title", "").strip()
            group = data["groups"].get(group_id)
            content = data["contents"].get(content_id)
            if not title:
                raise ValueError("콘텐츠 이름을 입력해 주세요.")
            if not group or user["id"] not in group["members"] or not content:
                raise ValueError("이 콘텐츠를 수정할 수 없어요.")
            if content.get("createdBy") != user["id"]:
                raise ValueError("추가한 사람만 이름을 수정할 수 있어요.")
            new_key = normalize_title(title)
            duplicate = next((c for c in data["contents"].values() if c["id"] != content_id and c.get("key") == new_key), None)
            if duplicate and duplicate.get("entries", {}).get(group_id):
                raise ValueError("이미 같은 이름의 콘텐츠가 이 그룹에 있어요.")
            content["title"] = title
            content["key"] = new_key
            return self.group_detail(data, user, group_id)

        if path == "/api/content/delete":
            content_id = payload.get("contentId", "")
            group_id = payload.get("groupId", "")
            group = data["groups"].get(group_id)
            content = data["contents"].get(content_id)
            if not group or user["id"] not in group["members"] or not content:
                raise ValueError("이 콘텐츠를 삭제할 수 없어요.")
            if content.get("createdBy") != user["id"]:
                raise ValueError("추가한 사람만 삭제할 수 있어요.")
            content.get("entries", {}).pop(group_id, None)
            content.get("suggestions", {}).pop(group_id, None)
            content.get("memos", {}).pop(group_id, None)
            data["notifications"] = [
                note for note in data["notifications"]
                if not (note.get("groupId") == group_id and note.get("contentId") == content_id)
            ]
            if not content.get("entries"):
                data["contents"].pop(content_id, None)
            return self.group_detail(data, user, group_id)

        if path == "/api/notify":
            group_id = payload.get("groupId", "")
            content_id = payload.get("contentId", "")
            target_id = payload.get("targetUserId", "")
            group = data["groups"].get(group_id)
            content = data["contents"].get(content_id)
            target = data["users"].get(target_id)
            if not group or not content or not target or user["id"] not in group["members"] or target_id not in group["members"]:
                raise ValueError("이 알림을 보낼 수 없어요.")
            data["notifications"].append({
                "id": make_id("ntf"),
                "to": target_id,
                "from": user["id"],
                "groupId": group_id,
                "contentId": content_id,
                "message": f"{user['nickname']}님: {content['title']} 이거 봐야 해!",
                "createdAt": now_ms(),
                "read": False,
            })
            return {"ok": True, "state": self.app_state(data, user)}

        if path == "/api/notifications/read":
            for note in data["notifications"]:
                if note["to"] == user["id"]:
                    note["read"] = True
            return self.app_state(data, user)

        if path == "/api/group/detail":
            return self.group_detail(data, user, payload.get("groupId", ""))

        raise ValueError("알 수 없는 요청이에요.")

    def app_state(self, data, user):
        groups = [group_summary(data["groups"][gid]) for gid in user.get("groups", []) if gid in data["groups"]]
        all_contents = sorted(
            [{"id": c["id"], "title": c["title"], "createdBy": c["createdBy"]} for c in data["contents"].values()],
            key=lambda c: c["title"].casefold(),
        )
        notifications = [
            n for n in data["notifications"]
            if n["to"] == user["id"] and not n.get("read")
        ]
        return {
            "user": public_user(user),
            "groups": groups,
            "contents": all_contents,
            "notifications": notifications,
        }

    def group_detail(self, data, user, group_id):
        group = data["groups"].get(group_id)
        if not group or user["id"] not in group["members"]:
            raise ValueError("이 그룹에 속해 있지 않아요.")
        members = [public_user(data["users"][uid]) for uid in group["members"] if uid in data["users"]]
        contents = []
        for content in data["contents"].values():
            group_entries = content.get("entries", {}).get(group_id)
            if not group_entries:
                continue
            group_suggestions = content.get("suggestions", {}).get(group_id, {})
            group_memos = content.get("memos", {}).get(group_id, {})
            created_by = data["users"].get(content["createdBy"], {"nickname": "알 수 없음"})
            contents.append({
                "id": content["id"],
                "title": content["title"],
                "shortTitle": content["title"],
                "createdBy": content["createdBy"],
                "createdByNickname": created_by["nickname"],
                "statuses": {member["id"]: group_entries.get(member["id"], "blank") for member in members},
                "suggestions": {member["id"]: group_suggestions.get(member["id"], "") for member in members},
                "memos": [
                    {
                        "userId": member["id"],
                        "nickname": member["nickname"],
                        "text": group_memos.get(member["id"], ""),
                    }
                    for member in members
                    if group_memos.get(member["id"], "")
                ],
                "suggestionCount": sum(1 for member in members if group_suggestions.get(member["id"]) == "yes"),
            })
        contents.sort(key=lambda item: item["title"].casefold())
        return {
            "group": group_summary(group),
            "members": members,
            "contents": contents,
            "statusEmoji": STATUS_EMOJI,
        }


if __name__ == "__main__":
    WEB_ROOT.mkdir(exist_ok=True)
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), OtakuHandler)
    storage = "Supabase" if use_supabase() else "local JSON"
    print(f"OTAKU is running at http://{host}:{port} using {storage} storage")
    server.serve_forever()
