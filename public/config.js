// Postavke za spajanje na Supabase.
// Vrijednosti nađete u Supabaseu: Project Settings → API (ili Data API).
// "anon public" ključ smije biti javan – podatke štite prijava i pravila u bazi (supabase/schema.sql).
// NIKADA ovdje ne upisujte "service_role" ključ!
window.OPG_CONFIG = {
  supabaseUrl: 'https://VAS-PROJEKT.supabase.co',
  supabaseAnonKey: 'VAS-ANON-KLJUC',
};
