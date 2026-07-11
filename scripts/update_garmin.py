import os
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

print("🚀 Starting Garmin test...")

MAPSHARE_ID = "EP9H4"
PASSWORD = os.environ["GARMIN_MAPSHARE_PASSWORD"]

now = datetime.now(timezone.utc)

d1 = (now - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
d2 = (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

URL = (
    f"https://inreach.garmin.com/feed/share/{MAPSHARE_ID}"
    f"?d1={d1}&d2={d2}"
)

print("URL:")
print(URL)

request = urllib.request.Request(
    URL,
    headers={
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
    },
)

password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
password_mgr.add_password(
    None,
    f"https://inreach.garmin.com/feed/share/{MAPSHARE_ID}",
    "mapshare",
    PASSWORD,
)

opener = urllib.request.build_opener(
    urllib.request.HTTPBasicAuthHandler(password_mgr)
)

try:
    with opener.open(request, timeout=30) as response:
        body = response.read()

    print("✅ Connected!")
    print("Status:", response.status)
    print("Content-Type:", response.headers.get("Content-Type"))
    print("Length:", len(body))

    print("\nRAW BYTES:")
    print(repr(body[:500]))

    print("\nTEXT:")
    print(body.decode("utf-8", errors="replace")[:1000])

except urllib.error.HTTPError as e:
    print(f"❌ HTTP Error: {e.code}")

    try:
        error_body = e.read().decode("utf-8", errors="replace")
        print(error_body[:1000])
    except Exception:
        pass

    raise

except Exception as e:
    print("❌ Connection failed")
    print(repr(e))
    raise