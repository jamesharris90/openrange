import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE URL");
}

if (!supabaseAnonKey) {
  throw new Error("Missing SUPABASE ANON KEY");
}

console.log("SUPABASE URL:", supabaseUrl);

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
);
