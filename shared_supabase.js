(() => {
  if (!window.supabase) throw new Error('Supabase library did not load.');
  if (!window.APP_CONFIG) throw new Error('Application configuration did not load.');
  window.amfccDb = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY
  );
})();
