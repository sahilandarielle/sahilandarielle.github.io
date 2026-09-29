// Wedding Photos page
document.addEventListener('DOMContentLoaded', function() {
	// Like the photo groups page, this one is shared by direct link and has
	// no password. Seed the auth token wedding.js checks (must match
	// actualCorrectHash there) so the back link doesn't hit the password
	// prompt. Storage can throw in Safari private browsing; the guest then
	// just gets the normal password prompt.
	const backLink = document.getElementById('photos-back');
	if (backLink) {
		backLink.addEventListener('click', function() {
			try {
				localStorage.setItem('weddingAuth', 'b370de14e94142d4a108a79df6d0e265a0ba3fa2e10f57c4b3a892b74c9f84aa');
			} catch (err) {}
		});
	}
});
