import os
import urllib.request

print("🚀 Starting Garmin test...")

password = os.environ["GARMIN_MAPSHARE_PASSWORD"]

url = "https://inreach.garmin.com/feed/share/EP9H4"

password_mgr = urllib.request.HTTPPasswordMgrWithDefaultRealm()
password_mgr.add_password(
    None,
    url,
    "anything",          # Garmin ignores the username for MapShare
    password,
)

opener = urllib.request.build_opener(
    urllib.request.HTTPBasicAuthHandler(password_mgr)
)

try:
    with opener.open(url, timeout=30) as response:
        body = response.read().decode("utf-8", errors="ignore")

    print("✅ Connected!")
    print(body[:1000])   # print the first 1000 characters only

except Exception as e:
    print("❌ Connection failed")
    raise