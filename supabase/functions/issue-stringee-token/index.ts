import { createClient } from 'npm:@supabase/supabase-js@2';
import { createIssueStringeeTokenHandler } from '../_shared/stringee-token-handler.js';

Deno.serve(createIssueStringeeTokenHandler({
  createClient,
  getEnv: (name: string) => Deno.env.get(name),
}));
