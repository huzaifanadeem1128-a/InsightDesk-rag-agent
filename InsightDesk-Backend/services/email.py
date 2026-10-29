"""
Resend email wrapper.

Sends transactional emails. If RESEND_API_KEY is not configured,
the send is skipped and a warning is logged.
"""

import os


def is_email_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY"))


def send_password_reset_email(to_email: str, reset_url: str) -> bool:
    """
    Send a password reset email via Resend.

    Returns True on success, False on failure.
    Never raises — caller handles the boolean.
    """

    api_key = os.getenv("RESEND_API_KEY")
    from_email = os.getenv("RESEND_FROM_EMAIL", "onboarding@resend.dev")

    if not api_key:
        print("[EMAIL] RESEND_API_KEY not set — skipping send.")
        return False

    try:
        import resend
        resend.api_key = api_key

        html = f"""
        <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #0a0a14; color: #f5f7fb;">
          <h2 style="color: #fff; margin: 0 0 12px;">Reset your password</h2>
          <p style="color: #a1a4b8; line-height: 1.5;">
            Click the button below to set a new password for your InsightDesk account.
            This link expires in 30 minutes.
          </p>
          <p style="margin: 28px 0;">
            <a href="{reset_url}"
               style="display: inline-block; padding: 12px 22px; background: #7c5cff; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600;">
              Reset password
            </a>
          </p>
          <p style="color: #7a7e93; font-size: 12px; line-height: 1.5;">
            If you didn't request this, you can ignore this email.
          </p>
          <p style="color: #7a7e93; font-size: 11px; word-break: break-all;">
            Or copy this link: {reset_url}
          </p>
        </div>
        """

        resend.Emails.send({
            "from": from_email,
            "to": to_email,
            "subject": "Reset your InsightDesk password",
            "html": html,
        })

        return True

    except Exception as e:
        print(f"[EMAIL ERROR] {type(e).__name__}: {e}")
        return False