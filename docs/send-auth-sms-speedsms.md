# Supabase Auth SMS via SpeedSMS

HOME AI uses Supabase Auth to create and verify phone OTPs. The `send-auth-sms`
Edge Function only delivers the Auth-generated code through SpeedSMS's generic
SMS API. It does not use SpeedSMS Verification/PIN and does not verify OTPs.

## Manual setup (not applied by this change)

1. In SpeedSMS, obtain a generic SMS API access token and ensure the account can
   send `sms_type = 4` (Notify) messages with sufficient balance.
2. In Supabase **Edge Functions → Secrets**, add `SPEEDSMS_ACCESS_TOKEN` with that
   token. Never put it in the frontend, Git, or `runtime-config.js`.
3. In Supabase **Authentication → Hooks → Send SMS**, choose an **HTTP** hook.
   Set its URL to
   `https://<PROJECT_REF>.supabase.co/functions/v1/send-auth-sms`. Generate/copy
   the hook signing secret from this configuration and add the **same exact
   value** to Edge Functions Secrets as `SEND_SMS_HOOK_SECRET`. The expected
   Supabase secret format is `v1,whsec_<base64>` (the verifier also accepts
   `whsec_<base64>`). Do not expose or print it.
4. Deploy `send-auth-sms` with JWT verification disabled. Supabase Auth does
   not supply a user JWT for this hook; the function instead requires valid
   Standard Webhooks `webhook-id`, `webhook-timestamp`, and `webhook-signature`
   headers before parsing the OTP or calling SpeedSMS.
5. Enable **Phone** sign-in under **Authentication → Providers**. Keep the
   configured OTP length at six digits to match the Client and Provider UIs.
   Review OTP expiry and rate limits. Supabase Auth remains the authority for
   OTP generation, verification, and session issuance.

The function accepts Vietnamese E.164 `+84…` phone numbers and converts them
to domestic `0…` format accepted by SpeedSMS. A successful delivery returns
HTTP 200 with `{}`. A failed delivery returns a generic error to Supabase Auth;
provider details, full phone numbers, tokens and OTPs are never logged.

References: [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook),
[Supabase Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks),
[SpeedSMS API](https://speedsms.vn/sms-api/).
