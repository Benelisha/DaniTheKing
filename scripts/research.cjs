// Local operator tool: reuses Firebase CLI login; never saves or prints credentials.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const cli = path.join(execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'firebase-tools/lib');
const { configstore } = require(path.join(cli, 'configstore'));
const { requireAuth } = require(path.join(cli, 'requireAuth'));
const { clientId, clientSecret } = require(path.join(cli, 'api'));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { leadSchema, profileSchema, nameKey, normalizePhone } = require('../functions/lib/domain');
const { listingUrl } = require('../functions/lib/generation');
const { upsertLead } = require('../functions/lib/store');
const projectId = 'daniboy-be1c0';
(async () => {
  const [mode, file] = process.argv.slice(2);
  if (!['snapshot', 'import', 'enrich'].includes(mode) || !file) throw Error('Usage: node scripts/research.cjs snapshot|import <json-file>');
  // Validate the complete batch before connecting or writing.
  const rows = mode === 'import' ? leadSchema.array().min(1).max(10).parse(JSON.parse(fs.readFileSync(file, 'utf8'))) : [];
  const patches = mode === 'enrich' ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  if (mode === 'enrich') {
    if (!Array.isArray(patches) || !patches.length || patches.length > 50) throw Error('Enrichment batch must contain 1–50 profiles');
    for (const patch of patches) {
      if (!/^[a-f0-9]{32}$/.test(patch.id) || !Number.isInteger(patch.expectedVersion)) throw Error('Invalid identity/version');
      profileSchema.parse(patch.profile);
    }
  }
  if (rows.some(r => r.websiteStatus !== 'No site found' || r.competitors?.length !== 5)) throw Error('Daily imports require No site found evidence and five sourced business examples. Save incomplete candidates locally.');
  if (rows.some(r => !r.profile?.googleMapsUrl || !listingUrl(r.profile.googleMapsUrl) || r.profile.googleMapsLinkType !== 'listing' || !r.profile?.address || !r.profile?.addressNotes)) throw Error('Daily imports require sourced address or service area, address notes and a labeled Google Maps URL.');
  await requireAuth({ project: projectId, user: configstore.get('user'), tokens: configstore.get('tokens') });
  const app = initializeApp({projectId});
  try {
    const db = getFirestore(app);
    db.settings({credentials: {
      type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(),
      refresh_token: configstore.get('tokens').refresh_token,
    }});
    // Full snapshot, not a single UI page. Refresh immediately before import.
    const existing = await db.collection('leads').get();
    const leads = existing.docs.map(d => ({...d.data(), id:d.id}));
    const settings = (await db.doc('settings/discovery').get()).data();
    if (mode === 'snapshot') {
      fs.writeFileSync(file, JSON.stringify({observedAt:new Date().toISOString(), settings, leads}, null, 2), {mode:0o600});
      console.log(JSON.stringify({existing:leads.length, snapshot:file, coverage:settings?.locations, categories:settings?.categories}));
      return;
    }
    if (mode === 'enrich') {
      for (const patch of patches) {
        await db.runTransaction(async tx => {
          const ref = db.collection('leads').doc(patch.id);
          const snap = await tx.get(ref), current = snap.data();
          if (!current || current.version !== patch.expectedVersion) throw Error(`Version changed: ${patch.id}; refresh before retry`);
          const now = new Date().toISOString();
          tx.update(ref, {profile:profileSchema.parse({...current.profile, ...patch.profile}), version:current.version+1, updatedAt:now});
          tx.create(ref.collection('activity').doc(), {type:'profile_enrichment', actor:'codex-research', at:now, note:'Added sourced address details and labeled Google Maps link', fromStatus:current.callStatus, toStatus:current.callStatus});
        });
      }
      console.log(JSON.stringify({enriched:patches.length})); return;
    }
    const identities = new Set(leads.map(l => nameKey(l.businessName, l.location)));
    const phones = new Set(leads.map(l => normalizePhone(l.phone)));
    const places = new Set(leads.map(l => l.profile?.googlePlaceId).filter(Boolean));
    const today = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Recife'}).format(new Date());
    const alreadyToday = leads.filter(l => l.createdBy === 'codex-research' && l.createdAt && new Intl.DateTimeFormat('en-CA', {timeZone:'America/Recife'}).format(new Date(l.createdAt)) === today).length;
    const results = [];
    let createdToday = alreadyToday;
    for (const row of rows) {
      const phone = normalizePhone(row.phone), key = nameKey(row.businessName, row.location);
      if (phones.has(phone) || identities.has(key) || (row.profile?.googlePlaceId && places.has(row.profile.googlePlaceId))) {
        results.push({businessName:row.businessName, skipped:true, reason:'Existing phone, name/location or Maps identity'}); continue;
      }
      if (createdToday >= 10) { results.push({businessName:row.businessName, skipped:true, reason:'Daily limit reached'}); continue; }
      const result = await upsertLead(row, 'codex-research', true, true);
      if (result.created) createdToday++;
      results.push({businessName:row.businessName, ...result});
      phones.add(phone); identities.add(key);
      if (row.profile?.googlePlaceId) places.add(row.profile.googlePlaceId);
    }
    console.log(JSON.stringify({created:results.filter(r=>r.created).length, results}, null, 2));
  } finally { await deleteApp(app); }
})().catch(e => { console.error(e.message); process.exitCode=1; });
