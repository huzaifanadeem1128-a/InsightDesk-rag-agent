"""
Promote a user to admin.

Run:

    python seed_admin.py your-email@example.com

Safe to re-run.
"""

import sys
from pathlib import Path

from database import Database


def main():
    if len(sys.argv) != 2:
        print("Usage: python seed_admin.py <email>")
        sys.exit(1)

    email = sys.argv[1].strip()

    if not Path("Database.db").exists():
        print("[!] Database.db not found. Start the app once, then re-run.")
        sys.exit(1)

    db = Database()

    user = db.get_user_by_email(email)

    if user is None:
        print(f"[!] No user found with email: {email}")
        print("    Sign up first, then re-run this script.")
        sys.exit(1)

    user_id = user[0]
    current_role = user[6] if len(user) > 6 else "user"

    if current_role == "admin":
        print(f"[=] {email} is already an admin.")
        return

    db.set_user_role(user_id, "admin")
    print(f"[+] {email} is now an admin.")


if __name__ == "__main__":
    main()
    

