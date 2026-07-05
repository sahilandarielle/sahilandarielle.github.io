// Photo Group Lookup
// Records in photo-groups.json are AES-GCM encrypted with keys derived from
// each guest's name (no email — this page is reached from a QR code on the
// printed programs). Derivation must stay in sync with
// scripts/build-rsvp-data.mjs (the 'sa-pg' prefix).
document.addEventListener('DOMContentLoaded', function() {
	const form = document.getElementById('photo-group-form');
	if (!form) return;

	const nameInput = document.getElementById('photo-group-name');
	const spouseWrap = document.getElementById('photo-group-spouse-wrap');
	const spouseInput = document.getElementById('photo-group-spouse');
	const noticeEl = document.getElementById('photo-group-notice');
	const errorEl = document.getElementById('photo-group-error');
	const resultEl = document.getElementById('photo-group-result');
	const submitBtn = form.querySelector('input[type="submit"]');

	// Set when a lookup hits an "ambiguous" stub (guests sharing a full
	// name); their record is keyed by name + a household member's name.
	let ambiguousName = null;

	let dataPromise = null;

	function loadData() {
		if (!dataPromise) {
			dataPromise = fetch('/assets/data/photo-groups.json').then(function(res) {
				if (!res.ok) throw new Error('Failed to load photo group data');
				return res.json();
			});
			dataPromise.catch(function() { dataPromise = null; });
		}
		return dataPromise;
	}

	// If groups haven't been assigned yet, say so up front instead of
	// letting every lookup fail.
	loadData().then(function(data) {
		if (Object.keys(data.entries).length === 0) {
			form.hidden = true;
			noticeEl.hidden = false;
		}
	}).catch(function() {
		// Ignore; a submit will surface the error.
	});

	function normalizeName(s) {
		return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
			.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
	}

	function base64ToBytes(b64) {
		const bin = atob(b64);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes;
	}

	function toHex(buffer) {
		return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
	}

	async function sha256(str) {
		return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
	}

	async function tryDecrypt(entries, name) {
		const id = toHex(await sha256('sa-pg-id-v1|' + name)).slice(0, 16);
		const entry = entries[id];
		if (!entry) return null;
		const keyBytes = await sha256('sa-pg-key-v1|' + name);
		const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
		try {
			const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(entry.iv) }, key, base64ToBytes(entry.ct));
			return JSON.parse(new TextDecoder().decode(plaintext));
		} catch (err) {
			return null;
		}
	}

	function delay(ms) {
		return new Promise(function(resolve) { setTimeout(resolve, ms); });
	}

	function showError(message) {
		errorEl.textContent = message;
		errorEl.classList.remove('shake');
		void errorEl.offsetWidth; // restart the animation on repeat failures
		errorEl.classList.add('shake');
	}

	function renderResult(record) {
		resultEl.innerHTML = '';

		const heading = document.createElement('h3');
		heading.className = 'minor';
		resultEl.appendChild(heading);

		const intro = document.createElement('p');
		intro.className = 'photo-group-intro';
		resultEl.appendChild(intro);

		if (record.g === 'all') {
			heading.textContent = 'All Photo Groups';
			intro.textContent = record.n + ', you\'re in every photo group!';
		} else {
			heading.textContent = /^\d/.test(record.g) ? 'Photo Group ' + record.g : record.g;
			intro.textContent = 'In this group:';

			const list = document.createElement('ul');
			list.className = 'photo-group-members';
			record.m.forEach(function(member) {
				const li = document.createElement('li');
				if (member === record.n) {
					const self = document.createElement('strong');
					self.textContent = member + ' (you)';
					li.appendChild(self);
				} else {
					li.textContent = member;
				}
				list.appendChild(li);
			});
			resultEl.appendChild(list);
		}

		resultEl.hidden = false;
		resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	async function findRecord(name) {
		const data = await loadData();
		let record = await tryDecrypt(data.entries, name);
		if (record && record.a) {
			// Shared name: retry keyed by name + wife's/household member's name.
			const spouse = normalizeName(spouseInput.value);
			if (!spouse) return record; // stub — caller reveals the second box
			record = await tryDecrypt(data.entries, name + '|' + spouse);
			return record || { a: 1, miss: true };
		}
		return record;
	}

	form.addEventListener('submit', async function(e) {
		e.preventDefault();
		errorEl.textContent = '';
		errorEl.classList.remove('shake');
		resultEl.hidden = true;

		const name = normalizeName(nameInput.value);
		if (!name) {
			showError('Please enter your full name.');
			return;
		}
		if (ambiguousName && name !== ambiguousName) {
			ambiguousName = null;
			spouseWrap.hidden = true;
			spouseInput.value = '';
		}

		submitBtn.disabled = true;
		submitBtn.value = 'Searching…';
		try {
			// Brief pause so repeat lookups visibly re-run even when instant.
			const results = await Promise.all([findRecord(name), delay(500)]);
			const record = results[0];
			if (record && record.a) {
				ambiguousName = name;
				spouseWrap.hidden = false;
				if (record.miss) {
					showError("We couldn't find a match for that combination. Double-check both names — or your group may not have been assigned yet.");
				} else {
					showError("Please also enter your wife's full name below.");
				}
				spouseInput.focus();
			} else if (record) {
				spouseWrap.hidden = true;
				spouseInput.value = '';
				ambiguousName = null;
				renderResult(record);
			} else {
				showError('No photo group found. Double-check your full name as it appeared on your invitation — or your group may not have been assigned yet.');
			}
		} catch (err) {
			showError('Something went wrong loading the photo groups. Please try again.');
		} finally {
			submitBtn.disabled = false;
			submitBtn.value = 'Find My Group';
		}
	});
});
