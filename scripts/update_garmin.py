import os

print("Workflow is running!")

password = os.environ.get("GARMIN_MAPSHARE_PASSWORD")

if password:
    print("SUCCESS: Secret found.")
else:
    raise Exception("Secret missing.")