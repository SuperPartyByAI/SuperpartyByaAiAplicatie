import { supabase } from "./supabase-sync.mjs";

async function run() {
  console.log("Testing Supabase schemas...");
  let { data, error } = await supabase.from('devices').select('*').limit(1);
  console.log("devices:", error ? error.message : "OK");

  ({ data, error } = await supabase.from('voice_calls').select('*').limit(1));
  console.log("voice_calls:", error ? error.message : "OK");

  ({ data, error } = await supabase.from('calls').select('*').limit(1));
  console.log("calls:", error ? error.message : "OK");

  process.exit(0);
}
run();
