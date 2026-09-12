import { createClient } from 'npm:@supabase/supabase-js@2';
import { createStringeeAnswerHandler } from '../_shared/stringee-answer-handler.js';

Deno.serve(createStringeeAnswerHandler({
  createClient,
  getEnv: (name: string) => Deno.env.get(name),
}));
