// Builds assets/data/rsvp-data.json and assets/data/photo-groups.json from
// assets/wedding_guest_list_final.csv.
//
// Each guest's RSVP record is AES-256-GCM encrypted with a key derived from
// their normalized name, and holds the guest's whole party (household). The
// published JSON therefore exposes no names, emails, or RSVP details; a
// record can only be decrypted by someone who knows a guest's exact name.
// Guests who share a full name get an "ambiguous" stub under the bare name
// (the page then asks for the spouse's name) with the real record keyed by
// name + each other household member's name.
//
// Photo group records (for wedding/photo-groups, the QR-code page on printed
// programs) are keyed by name alone and hold the guest's group number plus
// the names in that group. They're built from a "Photo Group" column (any
// header matching /photo\s*group/i); until that column exists in the CSV,
// photo-groups.json is written with no entries and the page says groups
// haven't been assigned yet. A cell may list several comma-separated groups
// ("2, 4") for immediate family who appear in more than one photo; those
// records carry a `gs` array (one {g, m} per group) instead of the single
// g/m pair, and "all" (the couple, in every photo) stays a special record
// with no member list.
//
// Usage: node scripts/build-rsvp-data.mjs [csvPath]
// Re-run whenever the CSV changes. The CSV itself is gitignored — never
// commit or deploy it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, createCipheriv } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), 'Downloads', 'Wedding Guest List.csv');
const OUT_PATH = join(ROOT, 'assets', 'data', 'rsvp-data.json');
const PG_OUT_PATH = join(ROOT, 'assets', 'data', 'photo-groups.json');

// --- CSV parsing (handles quoted fields with embedded newlines) ---

function parseCsv(text) {
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
	const rows = [];
	let row = [], field = '', inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') { field += '"'; i++; }
				else inQuotes = false;
			} else field += c;
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field); field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field); field = '';
			if (row.length > 1 || row[0] !== '') rows.push(row);
			row = [];
		} else field += c;
	}
	if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
	return rows;
}

// --- Normalization (must match the client logic in assets/js/wedding.js) ---

function normName(s) {
	return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
		.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// --- Crypto helpers ---

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest();

// prefix 'sa-rsvp' + secret 'name|email' → RSVP entries (matches wedding.js);
// prefix 'sa-pg' + secret 'name' → photo group entries (matches photo-groups.js).
function encryptEntry(prefix, secret, plaintext) {
	const id = sha256(`${prefix}-id-v1|${secret}`).toString('hex').slice(0, 16);
	const key = sha256(`${prefix}-key-v1|${secret}`);
	// Deterministic IV keeps rebuilds diff-friendly; safe because each
	// (key, plaintext) pair is unique per guest.
	const iv = sha256(`${prefix}-iv-v1|${id}|${plaintext}`).subarray(0, 12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
	return { id, iv: iv.toString('base64'), ct: ct.toString('base64') };
}

// --- Guest list processing ---

const EVENTS = [
	{ col: 'RSVP Mehndi', key: 'mehndi', label: 'Mehndi (Thursday)' },
	{ col: 'RSVP Haldi', key: 'haldi', label: 'Grah Shanti & Haldi (Friday morning)' },
	{ col: 'RSVP Garba', key: 'garba', label: 'Garba (Friday evening)' },
	{ col: 'RSVP Indian', key: 'indian', label: 'Jaan Prasthaan & Hindu Ceremony (Saturday morning)' },
	{ col: 'RSVP Reception', key: 'reception', label: 'American Ceremony & Reception (Saturday evening)' },
];

const INVITE_SETS = {
	'All Events': ['mehndi', 'haldi', 'garba', 'indian', 'reception'],
	'Haldi + Garba + Wedding': ['haldi', 'garba', 'indian', 'reception'],
	'Garba + Wedding': ['garba', 'indian', 'reception'],
	'India Invite': ['garba', 'indian', 'reception'],
};

function statusOf(raw) {
	const v = raw.trim();
	if (v === 'Attending') return 'yes';
	if (v === 'Not Attending') return 'no';
	if (v === 'Not Invited') return null; // hidden
	if (v === 'Unanswered' || v === '') return 'pending';
	console.warn(`  ! Unknown RSVP status "${v}" — treating as no response`);
	return 'pending';
}

const csv = parseCsv(readFileSync(CSV_PATH, 'utf8'));
const header = csv[0];
const col = (name) => {
	const i = header.indexOf(name);
	if (i === -1) throw new Error(`Missing CSV column: ${name}`);
	return i;
};
const iName = col('Name'), iInvite = col('Wedding Invite');
const iAddress = col('Address'), iAddressedTo = col('Addressed To');
const iAllergies = col('Allergies');
const eventCols = EVENTS.map((e) => ({ ...e, i: col(e.col) }));

// Group rows into households: a row continues the previous household when its
// Address or Addressed To column is the ditto mark.
const households = [];
for (const row of csv.slice(1)) {
	const name = (row[iName] || '').trim();
	if (!name) continue;
	const cont = row[iAddress]?.trim() === '↑' || row[iAddressedTo]?.trim() === '↑';
	if (!cont || households.length === 0) households.push([]);
	households[households.length - 1].push(row);
}

const entries = {};
const rsvpOwners = {}; // secret -> plaintext, collision guard
let people = 0, ambiguous = 0;

const addRsvpEntry = (secret, plaintext) => {
	if (secret in rsvpOwners) {
		if (rsvpOwners[secret] !== plaintext)
			console.warn(`  ! RSVP: lookup collision on "${secret}" — keeping the first record.`);
		return;
	}
	rsvpOwners[secret] = plaintext;
	const { id, iv, ct } = encryptEntry('sa-rsvp', secret, plaintext);
	entries[id] = { iv, ct };
};

// Count how many guests share each normalized name (shared names need the
// spouse-name disambiguation flow).
const nameCounts = new Map();
for (const hh of households) {
	for (const row of hh) {
		const n = normName(row[iName].trim());
		nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
	}
}

for (const hh of households) {
	const hhNames = hh.map((r) => r[iName].trim());

	// Summarize every member first: each member's encrypted record carries
	// the whole party (`p`) with `si` marking which member looked it up.
	const party = hh.map((row) => {
		const displayName = row[iName].trim();
		const invite = (row[iInvite] || '').trim();
		let invited = INVITE_SETS[invite];
		if (!invited) {
			console.warn(`  ! Unknown invite type "${invite}" for ${displayName} — inferring from statuses`);
			invited = eventCols.map((e) => e.key);
		}
		const events = [];
		for (const e of eventCols) {
			if (!invited.includes(e.key)) continue;
			const status = statusOf(row[e.i] || '');
			if (status !== null) events.push([e.label, status]);
		}
		return { n: displayName, e: events, a: (row[iAllergies] || '').trim() };
	});

	hh.forEach((row, si) => {
		const displayName = party[si].n;
		const name = normName(displayName);
		people++;

		const record = JSON.stringify({ si, p: party });
		if (nameCounts.get(name) === 1) {
			addRsvpEntry(name, record);
		} else {
			// Shared name: the bare name resolves to a stub that makes the
			// page ask for the spouse's/household member's name.
			ambiguous++;
			addRsvpEntry(name, JSON.stringify({ n: displayName, a: 1 }));
			const others = hhNames.filter((n2) => n2 !== displayName);
			if (!others.length)
				console.warn(`  ! RSVP: "${displayName}" shares a name but has no household members to disambiguate with — record unreachable.`);
			for (const other of others) addRsvpEntry(`${name}|${normName(other)}`, record);
			console.warn(`  ! RSVP: "${displayName}" shares a name — unlockable with: ${others.join(', ') || 'nobody'}`);
		}
	});
}

const out = { v: 1, entries: Object.fromEntries(Object.entries(entries).sort()) };
mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(out));

// --- Photo groups (name-only lookup for the QR page on printed programs) ---

const iPhotoGroup = header.findIndex((h) => /photo\s*group/i.test(h));
const pgEntries = {};
let pgGuests = 0;
const groups = new Map(); // group value -> [display names]

if (iPhotoGroup !== -1) {
	// Collect grouped guests along with their household members, which are
	// used to disambiguate guests who share a full name.
	const grouped = [];
	for (const hh of households) {
		const hhNames = hh.map((r) => r[iName].trim());
		for (const row of hh) {
			const cell = (row[iPhotoGroup] || '').trim();
			if (!cell) continue;
			const displayName = row[iName].trim();
			if (!eventCols.some((e) => (row[e.i] || '').trim() === 'Attending'))
				console.warn(`  ! Photo group ${cell}: "${displayName}" isn't attending any event — stale assignment? They'll still show in group listings.`);
			const gs = [...new Set(cell.split(',').map((s) => s.trim()).filter(Boolean))]
				.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
			for (const g of gs) {
				if (!groups.has(g)) groups.set(g, []);
				groups.get(g).push(displayName);
			}
			grouped.push({ displayName, name: normName(displayName), gs, others: hhNames.filter((n) => n !== displayName) });
		}
	}

	const nameCounts = new Map();
	for (const x of grouped) nameCounts.set(x.name, (nameCounts.get(x.name) || 0) + 1);

	const pgOwners = {}; // secret -> plaintext, collision guard
	const addEntry = (secret, plaintext) => {
		if (secret in pgOwners) {
			if (pgOwners[secret] !== plaintext)
				console.warn(`  ! Photo group: lookup collision on "${secret}" — keeping the first record.`);
			return;
		}
		pgOwners[secret] = plaintext;
		const { id, iv, ct } = encryptEntry('sa-pg', secret, plaintext);
		pgEntries[id] = { iv, ct };
	};

	for (const x of grouped) {
		// "all" marks people (the couple) who appear in every photo group;
		// they get a special record with no member list. Guests in a single
		// group keep the original {g, m} shape; immediate family listed in
		// several groups get a `gs` array with each group's roster.
		let record;
		if (x.gs.length === 1 && /^all$/i.test(x.gs[0])) {
			record = JSON.stringify({ n: x.displayName, g: 'all', m: [] });
		} else if (x.gs.length === 1) {
			record = JSON.stringify({ n: x.displayName, g: x.gs[0], m: groups.get(x.gs[0]) });
		} else {
			record = JSON.stringify({ n: x.displayName, gs: x.gs.map((g) => ({ g, m: groups.get(g) })) });
		}
		if (nameCounts.get(x.name) === 1) {
			addEntry(x.name, record);
		} else {
			// Shared name: the name alone resolves to a stub that makes the
			// page ask for the wife's/household member's name, and the real
			// record is keyed by name + each other household member's name.
			addEntry(x.name, JSON.stringify({ n: x.displayName, a: 1 }));
			if (!x.others.length)
				console.warn(`  ! Photo group: "${x.displayName}" shares a name but has no household members to disambiguate with — record unreachable.`);
			for (const other of x.others) addEntry(`${x.name}|${normName(other)}`, record);
			console.warn(`  ! Photo group: "${x.displayName}" (group ${x.gs.join(', ')}) shares a name — unlockable with: ${x.others.join(', ') || 'nobody'}`);
		}
		pgGuests++;
	}
}

const pgOut = { v: 1, entries: Object.fromEntries(Object.entries(pgEntries).sort()) };
writeFileSync(PG_OUT_PATH, JSON.stringify(pgOut));

console.log(`Households: ${households.length}`);
console.log(`Guests: ${people} (${ambiguous} with shared names needing spouse disambiguation)`);
console.log(`Lookup entries: ${Object.keys(entries).length}`);
console.log(`Wrote ${OUT_PATH}`);
if (iPhotoGroup === -1) {
	console.log(`No "Photo Group" column in CSV yet — wrote empty ${PG_OUT_PATH}`);
} else {
	console.log(`Photo groups: ${groups.size} groups, ${pgGuests} guests — wrote ${PG_OUT_PATH}`);
}
