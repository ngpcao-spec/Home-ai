import {createSendAuthSmsHandler} from '../_shared/auth-sms-handler.js';

// Supabase Auth calls this endpoint without a user JWT. The handler verifies
// the Standard Webhooks HMAC signature before parsing the OTP or sending SMS.
Deno.serve(createSendAuthSmsHandler({
  getSecret: (name: string) => Deno.env.get(name),
}));
