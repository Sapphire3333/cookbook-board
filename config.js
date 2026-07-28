/* ============================================================
   The Cookbook Board — Supabase connection settings
   ------------------------------------------------------------
   Find these in the Supabase dashboard: Project Settings → API
     • url      = your "Project URL" — the bare address only,
                  e.g. https://abcd1234.supabase.co
                  (no /rest/v1/ on the end — supabase-js adds that)
     • anonKey  = your "anon public" key, or on newer projects the
                  "Publishable key" (sb_publishable_…). Either works.

   These two values are PUBLIC by design — it is safe for them to
   live in this file and on GitHub. Your data is protected by
   Row Level Security (see schema.sql): every meal and every photo
   is locked to the signed-in user who owns it.

   Set to YOUR_… placeholders instead and the app runs local-only —
   no login, no sync. Everything still works; the cookbook simply
   lives in this browser and in the backup files you download.

   ---- Sharing one project with the Diamond Painting app ----
   The values below are the same ones Diamond uses, because both
   apps share a single Supabase project. That is safe: every table
   this app creates is named "cookbook_…", so nothing can collide
   with the "kv" table Diamond uses.

   One shared project also means ONE login — sign in here with the
   same email and password you use for Diamond, rather than
   creating a second account.
   ============================================================ */
window.COOKBOOK_CONFIG = {
  url: "https://shgnjmskkjnpuhojmmjs.supabase.co",
  anonKey: "sb_publishable_rbXu8ODnWogSifVsLD1oGQ_2iwimxOX"
};
