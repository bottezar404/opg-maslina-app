# 🫒 OPG Maslina

Web aplikacija za vođenje maslinarskog OPG-a: **berba, prerada, skladište, prodaja, troškovi, kupci i maslinici**, zaštićena prijavom.

- **Sučelje** se besplatno objavljuje na **GitHub Pages**.
- **Podaci i prijava** su u besplatnoj bazi na **Supabase**.
- Na Android/iPhone mobitelu se može **instalirati kao aplikacija** (Chrome: izbornik ⋮ → *Instaliraj aplikaciju* / *Dodaj na početni zaslon*).

## Mogućnosti

| Modul | Što radi |
|---|---|
| 📊 **Pregled** | Ubrano (kg), proizvedeno ulja (L), prosječni randman, zaliha, prodaja, neplaćeno, troškovi i dobit — po godini |
| 🧺 **Berba** | Datum, maslinik, kg, broj berača, sati rada |
| ⚙️ **Prerada** | Uljara, kg maslina → litre ulja, automatski randman, trošak prerade, spremnik |
| 🛢️ **Skladište** | Spremnici s kapacitetom; stanje = prerada − prodaja − pokloni (automatski) |
| 💶 **Prodaja** | Kupac, spremnik, pakiranje, litre, cijena, plaćeno/neplaćeno |
| 🎁 **Pokloni** | Ulje dano kao poklon ili donacija: kome, prilika, spremnik, litre (umanjuje zalihu, ne ulazi u prihod) |
| 🧾 **Troškovi** | Gnojivo, zaštita, berači, gorivo, ambalaža… |
| 👥 **Kupci** / 🌳 **Maslinici** | Maslinici sa sortom i brojem stabala → kg po stablu |

Svaki popis ima pretragu i izvoz u **CSV** (otvara se u Excelu).

---

## Postavljanje (jednom, ~15 minuta)

### 1. Supabase (baza i prijava)

1. Napravite besplatan račun na <https://supabase.com> i **New project** (regija npr. *Central EU (Frankfurt)*). Lozinku baze spremite negdje sigurno.
2. **SQL Editor → New query** → zalijepite cijeli sadržaj datoteke [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Authentication → Users → Add user → Create new user**: upišite e-mail i lozinku za sebe (označite *Auto Confirm User*). Ponovite za svakog člana OPG-a.
4. Dodajte te e-mailove među članove — u **SQL Editoru** pokrenite:
   ```sql
   insert into public.members (email, name) values
     ('vas.email@primjer.hr', 'Vaše Ime'),
     ('clan2@primjer.hr', 'Drugi član');
   ```
   Samo korisnici iz tablice `members` vide i mijenjaju podatke.
5. (Preporučeno) **Authentication → Sign In / Providers → Email**: isključite *Allow new users to sign up*, da se nitko ne može sam registrirati.
6. **Project Settings → API** (ili *Data API*): kopirajte **Project URL** i **anon public** ključ.

### 2. Povezivanje aplikacije

U datoteci [`public/config.js`](public/config.js) upišite URL i *anon* ključ (može se urediti i izravno na GitHubu, ikona olovke ✏️).

> *Anon* ključ smije biti javan — podatke štite prijava i pravila u bazi.
> **Nikada** ne upisujte *service_role* ključ!

### 3. GitHub Pages (objava)

1. Repozitorij → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Svaka promjena na grani `main` automatski se objavi (kartica **Actions**).
3. Aplikacija je na adresi: `https://<korisnik>.github.io/opg-maslina-app/`

> Na besplatnom GitHub računu Pages radi samo za **javne** repozitorije. To je u redu: u repozitoriju je samo kod aplikacije, a **vaši podaci su u Supabaseu**, zaštićeni lozinkom.

---

## Nadogradnja baze

Kad nova verzija aplikacije donese promjene u bazi, ponovo pokrenite cijelu datoteku [`supabase/schema.sql`](supabase/schema.sql) u SQL Editoru. To je sigurno: postojeći podaci ostaju netaknuti.

## Pokretanje na vlastitom računalu (za razvoj)

Nije potreban build — dovoljno je posluživati mapu `public`:

```bash
npx serve public
```

## Sigurnosne kopije

Supabase → **Table Editor** → odabrana tablica → **Export to CSV**, ili CSV izvoz iz same aplikacije. Preporuka: nakon berbe i jednom mjesečno.

## Tehnologija

- Čisti HTML/CSS/JavaScript, bez build koraka; PWA (instalacija na mobitel)
- [Supabase](https://supabase.com): PostgreSQL + prijava; pristup štiti *Row Level Security* (`supabase/schema.sql`)
- `public/supabase.js` je službena biblioteka `@supabase/supabase-js` v2.119.0
