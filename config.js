/* ============================================================
   The Cookbook Board — Supabase connection settings
   ------------------------------------------------------------
   The two values live in the settings block at the BOTTOM of this
   file. Find them in the Supabase dashboard: Project Settings → API
     • url      = your "Project URL" — the bare address only,
                  e.g. https://abcd1234.supabase.co
                  (no /rest/v1/ on the end — supabase-js adds that)
     • anonKey  = your "anon public" key, or on newer projects the
                  "Publishable key" (sb_publishable_…). Either works.

   These two values are PUBLIC by design — it is safe for them to
   live in this file and on GitHub. Your data is protected by
   Row Level Security (see schema.sql): every meal and every photo
   is locked to the signed-in user who owns it.

   If these are left as YOUR_… placeholders, the app just runs in
   local-only mode — no login, no sync. Everything still works;
   your cookbook simply lives in this browser (IndexedDB) and in
   whatever backup files you download.
   ============================================================ */
window.COOKBOOK_CONFIG = {
  url: "YOUR_PROJECT_URL",
  anonKey: "YOUR_ANON_KEY"
};
