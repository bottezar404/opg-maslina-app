# Upute za rad na projektu OPG Maslina

## Način rada (obavezno)

- **Nikada ne slati promjene izravno na granu `main`.** `main` se automatski objavljuje na GitHub Pages, pa svaka promjena na njoj odmah ide u aplikaciju koju OPG koristi.
- Svaku promjenu raditi na novoj grani (npr. `claude/<kratak-opis>`) i otvoriti **pull request** prema `main`.
- Opis pull requesta piše se **na hrvatskom** i sadrži:
  - **Što se mijenja** (jednostavnim riječima, za korisnika, ne programera)
  - **Zašto**
  - **Kako je testirano**
  - **Potrebni koraci u Supabaseu**: npr. ponovo pokrenuti `supabase/schema.sql`, ili "nisu potrebni"
- Pull request spaja (merge) **vlasnik repozitorija** nakon što ga pregleda i odobri, nikada Claude.
- Testirati **prije** slanja. Ako test ne prođe, ne slati.

## Projekt

- Statična web aplikacija u mapi `public/` (HTML/CSS/JS, bez build koraka), PWA.
- Podaci i prijava: Supabase. Shema i pravila pristupa (RLS) su u `supabase/schema.sql`. Skripta mora uvijek ostati sigurna za ponovno pokretanje (`if not exists`, bez brisanja podataka).
- Kod promjene datoteka u `public/` povećati verziju `CACHE` u `public/sw.js`.
- Sučelje je na hrvatskom; brojevi s decimalnim zarezom.
