import os
import urllib.request
import urllib.error

print("🚀 Starting Garmin test...")

MAPSHARE_ID = "EP9H4"
PASSWORD = os.environ["GARMIN_MAPSHARE_PASSWORD"]

URL = f"https://inreach.garmin.com/feed/share/{MAPSHARE_ID}"

# Build a browser-like request
request = urllib.request.Request(
    URL,
    headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/vnd.google-earth.kml+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
    },
)

# Try HTTP Basic Auth
password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
password_mgr.add_password(
    None,
    URL,
    "mapshare",
    PASSWORD,
)

opener = urllib.request.build_opener(
    urllib.request.HTTPBasicAuthHandler(password_mgr)
)

try:
    with opener.open(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="ignore")

    print("✅ Connected!")
    print("First 1000 characters:")
    print(body[:1000])

except urllib.error.HTTPError as e:
    print(f"❌ HTTP Error: {e.code}")
    print("Response headers:")
    print(e.headers)

    try:
        error_body = e.read().decode("utf-8", errors="ignore")
        print("\nResponse body:")
        print(error_body[:1000])
    except Exception:
        pass

    raise

except Exception as e:
    print("❌ Connection failed")
    print(repr(e))
    raise