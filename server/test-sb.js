import { supabase } from "./supabase-sync.mjs";
async function run() {
  const { data, error } = await supabase.from('devices').select('*').limit(1);
  console.log("Devices:", error ? error.message : "Ok");
  const { data: r2, error: e2 } = await supabase.from('voice_calls').select('*').limit(1);
  console.log("Voice_calls:", e2 ? e2.message : "Ok");
}
run();
