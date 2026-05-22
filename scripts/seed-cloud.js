// seed-cloud.js — populates the cloud Supabase project with realistic dummy data
// Run: node scripts/seed-cloud.js
'use strict'

const https = require('https')

const PROJECT  = 'vrklhtssuzohwbamsucs'
const BASE_URL = `https://${PROJECT}.supabase.co`
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZya2xodHNzdXpvaHdiYW1zdWNzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTQ2NTI0MywiZXhwIjoyMDk1MDQxMjQzfQ.gCwytXg8ECbAuRALjFwyaBLkL7My8RNuLWetsjU0vDo'
const ADMIN_USER_ID = '1eede281-b93b-4542-9572-b4b0d91a605c'

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function request(method, path, body, isAuth = false) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined
    const headers = {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    }
    if (!isAuth) headers['Prefer'] = 'return=representation'

    const req = https.request({ hostname: `${PROJECT}.supabase.co`, path, method, headers }, res => {
      let buf = ''
      res.on('data', d => buf += d)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
        catch { resolve({ status: res.statusCode, body: buf }) }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

const authPost = (path, body) => request('POST', path, body, true)
const authPut  = (path, body) => request('PUT',  path, body, true)
const restPost = (path, body) => request('POST', `/rest/v1/${path}`, body)
const restPatch = (path, body) => request('PATCH', `/rest/v1/${path}`, body)

async function createUser(email, password, role, metadata = {}) {
  const r = await authPost('/auth/v1/admin/users', {
    email, password, email_confirm: true,
    app_metadata: { user_role: role, role, ...metadata },
  })
  if (r.body.id) return r.body.id
  if (r.body.error_code === 'email_exists' || (r.body.msg && r.body.msg.includes('already been registered'))) {
    // Fetch existing user by listing and filtering
    const list = await request('GET', `/auth/v1/admin/users?page=1&per_page=100`, null, true)
    const found = list.body.users?.find(u => u.email === email)
    if (found) return found.id
  }
  throw new Error(`Failed to create ${email}: ${JSON.stringify(r.body)}`)
}

function normalizeRows(rows) {
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))]
  return rows.map(r => Object.fromEntries(keys.map(k => [k, r[k] ?? null])))
}

async function countRows(table) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: `${PROJECT}.supabase.co`,
      path: `/rest/v1/${table}?select=count`,
      method: 'HEAD',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' }
    }, res => {
      const range = res.headers['content-range'] || '0-0/0'
      const total = parseInt(range.split('/')[1] || '0', 10)
      resolve(total)
    })
    req.on('error', reject); req.end()
  })
}

async function insert(table, rows, { skipIfExists = false } = {}) {
  if (skipIfExists) {
    const count = await countRows(table)
    if (count > 0) { return [] }
  }

  const normalized = normalizeRows(Array.isArray(rows) ? rows : [rows])
  const data = JSON.stringify(normalized)
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Prefer': 'resolution=merge-duplicates,return=representation',
  }
  const r = await new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: `${PROJECT}.supabase.co`, path: `/rest/v1/${table}`, method: 'POST', headers },
      res => { let buf = ''; res.on('data', d => buf += d); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) } catch { resolve({ status: res.statusCode, body: buf }) } }) }
    )
    req.on('error', reject); req.write(data); req.end()
  })
  if (r.status >= 300) throw new Error(`INSERT ${table} failed (${r.status}): ${JSON.stringify(r.body)}`)
  return r.body
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString()
}
function dateStr(yearsOffset = 0, monthOffset = 0) {
  const d = new Date()
  d.setFullYear(d.getFullYear() + yearsOffset)
  d.setMonth(d.getMonth() + monthOffset)
  return d.toISOString().split('T')[0]
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  GAIA seed starting...\n')

  // ── 1. Create users ──────────────────────────────────────────────────────────
  console.log('Creating users...')

  const farmerIds = await Promise.all([
    createUser('juan.delacruz@gmail.com',  'Farmer2026!', 'farmer'),
    createUser('maria.santos@gmail.com',   'Farmer2026!', 'farmer'),
    createUser('carlos.reyes@gmail.com',   'Farmer2026!', 'farmer'),
    createUser('pedro.bautista@gmail.com', 'Farmer2026!', 'farmer'),
    createUser('luz.garcia@gmail.com',     'Farmer2026!', 'farmer'),
  ])

  const dealerUserIds = await Promise.all([
    createUser('roberto.mendoza@sunshineagri.ph', 'Dealer2026!', 'dealer'),
    createUser('elena.cruz@greenfieldstrading.ph', 'Dealer2026!', 'dealer'),
    createUser('mark.villanueva@farmpro.ph', 'Dealer2026!', 'dealer'),
  ])

  const brandUserId = await createUser('james.buenaventura@agrotech.ph', 'Brand2026!', 'brand_admin')

  console.log(`  ✓ ${farmerIds.length} farmers, ${dealerUserIds.length} dealers, 1 brand admin\n`)

  // ── 2. User profiles ─────────────────────────────────────────────────────────
  console.log('Creating user profiles...')

  const farmerProfiles = [
    { id: farmerIds[0], role: 'farmer', display_name: 'Juan Dela Cruz',   phone_number: '+639171234567', locale: 'tl' },
    { id: farmerIds[1], role: 'farmer', display_name: 'Maria Santos',     phone_number: '+639182345678', locale: 'en' },
    { id: farmerIds[2], role: 'farmer', display_name: 'Carlos Reyes',     phone_number: '+639193456789', locale: 'tl' },
    { id: farmerIds[3], role: 'farmer', display_name: 'Pedro Bautista',   phone_number: '+639204567890', locale: 'tl' },
    { id: farmerIds[4], role: 'farmer', display_name: 'Luz Garcia',       phone_number: '+639215678901', locale: 'en' },
  ]
  const dealerProfiles = [
    { id: dealerUserIds[0], role: 'dealer', display_name: 'Roberto Mendoza',   phone_number: '+639261234567', locale: 'en' },
    { id: dealerUserIds[1], role: 'dealer', display_name: 'Elena Cruz',        phone_number: '+639272345678', locale: 'tl' },
    { id: dealerUserIds[2], role: 'dealer', display_name: 'Mark Villanueva',   phone_number: '+639283456789', locale: 'en' },
  ]
  const brandProfile = { id: brandUserId, role: 'brand_admin', display_name: 'James Buenaventura', phone_number: null, locale: 'en' }
  const adminProfile = { id: ADMIN_USER_ID, role: 'gabs_admin', display_name: 'GAIA Admin', phone_number: null, locale: 'en' }

  await insert('user_profiles', [...farmerProfiles, ...dealerProfiles, brandProfile, adminProfile])
  console.log('  ✓ user profiles\n')

  // ── 3. Dealer accounts ───────────────────────────────────────────────────────
  console.log('Creating dealer accounts...')

  const dealerAccountIds = [uuid(), uuid(), uuid()]
  await insert('dealer_accounts', [
    {
      id: dealerAccountIds[0], user_id: dealerUserIds[0],
      business_name: 'Sunshine Agri Supply', territory_notes: 'Nueva Ecija, Bulacan',
      is_verified: true, verified_by: ADMIN_USER_ID, verified_at: daysAgo(30),
    },
    {
      id: dealerAccountIds[1], user_id: dealerUserIds[1],
      business_name: 'Green Fields Trading', territory_notes: 'Davao del Sur, South Cotabato',
      is_verified: true, verified_by: ADMIN_USER_ID, verified_at: daysAgo(45),
    },
    {
      id: dealerAccountIds[2], user_id: dealerUserIds[2],
      business_name: 'FarmPro Inc.',         territory_notes: 'Ilocos Norte, Ilocos Sur',
      is_verified: false,
    },
  ], { skipIfExists: true })
  console.log('  ✓ dealer accounts\n')

  // Re-read actual dealer account IDs from DB so containers can use them
  const existingDealers = await request('GET', '/rest/v1/dealer_accounts?select=id,user_id&order=created_at')
  const dealerIdMap = {}
  for (const d of existingDealers.body || []) dealerIdMap[d.user_id] = d.id
  const actualDealerAccountIds = [
    dealerIdMap[dealerUserIds[0]] || dealerAccountIds[0],
    dealerIdMap[dealerUserIds[1]] || dealerAccountIds[1],
    dealerIdMap[dealerUserIds[2]] || dealerAccountIds[2],
  ]

  // ── 4. Manufacturer account ───────────────────────────────────────────────────
  console.log('Creating manufacturer account...')
  const mfgId = uuid()
  await insert('manufacturer_accounts', [{
    id: mfgId, user_id: brandUserId,
    company_name: 'AgroTech Philippines Corporation',
    onboarded_by: ADMIN_USER_ID,
  }], { skipIfExists: true })
  console.log('  ✓ manufacturer account\n')

  // ── 5. Products ───────────────────────────────────────────────────────────────
  console.log('Creating products...')

  const productIds = Array.from({ length: 12 }, uuid)
  const products = [
    {
      id: productIds[0],
      product_name: 'GlyphoMax 480 SL',
      brand_name: 'GlyphoMax',
      company: 'AgroTech Philippines Corporation',
      active_ingredient: 'Glyphosate (isopropylamine salt)',
      concentration: '480 g/L',
      formulation_type: 'SL',
      type: 'HERBICIDE',
      category: '3',
      fpa_registration_number: 'FPA-R-0234-2021',
      fpa_registration_expires_at: dateStr(1, 2),
      fpa_last_imported_at: daysAgo(10),
      mode_of_entry: 'Systemic',
      dosage_rate: '2-4 L/ha',
      pre_harvest_interval: '7 days',
      re_entry_period: '12 hours',
      pests: 'Broadleaf weeds, grasses, sedges',
      status: 'active',
    },
    {
      id: productIds[1],
      product_name: 'Cyperkill 25 EC',
      brand_name: 'Cyperkill',
      company: 'AgroTech Philippines Corporation',
      active_ingredient: 'Cypermethrin',
      concentration: '25 g/L',
      formulation_type: 'EC',
      type: 'INSECTICIDE',
      category: '2',
      fpa_registration_number: 'FPA-R-0891-2020',
      fpa_registration_expires_at: dateStr(0, 6),
      fpa_last_imported_at: daysAgo(15),
      mode_of_entry: 'Contact / Stomach',
      dosage_rate: '0.5-1.0 L/ha',
      pre_harvest_interval: '14 days',
      re_entry_period: '24 hours',
      pests: 'Diamondback moth, armyworm, thrips',
      note_to_physician: 'Pyrethroid. Treat symptomatically. No specific antidote.',
      status: 'active',
    },
    {
      id: productIds[2],
      product_name: 'Mancozeb 80 WP',
      brand_name: 'MancoPro',
      company: 'PhilAgro Chemicals Inc.',
      active_ingredient: 'Mancozeb',
      concentration: '80%',
      formulation_type: 'WP',
      type: 'FUNGICIDE',
      category: '3',
      fpa_registration_number: 'FPA-R-1102-2022',
      fpa_registration_expires_at: dateStr(2, 0),
      fpa_last_imported_at: daysAgo(5),
      mode_of_entry: 'Protectant (contact)',
      dosage_rate: '1.5-2.0 kg/ha',
      pre_harvest_interval: '7 days',
      re_entry_period: '24 hours',
      pests: 'Late blight, early blight, downy mildew',
      status: 'active',
    },
    {
      id: productIds[3],
      product_name: 'Chlorpyrifos 480 EC',
      brand_name: 'ChlorMax',
      company: 'PhilAgro Chemicals Inc.',
      active_ingredient: 'Chlorpyrifos',
      concentration: '480 g/L',
      formulation_type: 'EC',
      type: 'INSECTICIDE',
      category: '2',
      fpa_registration_number: 'FPA-R-0456-2019',
      fpa_registration_expires_at: dateStr(-1, 3),
      fpa_last_imported_at: daysAgo(60),
      mode_of_entry: 'Contact / Stomach / Vapor',
      dosage_rate: '1.0-2.0 L/ha',
      pre_harvest_interval: '21 days',
      re_entry_period: '24 hours',
      pests: 'Stem borer, brown plant hopper, aphids',
      note_to_physician: 'Organophosphate. Atropine sulfate is antidote. Call Poison Control.',
      status: 'suspended',
    },
    {
      id: productIds[4],
      product_name: 'Tricyclazole 75 WP',
      brand_name: 'TricyPro',
      company: 'AgroTech Philippines Corporation',
      active_ingredient: 'Tricyclazole',
      concentration: '75%',
      formulation_type: 'WP',
      type: 'FUNGICIDE',
      category: '3',
      fpa_registration_number: 'FPA-R-0723-2023',
      fpa_registration_expires_at: dateStr(3, 0),
      fpa_last_imported_at: daysAgo(3),
      mode_of_entry: 'Systemic',
      dosage_rate: '0.5-0.75 kg/ha',
      pre_harvest_interval: '14 days',
      re_entry_period: '12 hours',
      pests: 'Rice blast (Pyricularia oryzae)',
      status: 'active',
    },
    {
      id: productIds[5],
      product_name: 'Imidacloprid 70 WG',
      brand_name: 'ImidaGold',
      company: 'BioShield Agri Corp.',
      active_ingredient: 'Imidacloprid',
      concentration: '70%',
      formulation_type: 'WG',
      type: 'INSECTICIDE',
      category: '2',
      fpa_registration_number: 'FPA-R-1345-2021',
      fpa_registration_expires_at: dateStr(1, 8),
      fpa_last_imported_at: daysAgo(20),
      mode_of_entry: 'Systemic',
      dosage_rate: '50-100 g/ha',
      pre_harvest_interval: '21 days',
      re_entry_period: '12 hours',
      pests: 'Whitefly, aphids, thrips, brown plant hopper',
      status: 'active',
    },
    {
      id: productIds[6],
      product_name: 'Azoxystrobin 25 SC',
      brand_name: 'AzoMax',
      company: 'BioShield Agri Corp.',
      active_ingredient: 'Azoxystrobin',
      concentration: '25 g/L',
      formulation_type: 'SC',
      type: 'FUNGICIDE',
      category: '3',
      fpa_registration_number: 'FPA-R-0987-2022',
      fpa_registration_expires_at: dateStr(2, 4),
      fpa_last_imported_at: daysAgo(8),
      mode_of_entry: 'Systemic / Translaminar',
      dosage_rate: '0.75-1.0 L/ha',
      pre_harvest_interval: '7 days',
      re_entry_period: '4 hours',
      pests: 'Anthracnose, powdery mildew, rust, early blight',
      status: 'active',
    },
    {
      id: productIds[7],
      product_name: 'Paraquat 24 SL',
      brand_name: 'ParaKill',
      company: 'PhilAgro Chemicals Inc.',
      active_ingredient: 'Paraquat dichloride',
      concentration: '240 g/L',
      formulation_type: 'SL',
      type: 'HERBICIDE',
      category: '1',
      fpa_registration_number: 'FPA-R-0112-2018',
      fpa_registration_expires_at: dateStr(-2, 0),
      fpa_last_imported_at: daysAgo(180),
      mode_of_entry: 'Contact',
      dosage_rate: '1.5-3.0 L/ha',
      pre_harvest_interval: '14 days',
      re_entry_period: '48 hours',
      pests: 'Annual weeds, grasses',
      note_to_physician: 'HIGHLY TOXIC. No antidote. Fuller\'s earth or activated charcoal if ingested. Do NOT induce vomiting. Supportive care only.',
      status: 'suspended',
    },
    {
      id: productIds[8],
      product_name: 'Propiconazole 25 EC',
      brand_name: 'PropMax',
      company: 'AgroTech Philippines Corporation',
      active_ingredient: 'Propiconazole',
      concentration: '25%',
      formulation_type: 'EC',
      type: 'FUNGICIDE',
      category: '3',
      fpa_registration_number: 'FPA-R-0654-2020',
      fpa_registration_expires_at: dateStr(0, 10),
      fpa_last_imported_at: daysAgo(25),
      mode_of_entry: 'Systemic',
      dosage_rate: '0.5-1.0 L/ha',
      pre_harvest_interval: '14 days',
      re_entry_period: '24 hours',
      pests: 'Sheath blight, brown spot, narrow brown leaf spot',
      status: 'active',
    },
    {
      id: productIds[9],
      product_name: 'Metalaxyl-M 4 SL',
      brand_name: 'MetaShield',
      company: 'BioShield Agri Corp.',
      active_ingredient: 'Metalaxyl-M (Mefenoxam)',
      concentration: '4%',
      formulation_type: 'SL',
      type: 'FUNGICIDE',
      category: '4',
      fpa_registration_number: 'FPA-R-1456-2023',
      fpa_registration_expires_at: dateStr(3, 6),
      fpa_last_imported_at: daysAgo(1),
      mode_of_entry: 'Systemic',
      dosage_rate: '1.0-2.0 L/ha',
      pre_harvest_interval: '7 days',
      re_entry_period: '4 hours',
      pests: 'Damping off, Pythium, Phytophthora',
      status: 'draft',
    },
    {
      id: productIds[10],
      product_name: 'Abamectin 1.8 EC',
      brand_name: 'AbaKill',
      company: 'AgroTech Philippines Corporation',
      active_ingredient: 'Abamectin',
      concentration: '18 g/L',
      formulation_type: 'EC',
      type: 'ACARICIDE',
      category: '2',
      fpa_registration_number: 'FPA-R-0789-2021',
      fpa_registration_expires_at: dateStr(1, 0),
      fpa_last_imported_at: daysAgo(12),
      mode_of_entry: 'Contact / Translaminar',
      dosage_rate: '0.5-0.75 L/ha',
      pre_harvest_interval: '7 days',
      re_entry_period: '12 hours',
      pests: 'Spider mites, leafminer, thrips',
      status: 'active',
    },
    {
      id: productIds[11],
      product_name: 'Lambda-cyhalothrin 25 WG',
      brand_name: 'LambdaShield',
      company: 'PhilAgro Chemicals Inc.',
      active_ingredient: 'Lambda-cyhalothrin',
      concentration: '25 g/kg',
      formulation_type: 'WG',
      type: 'INSECTICIDE',
      category: '2',
      fpa_registration_number: null,
      fpa_registration_expires_at: null,
      mode_of_entry: 'Contact / Stomach',
      dosage_rate: '0.5-1.0 kg/ha',
      pre_harvest_interval: '14 days',
      re_entry_period: '24 hours',
      pests: 'Bollworm, aphids, armyworm, cutworm',
      note_to_physician: 'Pyrethroid. Treat symptomatically.',
      status: 'draft',
    },
  ]

  await insert('products', products, { skipIfExists: true })

  // Fetch actual product IDs from DB (in case insert was skipped, IDs differ from generated ones)
  const dbProducts = await request('GET', '/rest/v1/products?select=id,product_name&order=product_name')
  const dbProductMap = {}
  for (const p of dbProducts.body || []) dbProductMap[p.product_name] = p.id
  for (let i = 0; i < products.length; i++) {
    if (dbProductMap[products[i].product_name]) productIds[i] = dbProductMap[products[i].product_name]
  }

  console.log(`  ✓ ${products.length} products\n`)

  // ── 6. Product crops ──────────────────────────────────────────────────────────
  console.log('Creating product crops...')
  const crops = [
    { product_id: productIds[0], crop: 'Rice',          pests: 'Barnyardgrass, sprangletop' },
    { product_id: productIds[0], crop: 'Corn',          pests: 'Broadleaf weeds' },
    { product_id: productIds[1], crop: 'Cabbage',       pests: 'Diamondback moth larvae' },
    { product_id: productIds[1], crop: 'Tomato',        pests: 'Armyworm, thrips' },
    { product_id: productIds[2], crop: 'Potato',        pests: 'Late blight' },
    { product_id: productIds[2], crop: 'Tomato',        pests: 'Early blight, late blight' },
    { product_id: productIds[2], crop: 'Cucumber',      pests: 'Downy mildew' },
    { product_id: productIds[3], crop: 'Rice',          pests: 'Stem borer, BPH' },
    { product_id: productIds[4], crop: 'Rice',          pests: 'Blast disease' },
    { product_id: productIds[5], crop: 'Rice',          pests: 'BPH, green leafhopper' },
    { product_id: productIds[5], crop: 'Eggplant',      pests: 'Whitefly, aphids' },
    { product_id: productIds[6], crop: 'Mango',         pests: 'Anthracnose' },
    { product_id: productIds[6], crop: 'Banana',        pests: 'Black sigatoka' },
    { product_id: productIds[7], crop: 'Sugarcane',     pests: 'Annual weeds' },
    { product_id: productIds[8], crop: 'Rice',          pests: 'Sheath blight' },
    { product_id: productIds[9], crop: 'Tomato',        pests: 'Pythium, Phytophthora' },
    { product_id: productIds[10], crop: 'Pechay',       pests: 'Spider mites' },
    { product_id: productIds[11], crop: 'Cotton',       pests: 'Bollworm' },
    { product_id: productIds[11], crop: 'Corn',         pests: 'Armyworm, aphids' },
  ]
  await insert('product_crops', crops, { skipIfExists: true })
  console.log('  ✓ product crops\n')

  // ── 7. Containers ─────────────────────────────────────────────────────────────
  console.log('Creating containers...')

  // Each container needs a unique hmac + hmac_suffix (16-char hex)
  function fakeHmac()   { return Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('') }
  function fakeHmacSfx(){ return Array.from({length: 16}, () => Math.floor(Math.random()*16).toString(16)).join('') }

  const containerRows = []

  // Helpers to add batches
  const addContainers = (productIdx, dealerIdx, count, state, opts = {}) => {
    for (let i = 0; i < count; i++) {
      const id = uuid()
      containerRows.push({
        id,
        product_id: productIds[productIdx],
        hmac: fakeHmac(),
        hmac_suffix: fakeHmacSfx(),
        batch_number: `B${String(2024 + (productIdx % 2)).slice(2)}-${String(productIdx + 1).padStart(3,'0')}-${String(i + 1).padStart(4,'0')}`,
        manufacture_date: dateStr(-1, -(productIdx % 6)),
        state,
        dealer_id: state !== 'in_distribution' && dealerIdx >= 0 ? actualDealerAccountIds[dealerIdx] : actualDealerAccountIds[dealerIdx % actualDealerAccountIds.length],
        ...(state === 'purchased' || state === 'returned' || state === 'rewards_paid' ? {
          purchased_by_user_id: farmerIds[i % farmerIds.length],
          purchased_at: daysAgo(10 + i * 3),
        } : {}),
        ...(state === 'returned' || state === 'rewards_paid' ? {
          returned_by_user_id: farmerIds[i % farmerIds.length],
          returned_at: daysAgo(5 + i * 2),
          return_dealer_id: actualDealerAccountIds[dealerIdx % actualDealerAccountIds.length],
        } : {}),
        ...(state === 'rewards_paid' ? {
          rewards_paid_at: daysAgo(3 + i),
        } : {}),
        ...opts,
      })
    }
  }

  // Product 0 (GlyphoMax) — mostly in_distribution + some purchased
  addContainers(0, 0, 8, 'in_distribution')
  addContainers(0, 0, 4, 'purchased')
  addContainers(0, 1, 3, 'returned')
  addContainers(0, 0, 2, 'rewards_paid')

  // Product 1 (Cyperkill) — mixed states
  addContainers(1, 1, 6, 'in_distribution')
  addContainers(1, 1, 3, 'purchased')
  addContainers(1, 2, 2, 'rewards_paid')

  // Product 2 (Mancozeb)
  addContainers(2, 2, 5, 'in_distribution')
  addContainers(2, 0, 2, 'purchased')

  // Product 3 (Chlorpyrifos — suspended) — mostly purchased/returned
  addContainers(3, 0, 2, 'purchased')
  addContainers(3, 1, 3, 'returned')

  // Product 4 (Tricyclazole)
  addContainers(4, 1, 7, 'in_distribution')
  addContainers(4, 1, 2, 'purchased')

  // Product 5 (Imidacloprid)
  addContainers(5, 2, 5, 'in_distribution')
  addContainers(5, 0, 3, 'rewards_paid')

  // Product 6 (Azoxystrobin)
  addContainers(6, 0, 4, 'in_distribution')
  addContainers(6, 1, 1, 'purchased')

  // Product 8 (Propiconazole)
  addContainers(8, 2, 3, 'in_distribution')

  // Product 10 (Abamectin)
  addContainers(10, 0, 3, 'in_distribution')
  addContainers(10, 1, 2, 'purchased')

  await insert('containers', containerRows)
  console.log(`  ✓ ${containerRows.length} containers\n`)

  // ── 8. Scan attempts ──────────────────────────────────────────────────────────
  console.log('Creating scan attempts...')

  // Grab a spread of container IDs
  const getContainerIds = (n) => containerRows.slice(0, n).map(c => c.id)
  const cIds = getContainerIds(30)

  const scanAttempts = []

  const outcomes_success = ['success']
  const outcomes_fail    = ['hmac_invalid', 'state_mismatch', 'already_claimed', 'fpa_blocked', 'window_expired']

  for (let i = 0; i < 60; i++) {
    const isSuccess = i % 4 !== 0
    const step = ['purchase_dealer', 'purchase_farmer', 'return_dealer', 'return_farmer'][i % 4]
    const outcome = isSuccess ? 'success' : outcomes_fail[i % outcomes_fail.length]
    const actorType = step.includes('dealer') ? 'dealer' : 'farmer'
    const actorId = actorType === 'dealer'
      ? dealerUserIds[i % dealerUserIds.length]
      : farmerIds[i % farmerIds.length]

    scanAttempts.push({
      container_id: cIds[i % cIds.length],
      actor_id: actorId,
      actor_type: actorType,
      step,
      outcome,
      hmac_valid: outcome !== 'hmac_invalid',
      auth_valid: true,
      ip_address: `192.168.${10 + (i % 10)}.${100 + (i % 50)}`,
      local_scan_ts: daysAgo(i % 30),
      sync_ts: daysAgo(i % 30),
      device_id: `device-${String(actorId).slice(0, 8)}-${i % 3}`,
    })
  }

  await insert('scan_attempts', scanAttempts)
  console.log(`  ✓ ${scanAttempts.length} scan attempts\n`)

  // ── 9. Wallets ────────────────────────────────────────────────────────────────
  console.log('Creating wallets...')

  const allUserIds = [...farmerIds, ...dealerUserIds]
  const walletBalances = [1250, 840, 2100, 350, 560, 9800, 3200, 750]

  const walletRows = allUserIds.map((user_id, i) => ({
    user_id,
    balance_points: walletBalances[i] ?? 100,
  }))
  await insert('wallets', walletRows, { skipIfExists: true })
  console.log('  ✓ wallets\n')

  // ── 10. Wallet transactions ───────────────────────────────────────────────────
  console.log('Creating wallet transactions...')

  const txReasons = ['farmer_return_reward', 'dealer_return_reward', 'voucher_redemption', 'manual_adjustment']
  const walletTxRows = []

  for (let i = 0; i < 40; i++) {
    const userId = allUserIds[i % allUserIds.length]
    const reason = txReasons[i % txReasons.length]
    const isDr    = reason === 'voucher_redemption'
    walletTxRows.push({
      user_id: userId,
      delta: isDr ? -500 * (1 + (i % 4)) : 100 * (1 + (i % 5)),
      reason,
      created_at: daysAgo(i % 25),
    })
  }

  await insert('wallet_transactions', walletTxRows)
  console.log('  ✓ wallet transactions\n')

  // ── 11. Vouchers ──────────────────────────────────────────────────────────────
  console.log('Creating vouchers...')

  const denoms = ['PHP_50', 'PHP_100', 'PHP_200', 'PHP_500']
  const voucherRows = []

  for (let i = 0; i < 20; i++) {
    const userId  = farmerIds[i % farmerIds.length]
    const denom   = denoms[i % denoms.length]
    const expired = i > 14
    const redeemed = i < 8
    const expiresAt = expired
      ? new Date(Date.now() - (i - 14) * 86400000 * 5).toISOString()
      : new Date(Date.now() + 90 * 86400000).toISOString()

    voucherRows.push({
      user_id: userId,
      denomination: denom,
      expires_at: expiresAt,
      ...(redeemed ? {
        redeemed_at: daysAgo(i * 2 + 1),
        redeemed_by: dealerUserIds[i % dealerUserIds.length],
      } : {}),
    })
  }

  await insert('vouchers', voucherRows)
  console.log('  ✓ vouchers\n')

  // ── 12. OCR jobs ──────────────────────────────────────────────────────────────
  console.log('Creating OCR jobs...')

  const ocrJobs = [
    {
      user_id: ADMIN_USER_ID, status: 'completed',
      image_url: 'https://placehold.co/800x600.png',
      result: { product_name: 'GlyphoMax 480 SL', active_ingredient: 'Glyphosate', concentration: '480 g/L', confidence: 0.92 },
      attempt_count: 1,
      started_at: daysAgo(3), completed_at: daysAgo(3),
    },
    {
      user_id: ADMIN_USER_ID, status: 'completed',
      image_url: 'https://placehold.co/800x600.png',
      result: { product_name: 'Cyperkill 25 EC', active_ingredient: 'Cypermethrin', concentration: '25 g/L', confidence: 0.88 },
      attempt_count: 1,
      started_at: daysAgo(5), completed_at: daysAgo(5),
    },
    {
      user_id: ADMIN_USER_ID, status: 'failed',
      image_url: 'https://placehold.co/800x600.png',
      result: null, error_code: 'LOW_CONFIDENCE',
      attempt_count: 3,
      started_at: daysAgo(7), completed_at: daysAgo(7),
    },
    {
      user_id: ADMIN_USER_ID, status: 'queued',
      image_url: 'https://placehold.co/800x600.png',
      attempt_count: 0,
    },
  ]
  await insert('ocr_jobs', ocrJobs)
  console.log('  ✓ OCR jobs\n')

  // ── 13. Reward config update ──────────────────────────────────────────────────
  console.log('Updating reward config...')
  const rcR = await request('PATCH', `/rest/v1/reward_config?id=eq.1`, {
    farmer_points_per_return: 100,
    dealer_points_per_return: 50,
    voucher_cost_php_50: 500,
    voucher_cost_php_100: 1000,
    voucher_cost_php_200: 2000,
    voucher_cost_php_500: 5000,
    updated_by: ADMIN_USER_ID,
  })
  console.log(`  ✓ reward config (status: ${rcR.status})\n`)

  console.log('✅  Seed complete!')
  console.log('\nTest users created:')
  console.log('  Farmers:  juan.delacruz@gmail.com / Farmer2026!')
  console.log('  Dealer:   roberto.mendoza@sunshineagri.ph / Dealer2026!')
  console.log('  Brand:    james.buenaventura@agrotech.ph / Brand2026!')
  console.log('  Admin:    admin@gaia.ph / GaiaAdmin2026!')
}

main().catch(e => { console.error('Seed failed:', e.message); process.exit(1) })
