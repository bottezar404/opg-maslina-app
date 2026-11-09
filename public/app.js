'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 0) => v == null || v === '' ? '' : Number(v).toLocaleString('hr-HR', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = v => nf(v, 2) + ' €';
const fdate = v => v ? v.split('-').reverse().join('.') + '.' : '';
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
// Broj iz polja: prihvaća "1300", "1.300", "183,2", "1.300,5", "1 300"
function parseNum(str) {
  let t = String(str).replace(/\s/g, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  else t = t.replace(',', '.');
  return t === '' ? NaN : Number(t);
}
const fmtInput = v => v == null || v === '' ? '' : String(Math.round(v * 100) / 100).replace('.', ',');

const state = { user: null, year: String(new Date().getFullYear()), cache: {} };
const CFG = window.OPG_CONFIG || {};
const configured = CFG.supabaseUrl && CFG.supabaseAnonKey && !CFG.supabaseUrl.includes('VAS-PROJEKT');
const sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;

const ORDER = { groves: ['name', true], tanks: ['name', true], customers: ['name', true] };
const ok = ({ data, error }) => { if (error) throw new Error(translateError(error.message)); return data; };
function translateError(m) {
  if (/row-level security/i.test(m)) return 'Nemate ovlasti (vaš e-mail nije dodan među članove OPG-a)';
  if (/Invalid login credentials/i.test(m)) return 'Pogrešan e-mail ili lozinka';
  if (/Email not confirmed/i.test(m)) return 'E-mail adresa nije potvrđena';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Nema internetske veze';
  if (/Password should be/i.test(m)) return 'Lozinka je preslaba (min. 8 znakova)';
  return m;
}
function yearRange(q, year) {
  return year ? q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`) : q;
}
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = ok(await build().range(from, from + 999));
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
const db = {
  async list(table, year) {
    const rows = await fetchAll(() => {
      const q = sb.from(table).select('*');
      return ORDER[table] ? q.order(ORDER[table][0], { ascending: true })
        : yearRange(q, year).order('date', { ascending: false }).order('id', { ascending: false });
    });
    // Stari unosi prerade imaju samo litre: izračunaj kg
    if (table === 'millings') rows.forEach(r => { if (r.kg_oil == null) r.kg_oil = Math.round(r.liters_oil * OIL_DENSITY * 100) / 100; });
    return rows;
  },
  async getSetting(key) {
    const { data, error } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
    if (error) return { missing: true };
    return { value: data ? data.value : null };
  },
  async setSetting(key, value) { return ok(await sb.from('settings').upsert({ key, value: String(value) })); },
  async insert(table, row) { return ok(await sb.from(table).insert(row)); },
  async update(table, id, row) { return ok(await sb.from(table).update(row).eq('id', id)); },
  async remove(table, id) { return ok(await sb.from(table).delete().eq('id', id)); },
  async stock() {
    const [tanks, mills, sales, gifts] = await Promise.all([
      db.list('tanks'), fetchAll(() => sb.from('millings').select('tank_id, liters_oil').order('id')),
      fetchAll(() => sb.from('sales').select('tank_id, liters').order('id')),
      fetchAll(() => sb.from('gifts').select('tank_id, liters').order('id'))]);
    const row = (t, id) => {
      const produced = sum(mills.filter(m => m.tank_id === id), 'liters_oil');
      const sold = sum(sales.filter(s => s.tank_id === id), 'liters');
      const gifted = sum(gifts.filter(g => g.tank_id === id), 'liters');
      return { ...t, produced, sold, gifted, current: produced - sold - gifted };
    };
    const out = tanks.map(t => row(t, t.id));
    // Ulje iz prerade / prodaje kojoj nije odabran spremnik
    const none = row({ id: null, name: '(bez spremnika)' }, null);
    if (none.produced || none.sold || none.gifted) out.push(none);
    return out;
  },
  async years() {
    const all = await Promise.all(['harvests', 'millings', 'sales', 'expenses', 'gifts'].map(async t => fetchAll(() => sb.from(t).select('date').order('id'))));
    return [...new Set(all.flat().map(r => r.date.slice(0, 4)))];
  },
  async stats(year) {
    const [h, m, s, e, groves, stock, g] = await Promise.all([
      db.list('harvests', year), db.list('millings', year), db.list('sales', year), db.list('expenses', year), db.list('groves'), db.stock(),
      db.list('gifts', year)]);
    const salesTotal = s.reduce((a, r) => a + r.liters * r.price_per_l, 0);
    const byGroveMap = new Map();
    h.forEach(r => byGroveMap.set(r.grove_id, (byGroveMap.get(r.grove_id) || 0) + Number(r.kg)));
    const byGrove = [...byGroveMap].map(([gid, kg]) => {
      const g = groves.find(x => x.id === gid);
      return { name: g?.name || '(bez maslinika)', kg, trees: g?.trees };
    }).sort((a, b) => b.kg - a.kg);
    const milling = { kg: sum(m, 'kg_olives'), kgOil: sum(m, 'kg_oil'), l: sum(m, 'liters_oil'), cost: sum(m, 'cost') };
    const expenses = { total: sum(e, 'amount') };
    return {
      harvest: { kg: sum(h, 'kg'), n: h.length }, milling, expenses, byGrove,
      gifts: { l: sum(g, 'liters'), n: g.length },
      sales: { l: sum(s, 'liters'), total: salesTotal, unpaid: s.filter(r => !r.paid).reduce((a, r) => a + r.liters * r.price_per_l, 0) },
      stock: sum(stock, 'current'), stockRows: stock,
      yieldPct: milling.kg > 0 ? milling.kgOil / milling.kg * 100 : null,
      litersPer100: milling.kg > 0 ? milling.l / milling.kg * 100 : null,
      profit: salesTotal - expenses.total - milling.cost,
    };
  },
};

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = 'toast', 2600);
}

// ---------- Definicije modula ----------
const opt = (res, display = 'name') => ({ type: 'select', source: res, display });
const MODULES = {
  harvests: {
    title: 'Berba', icon: '🧺', singular: 'berbu',
    fields: {
      date: { label: 'Datum', type: 'date', required: true, default: today },
      grove_id: { label: 'Maslinik', ...opt('groves') },
      kg: { label: 'Količina (kg)', type: 'number', required: true },
      workers: { label: 'Broj berača', type: 'number', step: 1 },
      hours: { label: 'Sati rada', type: 'number' },
      notes: { label: 'Bilješke', type: 'textarea' },
    },
    columns: ['date', 'grove_id', 'kg', 'workers', 'hours', 'notes'],
    total: rows => `Ukupno: <b>${nf(sum(rows, 'kg'))} kg</b> u ${rows.length} unosa`,
  },
  millings: {
    title: 'Prerada', icon: '⚙️', singular: 'preradu',
    fields: {
      date: { label: 'Datum', type: 'date', required: true, default: today },
      mill: { label: 'Uljara', type: 'text' },
      kg_olives: { label: 'Masline (kg)', type: 'number', required: true },
      kg_oil: { label: 'Dobiveno ulje (kg)', type: 'number', required: true,
        hint: v => v > 0 ? `= <b>${nf(kgToL(v), 1)} L</b> ulja (gustoća ${nf(OIL_DENSITY, 3)} kg/L)` : `Litre se izračunaju automatski (1 L ≈ ${nf(OIL_DENSITY, 3)} kg)` },
      cost: { label: 'Trošak prerade (€)', type: 'number',
        hint: () => state.millPrice ? `Automatski: kg maslina × ${nf(state.millPrice, 2)} €/kg (može se promijeniti)` : 'Cijenu po kg upišite na vrhu stranice Prerada' },
      tank_id: { label: 'Spremnik', ...opt('tanks') },
      notes: { label: 'Bilješke', type: 'textarea' },
    },
    columns: ['date', 'mill', 'kg_olives', 'kg_oil', 'liters', 'yield', 'cost', 'tank_id'],
    beforeSave: d => { d.liters_oil = Math.round(kgToL(d.kg_oil) * 100) / 100; },
    // Trošak = kg maslina × cijena, dok ga korisnik sam ne promijeni
    onInput: (form, target) => {
      if (target?.name === 'cost') form.dataset.costManual = '1';
      if (target?.name === 'kg_olives' && state.millPrice && !form.dataset.costManual) {
        const kg = parseNum(target.value);
        form.elements.cost.value = Number.isFinite(kg) ? fmtInput(kg * state.millPrice) : '';
      }
    },
    header: async () => {
      const r = await db.getSetting('mill_price_per_kg');
      state.millPrice = r.value ? Number(r.value) : null;
      if (r.missing) return `<div class="card setting warn-box">Za spremanje cijene prerade pokrenite u Supabase SQL Editoru novu verziju datoteke <code>supabase/schema.sql</code>.</div>`;
      return `<form class="card setting" id="mill-price-form">
        <label>Cijena prerade (€ po kg maslina)<input name="price" inputmode="decimal" value="${esc(fmtInput(state.millPrice))}" placeholder="npr. 0,45"></label>
        <button class="btn primary">Spremi cijenu</button>
        <small class="muted">Trošak nove prerade računa se automatski: kg maslina × cijena.</small></form>`;
    },
    afterRender: () => {
      const f = $('#mill-price-form'); if (!f) return;
      f.onsubmit = async e => {
        e.preventDefault();
        const v = f.elements.price.value.trim() === '' ? null : parseNum(f.elements.price.value);
        if (v != null && (!Number.isFinite(v) || v < 0)) return toast('Cijena mora biti pozitivan broj', true);
        try { await db.setSetting('mill_price_per_kg', v ?? ''); state.millPrice = v; toast('Cijena prerade spremljena'); }
        catch (err) { toast(err.message, true); }
      };
    },
    virtual: { liters: { label: 'Ulje (L)', fmt: r => `<b>${nf(r.liters_oil, 1)}</b>` }, yield: { label: 'Randman (kg)', fmt: r => r.kg_olives ? nf(r.kg_oil / r.kg_olives * 100, 1) + ' %' : '' } },
    total: rows => { const kg = sum(rows, 'kg_olives'), l = sum(rows, 'liters_oil');
      return `Ukupno: <b>${nf(kg)} kg</b> maslina → <b>${nf(l, 1)} L</b> ulja (${nf(sum(rows, 'kg_oil'), 1)} kg)${kg ? ` · <b>${nf(l / kg * 100, 1)} L</b> na 100 kg maslina · randman ${nf(sum(rows, 'kg_oil') / kg * 100, 1)} %` : ''} · trošak prerade <b>${eur(sum(rows, 'cost'))}</b>`; },
  },
  sales: {
    title: 'Prodaja', icon: '💶', singular: 'prodaju',
    fields: {
      date: { label: 'Datum', type: 'date', required: true, default: today },
      customer_id: { label: 'Kupac', ...opt('customers') },
      tank_id: { label: 'Iz spremnika', ...opt('tanks') },
      product: { label: 'Proizvod / pakiranje', type: 'text', placeholder: 'npr. boca 0,75 L' },
      liters: { label: 'Količina (L)', type: 'number', required: true },
      price_per_l: { label: 'Cijena po litri (€)', type: 'number', required: true },
      paid: { label: 'Plaćeno', type: 'checkbox' },
      notes: { label: 'Bilješke', type: 'textarea' },
    },
    columns: ['date', 'customer_id', 'product', 'liters', 'price_per_l', 'amount', 'paid'],
    virtual: { amount: { label: 'Iznos', fmt: r => eur(r.liters * r.price_per_l) } },
    total: rows => { const t = rows.reduce((a, r) => a + r.liters * r.price_per_l, 0);
      const u = rows.filter(r => !r.paid).reduce((a, r) => a + r.liters * r.price_per_l, 0);
      return `Prodano <b>${nf(sum(rows, 'liters'), 1)} L</b> · ukupno <b>${eur(t)}</b>${u ? ` · neplaćeno <b class="warn">${eur(u)}</b>` : ''}`; },
  },
  gifts: {
    title: 'Pokloni', icon: '🎁', singular: 'poklon',
    fields: {
      date: { label: 'Datum', type: 'date', required: true, default: today },
      recipient: { label: 'Kome (primatelj)', type: 'text', required: true },
      occasion: { label: 'Prilika / svrha', type: 'text', list: ['Poklon', 'Donacija', 'Obitelj', 'Uzorak / degustacija', 'Blagdani', 'Ostalo'] },
      tank_id: { label: 'Iz spremnika', ...opt('tanks') },
      product: { label: 'Pakiranje', type: 'text', placeholder: 'npr. 2 boce 0,5 L' },
      liters: { label: 'Količina (L)', type: 'number', required: true },
      notes: { label: 'Bilješke', type: 'textarea' },
    },
    columns: ['date', 'recipient', 'occasion', 'product', 'liters', 'tank_id'],
    total: rows => `Poklonjeno: <b>${nf(sum(rows, 'liters'), 1)} L</b> u ${rows.length} ${rows.length === 1 ? 'poklonu' : 'poklona'}`,
  },
  expenses: {
    title: 'Troškovi', icon: '🧾', singular: 'trošak',
    fields: {
      date: { label: 'Datum', type: 'date', required: true, default: today },
      category: { label: 'Kategorija', type: 'text', list: ['Gnojivo', 'Zaštita bilja', 'Rezidba', 'Berači', 'Gorivo', 'Ambalaža', 'Oprema', 'Ostalo'] },
      description: { label: 'Opis', type: 'text' },
      amount: { label: 'Iznos (€)', type: 'number', required: true },
    },
    columns: ['date', 'category', 'description', 'amount'],
    total: rows => `Ukupno: <b>${eur(sum(rows, 'amount'))}</b>`,
  },
  tanks: {
    title: 'Skladište', icon: '🛢️', singular: 'spremnik', noYear: true,
    fields: {
      name: { label: 'Naziv spremnika', type: 'text', required: true },
      capacity_l: { label: 'Kapacitet (L)', type: 'number' },
      oil_type: { label: 'Vrsta ulja', type: 'text', list: ['Ekstra djevičansko', 'Djevičansko', 'Sortno', 'Mješavina'] },
      notes: { label: 'Bilješke', type: 'textarea' },
    },
    columns: ['name', 'oil_type', 'capacity_l', 'produced', 'sold', 'gifted', 'current'],
    virtual: {
      produced: { label: 'Ulaz (L)', fmt: r => nf(r.produced, 1) },
      sold: { label: 'Prodano (L)', fmt: r => nf(r.sold, 1) },
      gifted: { label: 'Poklonjeno (L)', fmt: r => nf(r.gifted, 1) },
      current: { label: 'Stanje (L)', fmt: r => `<b>${nf(r.current, 1)}</b>` + (r.capacity_l ? `<div class="bar"><i style="width:${Math.min(100, Math.max(0, r.current / r.capacity_l * 100))}%"></i></div>` : '') },
    },
    total: rows => `Ukupno na zalihi: <b>${nf(sum(rows, 'current'), 1)} L</b>`,
  },
  customers: {
    title: 'Kupci', icon: '👥', singular: 'kupca', noYear: true,
    fields: {
      name: { label: 'Ime / naziv', type: 'text', required: true },
      phone: { label: 'Telefon', type: 'tel' },
      email: { label: 'E-mail', type: 'email' },
      address: { label: 'Adresa', type: 'text' },
      notes: { label: 'Bilješke', type: 'textarea' },
    },
    columns: ['name', 'phone', 'email', 'address'],
  },
  groves: {
    title: 'Maslinici', icon: '🌳', singular: 'maslinik', noYear: true,
    fields: {
      name: { label: 'Naziv', type: 'text', required: true },
      location: { label: 'Lokacija / katastarska čestica', type: 'text' },
      area_ha: { label: 'Površina (ha)', type: 'number' },
      trees: { label: 'Broj stabala', type: 'number', step: 1 },
      variety: { label: 'Sorta', type: 'text', list: ['Oblica', 'Levantinka', 'Lastovka', 'Buža', 'Istarska bjelica', 'Rosinjola', 'Leccino', 'Pendolino', 'Drobnica'] },
      notes: { label: 'Bilješke', type: 'textarea' },
    },
    columns: ['name', 'location', 'variety', 'trees', 'area_ha'],
  },
};
// Gustoća maslinovog ulja (kg po litri) pri ~20 °C
const OIL_DENSITY = 0.916;
const kgToL = kg => Number(kg) / OIL_DENSITY;
const sum = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

const NAV = [
  ['dashboard', '📊', 'Pregled'], ['harvests'], ['millings'], ['tanks'], ['sales'],
  ['gifts'], ['expenses'], ['customers'], ['groves'], ['settings', '⚙', 'Postavke'],
];

// ---------- Prijava ----------
function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
}
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $('#login-error').textContent = '';
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const data = ok(await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') }));
    state.user = data.user;
    e.target.reset();
    startApp();
  } catch (err) { $('#login-error').textContent = err.message; }
  btn.disabled = false;
});

async function startApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#nav').innerHTML = NAV.map(([id, icon, title]) => {
    const m = MODULES[id];
    return `<a href="#${id}" data-id="${id}"><span>${icon || m.icon}</span>${title || m.title}</a>`;
  }).join('');
  // Provjera je li korisnik dodan među članove OPG-a
  const me = ok(await sb.from('members').select('email, name'));
  if (!me.length) {
    $('#main').innerHTML = `<div class="card narrow"><h2>Pristup nije odobren</h2>
      <p>Prijavljeni ste kao <b>${esc(state.user.email)}</b>, ali ta adresa nije dodana među članove OPG-a.</p>
      <p class="muted">Administrator je treba dodati u tablicu <code>members</code> u Supabaseu (vidi README).</p>
      <button class="btn danger" id="logout">Odjava</button></div>`;
    $('#nav').innerHTML = '';
    $('#logout').onclick = logout;
    return;
  }
  state.members = me;
  await refreshYears();
  if (state.recovery) {
    // Došli smo preko linka iz e-maila za oporavak lozinke
    state.recovery = false;
    history.replaceState(null, '', location.pathname + '#settings');
    setTimeout(() => toast('Upišite novu lozinku'), 300);
  }
  route();
}
async function logout() { await sb.auth.signOut(); state.user = null; showLogin(); }

async function refreshYears() {
  const years = new Set([String(new Date().getFullYear()), ...(await db.years())]);
  const sel = $('#year-select');
  sel.innerHTML = `<option value="">Sve godine</option>` +
    [...years].sort().reverse().map(y => `<option ${y === state.year ? 'selected' : ''}>${y}</option>`).join('');
}
$('#year-select').addEventListener('change', e => { state.year = e.target.value; route(); });
$('#menu-btn').addEventListener('click', () => $('#nav').classList.toggle('open'));
window.addEventListener('hashchange', route);

function route() {
  const id = location.hash.slice(1) || 'dashboard';
  $('#nav').classList.remove('open');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.id === id));
  const views = { dashboard: renderDashboard, settings: renderSettings };
  (views[id] || (MODULES[id] ? () => renderModule(id) : renderDashboard))().catch(e => toast(e.message, true));
}

// ---------- Pregled ----------
async function renderDashboard() {
  const s = await db.stats(state.year), stock = s.stockRows;
  const tile = (label, value, sub = '') => `<div class="tile"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  $('#main').innerHTML = `
    <h2>Pregled ${state.year ? 'za ' + state.year + '.' : '(sve godine)'}</h2>
    <div class="tiles">
      ${tile('Ubrano maslina', nf(s.harvest.kg) + ' kg', s.harvest.n + ' unosa berbe')}
      ${tile('Proizvedeno ulja', nf(s.milling.l, 1) + ' L', 'od ' + nf(s.milling.kg) + ' kg maslina')}
      ${tile('Ulja na 100 kg maslina', s.litersPer100 == null ? '–' : nf(s.litersPer100, 1) + ' L', s.yieldPct == null ? 'nema prerade' : 'randman ' + nf(s.yieldPct, 1) + ' % (po kg)')}
      ${tile('Na zalihi', nf(s.stock, 1) + ' L', 'trenutno stanje, svi spremnici')}
      ${tile('Prodano', nf(s.sales.l, 1) + ' L', eur(s.sales.total))}
      ${tile('Poklonjeno', nf(s.gifts.l, 1) + ' L', s.gifts.n + (s.gifts.n === 1 ? ' poklon' : ' poklona'))}
      ${tile('Neplaćeno', eur(s.sales.unpaid), 'potraživanja od kupaca')}
      ${tile('Troškovi', eur(s.expenses.total + s.milling.cost), 'uključujući preradu ' + eur(s.milling.cost))}
      ${tile('Dobit', eur(s.profit), 'prihod − troškovi')}
    </div>
    <div class="grid2">
      <div class="card"><h3>Berba po maslinicima</h3>
        ${s.byGrove.length ? `<table><thead><tr><th>Maslinik</th><th class="r">kg</th><th class="r">kg/stablu</th></tr></thead><tbody>
        ${s.byGrove.map(g => `<tr><td>${esc(g.name)}</td><td class="r">${nf(g.kg)}</td><td class="r">${g.trees ? nf(g.kg / g.trees, 1) : '–'}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">Nema podataka o berbi.</p>'}
      </div>
      <div class="card"><h3>Stanje spremnika</h3>
        ${stock.length ? stock.map(t => `<div class="tank"><div><b>${esc(t.name)}</b> <small class="muted">${esc(t.oil_type || '')}</small></div>
          <div>${nf(t.current, 1)} L${t.capacity_l ? ' / ' + nf(t.capacity_l) + ' L' : ''}</div>
          ${t.capacity_l ? `<div class="bar"><i style="width:${Math.min(100, Math.max(0, t.current / t.capacity_l * 100))}%"></i></div>` : ''}</div>`).join('')
        : '<p class="muted">Dodajte spremnike u modulu Skladište.</p>'}
      </div>
    </div>
    <div class="quick">
      <a class="btn primary" href="#harvests" data-new>+ Nova berba</a>
      <a class="btn primary" href="#millings" data-new>+ Nova prerada</a>
      <a class="btn primary" href="#sales" data-new>+ Nova prodaja</a>
      <a class="btn primary" href="#gifts" data-new>+ Novi poklon</a>
    </div>`;
  document.querySelectorAll('[data-new]').forEach(a => a.addEventListener('click', () => state.openNew = true));
}

// ---------- Generički moduli ----------
async function loadRefs(mod) {
  const sources = [...new Set(Object.values(mod.fields).filter(f => f.source).map(f => f.source))];
  await Promise.all(sources.map(async s => { state.cache[s] = await db.list(s); }));
}

function cell(mod, key, row) {
  if (mod.virtual?.[key]) return mod.virtual[key].fmt(row);
  const f = mod.fields[key], v = row[key];
  if (f.source) return esc((state.cache[f.source] || []).find(x => x.id === v)?.[f.display] || '');
  if (f.type === 'date') return fdate(v);
  if (f.type === 'checkbox') return v ? '<span class="ok">✔</span>' : '<span class="warn">✘</span>';
  if (f.type === 'number') return nf(v, f.step === 1 ? 0 : (Number.isInteger(v) ? 0 : 2));
  return esc(v);
}
const colLabel = (mod, k) => mod.virtual?.[k]?.label || mod.fields[k].label;
const isNum = (mod, k) => mod.virtual?.[k] || mod.fields[k]?.type === 'number';

async function renderModule(id) {
  const mod = MODULES[id];
  await loadRefs(mod);
  const [rows, header] = await Promise.all([
    id === 'tanks' ? db.stock() : db.list(id, mod.noYear ? null : state.year), mod.header ? mod.header() : '']);
  $('#main').innerHTML = `
    <div class="head"><h2>${mod.icon} ${mod.title}${!mod.noYear && state.year ? ` <small class="muted">${state.year}.</small>` : ''}</h2>
      <div><button class="btn" id="csv">⬇ CSV</button> <button class="btn primary" id="add">+ Dodaj ${mod.singular}</button></div></div>
    ${header}
    <input id="search" class="search" placeholder="Pretraži...">
    ${mod.total && rows.length ? `<p class="summary">${mod.total(rows)}</p>` : ''}
    <div class="card table-wrap">
      ${rows.length ? `<table><thead><tr>${mod.columns.map(k => `<th class="${isNum(mod, k) ? 'r' : ''}">${colLabel(mod, k)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr data-id="${r.id}">${mod.columns.map(k => `<td data-label="${esc(colLabel(mod, k))}" class="${isNum(mod, k) ? 'r' : ''}">${cell(mod, k, r)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : '<p class="muted empty">Još nema unosa. Kliknite "Dodaj" za prvi unos.</p>'}
    </div>`;
  $('#add').onclick = () => openForm(id);
  $('#csv').onclick = () => exportCsv(mod, rows, id);
  $('#search').oninput = e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('tbody tr').forEach(tr => tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none');
  };
  document.querySelectorAll('tbody tr').forEach(tr => {
    const r = rows.find(x => String(x.id) === tr.dataset.id);
    if (r) tr.onclick = () => openForm(id, r); else tr.classList.add('static');
  });
  mod.afterRender?.();
  if (state.openNew) { state.openNew = false; openForm(id); }
}

function inputFor(name, f, value) {
  const req = f.required ? 'required' : '';
  const v = value ?? (typeof f.default === 'function' ? f.default() : '');
  if (f.type === 'select') {
    return `<select name="${name}" ${req}><option value="">—</option>${(state.cache[f.source] || []).map(o =>
      `<option value="${o.id}" ${o.id === value ? 'selected' : ''}>${esc(o[f.display])}</option>`).join('')}</select>`;
  }
  if (f.type === 'textarea') return `<textarea name="${name}" rows="2">${esc(v)}</textarea>`;
  if (f.type === 'checkbox') return `<input type="checkbox" name="${name}" ${value ? 'checked' : ''}>`;
  const list = f.list ? `list="dl-${name}"` : '';
  const dl = f.list ? `<datalist id="dl-${name}">${f.list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : '';
  const num = f.type === 'number' ? `inputmode="${f.step === 1 ? 'numeric' : 'decimal'}" pattern="[0-9 .,]*"` : '';
  const type = f.type === 'number' ? 'text' : f.type;
  const shown = f.type === 'number' ? fmtInput(v) : v;
  return `<input type="${type}" name="${name}" value="${esc(shown)}" ${req} ${num} ${list} placeholder="${esc(f.placeholder || '')}">${dl}`;
}

function openForm(id, row) {
  const mod = MODULES[id];
  const dlg = $('#dialog'), form = $('#dialog-form');
  form.innerHTML = `<h3>${row ? 'Uredi' : 'Dodaj'} ${mod.singular}</h3>
    ${Object.entries(mod.fields).map(([k, f]) => `<label class="${f.type === 'checkbox' ? 'check' : ''}">${f.label}${f.required ? ' *' : ''}${inputFor(k, f, row?.[k])}${f.hint ? `<small class="hint" data-hint="${k}"></small>` : ''}</label>`).join('')}
    <div class="actions">
      ${row ? '<button type="button" class="btn danger" id="del">Obriši</button>' : '<span></span>'}
      <div><button type="button" class="btn" id="cancel">Odustani</button> <button class="btn primary" value="save">Spremi</button></div>
    </div>`;
  form.querySelector('#cancel').onclick = () => dlg.close();
  const updateHints = () => form.querySelectorAll('[data-hint]').forEach(h => {
    const v = parseNum(form.elements[h.dataset.hint].value);
    h.innerHTML = mod.fields[h.dataset.hint].hint(Number.isFinite(v) ? v : 0);
  });
  delete form.dataset.costManual;
  form.oninput = e => { mod.onInput?.(form, e.target); updateHints(); };
  updateHints();
  if (row) form.querySelector('#del').onclick = async () => {
    if (!confirm('Sigurno obrisati ovaj unos?')) return;
    try { await db.remove(id, row.id); dlg.close(); toast('Obrisano'); route(); } catch (e) { toast(e.message, true); }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      const data = {};
      for (const [k, f] of Object.entries(mod.fields)) {
        const el = form.elements[k];
        let v = f.type === 'checkbox' ? el.checked : el.value.trim();
        if (v === '') v = null;
        else if (f.type === 'number' || f.source) {
          v = f.source ? Number(v) : parseNum(v);
          if (!Number.isFinite(v) || v < 0) throw new Error(`"${f.label}" mora biti pozitivan broj`);
          if (f.step === 1 || f.source) v = Math.trunc(v);
        }
        if (f.required && v == null) throw new Error(`"${f.label}" je obavezno polje`);
        data[k] = v;
      }
      mod.beforeSave?.(data);
      if (row) await db.update(id, row.id, data); else await db.insert(id, data);
      dlg.close(); toast('Spremljeno'); refreshYears(); route();
    } catch (err) { toast(err.message, true); }
  };
  dlg.showModal();
}

function exportCsv(mod, rows, id) {
  const cols = mod.columns;
  const strip = s => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const lines = [cols.map(k => colLabel(mod, k)).join(';')].concat(rows.map(r => cols.map(k => {
    const f = mod.fields[k];
    let v = f && f.type === 'number' ? String(r[k] ?? '').replace('.', ',') : strip(cell(mod, k, r));
    if (f?.type === 'checkbox') v = r[k] ? 'da' : 'ne';
    return `"${v.replace(/"/g, '""')}"`;
  }).join(';')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${id}-${state.year || 'sve'}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- Postavke ----------
async function renderSettings() {
  $('#main').innerHTML = `<h2>⚙ Postavke</h2>
    <div class="card narrow"><p>Prijavljeni ste kao <b>${esc(state.user.email)}</b>.</p>
    <form id="pw-form"><h3>Promjena lozinke</h3>
      <label>Nova lozinka (min. 8 znakova)<input type="password" name="next" minlength="8" required autocomplete="new-password"></label>
      <label>Ponovite novu lozinku<input type="password" name="again" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary">Promijeni lozinku</button></form>
    <hr><h3>Članovi OPG-a</h3>
    <ul>${state.members.map(m => `<li>${esc(m.name || '')} <span class="muted">${esc(m.email)}</span></li>`).join('')}</ul>
    <p class="muted">Novog člana dodajte u Supabaseu: <i>Authentication → Users → Add user</i>, zatim njegov e-mail upišite u tablicu <code>members</code> (vidi README).</p>
    <hr><button class="btn danger" id="logout">Odjava</button></div>`;
  $('#pw-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('next') !== fd.get('again')) return toast('Lozinke se ne podudaraju', true);
    try { ok(await sb.auth.updateUser({ password: fd.get('next') })); e.target.reset(); toast('Lozinka promijenjena'); }
    catch (err) { toast(err.message, true); }
  };
  $('#logout').onclick = logout;
}

// ---------- Start ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
  // Kad se instalira nova verzija aplikacije, automatski osvježi stranicu
  // (ne pri prvom otvaranju i ne dok je otvoren obrazac, da se ne izgubi unos)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController || $('#dialog').open) return;
    reloaded = true; location.reload();
  });
}
if (!configured) {
  document.body.innerHTML = `<div class="login"><div class="card login-card"><h1>🫒 OPG Maslina</h1>
    <p>Aplikacija još nije povezana sa Supabaseom.</p>
    <p class="muted">Upišite <code>supabaseUrl</code> i <code>supabaseAnonKey</code> u datoteku <code>public/config.js</code> (upute u README).</p></div></div>`;
} else {
  sb.auth.getSession().then(({ data }) => {
    if (data.session) { state.user = data.session.user; startApp().catch(e => toast(e.message, true)); }
    else showLogin();
  });
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') showLogin();
    if (event === 'PASSWORD_RECOVERY') state.recovery = true;
  });
}
