import os
import urllib.request

print("🚀 Starting Garmin test...")

PASSWORD = os.environ["GARMIN_MAPSHARE_PASSWORD"]
URL = "https://inreach.garmin.com/feed/share/EP9H4"

request = urllib.request.Request(
    URL,
    headers={
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
    },
)

password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
password_mgr.add_password(None, URL, "mapshare", PASSWORD)

opener = urllib.request.build_opener(
    urllib.request.HTTPBasicAuthHandler(password_mgr)
)

with opener.open(request, timeout=30) as response:
    body = response.read()

print("Status:", response.status)
print("Content-Type:", response.headers.get("Content-Type"))
print("Length:", len(body))

print("\nRAW BYTES:")
print(repr(body[:500]))

print("\nTEXT:")
print(body.decode("utf-8", errors="replace")[:1000])