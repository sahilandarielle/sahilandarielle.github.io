// Password Protection
(async function() {
	const passwordOverlay = document.getElementById('password-overlay');
	const passwordForm = document.getElementById('password-form');
	const passwordInput = document.getElementById('password-input');
	const passwordError = document.getElementById('password-error');

	// SHA-256 hash for password verification
	const actualCorrectHash = 'b370de14e94142d4a108a79df6d0e265a0ba3fa2e10f57c4b3a892b74c9f84aa';

	// Check if already authenticated
	if (sessionStorage.getItem('weddingAuth') === actualCorrectHash) {
		passwordOverlay.classList.add('hidden');
		return;
	}

	// Hash the input password
	async function hashPassword(password) {
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	}

	// Handle form submission
	passwordForm.addEventListener('submit', async function(e) {
		e.preventDefault();
		passwordError.textContent = '';

		const enteredPassword = passwordInput.value.trim();
		if (!enteredPassword) {
			passwordError.textContent = 'Please enter a password';
			return;
		}

		const enteredHash = await hashPassword(enteredPassword);

		if (enteredHash === actualCorrectHash) {
			// Correct password
			sessionStorage.setItem('weddingAuth', actualCorrectHash);
			passwordOverlay.classList.add('hidden');
		} else {
			// Incorrect password
			passwordError.textContent = 'Incorrect password. Please try again.';
			passwordInput.value = '';
			passwordInput.focus();
		}
	});

	// Focus input on load
	passwordInput.focus();
})();

// Carousel Modal
document.addEventListener('DOMContentLoaded', function() {
	const carouselModal = document.getElementById('carousel-modal');
	const closeModalBtn = document.querySelector('.close-carousel-modal');
	const modalImagesContainer = document.querySelector('.modal-carousel-images');
	const modalTrack = document.querySelector('.modal-carousel-track');
	const modalDotsContainer = document.querySelector('.modal-carousel-dots');
	const prevBtn = carouselModal.querySelector('.carousel-btn.prev');
	const nextBtn = carouselModal.querySelector('.carousel-btn.next');

	let currentIndex = 0;
	let currentImages = [];
	let isDragging = false;
	let startX = 0;
	let currentTranslate = 0;
	let prevTranslate = 0;
	let startTime = 0;
	let containerWidth = 0;
	let scale = 1;
	let isZoomed = false;
	let lastTouchDistance = 0;
	let translateX = 0;
	let translateY = 0;
	let lastTapTime = 0;

	// Define image sets for each event
	const eventImages = {
		'haldi': [
			'/images/wedding/outfits/1.jpg',
			'/images/wedding/outfits/2.jpg',
			'/images/wedding/outfits/3.jpg'
		],
		'garba': [
			'/images/wedding/outfits/4.jpg',
			'/images/wedding/outfits/5.jpg',
			'/images/wedding/outfits/6.jpg'
		],
		'indian-ceremony': [
			'/images/wedding/outfits/7.jpg',
			'/images/wedding/outfits/8.jpg',
			'/images/wedding/outfits/9.jpg'
		],
		'american-ceremony': [
			'/images/wedding/outfits/10.jpg',
			'/images/wedding/outfits/11.jpg',
			'/images/wedding/outfits/12.jpg'
		]
	};

	// Open modal when clicking outfit example buttons
	const outfitBtns = document.querySelectorAll('.outfit-examples-btn');
	outfitBtns.forEach(btn => {
		btn.addEventListener('click', function(e) {
			e.stopPropagation();
			const event = this.getAttribute('data-event');
			openCarouselModal(event);
		});
	});

	function openCarouselModal(event) {
		currentImages = eventImages[event] || [];
		if (currentImages.length === 0) return;

		currentIndex = 0;
		populateCarousel();
		carouselModal.classList.add('active');
		document.body.style.overflow = 'hidden';

		// Wait for modal to render before getting dimensions
		setTimeout(() => {
			containerWidth = modalImagesContainer.offsetWidth;
			setImageWidths();
			updateCarouselPosition();
		}, 50);
	}

	function populateCarousel() {
		// Clear existing content
		modalTrack.innerHTML = '';
		modalDotsContainer.innerHTML = '';

		// Add images
		currentImages.forEach((src, index) => {
			const img = document.createElement('img');
			img.src = src;
			img.alt = `Outfit example ${index + 1}`;
			img.classList.add('modal-carousel-image');
			img.draggable = false; // Prevent default image drag
			modalTrack.appendChild(img);
		});

		// Create dots
		currentImages.forEach((_, index) => {
			const dot = document.createElement('span');
			dot.classList.add('modal-carousel-dot');
			if (index === 0) dot.classList.add('active');
			dot.addEventListener('click', () => goToSlide(index));
			modalDotsContainer.appendChild(dot);
		});
	}

	function setImageWidths() {
		const images = modalTrack.querySelectorAll('.modal-carousel-image');
		images.forEach(img => {
			img.style.width = `${containerWidth}px`;
		});
	}

	function updateCarouselPosition() {
		const dots = modalDotsContainer.querySelectorAll('.modal-carousel-dot');
		dots.forEach((dot, index) => {
			dot.classList.toggle('active', index === currentIndex);
		});

		const targetTranslate = -currentIndex * containerWidth;
		modalTrack.style.transform = `translateX(${targetTranslate}px)`;
		prevTranslate = targetTranslate;
		currentTranslate = targetTranslate;
	}

	function goToSlide(index) {
		if (index >= 0 && index < currentImages.length) {
			resetZoom();
			currentIndex = index;
			updateCarouselPosition();
		}
	}

	function resetZoom() {
		scale = 1;
		translateX = 0;
		translateY = 0;
		isZoomed = false;
		const images = modalTrack.querySelectorAll('.modal-carousel-image');
		images.forEach(img => {
			img.style.transform = 'scale(1) translate(0, 0)';
			img.classList.remove('zoomed');
		});
	}

	function applyZoom(img) {
		img.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
	}

	function getCurrentImage() {
		return modalTrack.querySelectorAll('.modal-carousel-image')[currentIndex];
	}

	function nextSlide() {
		if (currentIndex < currentImages.length - 1) {
			resetZoom();
			currentIndex++;
			updateCarouselPosition();
		}
	}

	function prevSlide() {
		if (currentIndex > 0) {
			resetZoom();
			currentIndex--;
			updateCarouselPosition();
		}
	}

	prevBtn.addEventListener('click', prevSlide);
	nextBtn.addEventListener('click', nextSlide);

	// Drag/swipe functionality
	function getTouchDistance(e) {
		if (e.touches.length < 2) return 0;
		const touch1 = e.touches[0];
		const touch2 = e.touches[1];
		return Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
	}

	function touchStart(e) {
		// Handle pinch zoom
		if (e.touches && e.touches.length === 2) {
			lastTouchDistance = getTouchDistance(e);
			return;
		}

		isDragging = true;
		startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
		startTime = Date.now();

		if (!isZoomed) {
			modalTrack.classList.add('dragging');
		}
	}

	function touchMove(e) {
		// Handle pinch zoom
		if (e.touches && e.touches.length === 2) {
			e.preventDefault();
			const touchDistance = getTouchDistance(e);
			if (lastTouchDistance > 0) {
				const delta = touchDistance - lastTouchDistance;
				scale += delta * 0.01;
				scale = Math.max(1, Math.min(4, scale)); // Limit between 1x and 4x

				const img = getCurrentImage();
				if (scale > 1) {
					isZoomed = true;
					img.classList.add('zoomed');
				} else {
					isZoomed = false;
					scale = 1;
					translateX = 0;
					translateY = 0;
					img.classList.remove('zoomed');
				}
				applyZoom(img);
			}
			lastTouchDistance = touchDistance;
			return;
		}

		if (!isDragging) return;

		const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
		const diff = currentX - startX;

		if (isZoomed) {
			// Pan the zoomed image
			const img = getCurrentImage();
			translateX += diff / scale;
			translateY = 0; // Only allow horizontal pan
			applyZoom(img);
			startX = currentX;
		} else {
			// Swipe between images
			currentTranslate = prevTranslate + diff;

			// Apply resistance at edges
			const maxTranslate = 0;
			const minTranslate = -(currentImages.length - 1) * containerWidth;

			if (currentTranslate > maxTranslate) {
				currentTranslate = maxTranslate + (currentTranslate - maxTranslate) * 0.3;
			} else if (currentTranslate < minTranslate) {
				currentTranslate = minTranslate + (currentTranslate - minTranslate) * 0.3;
			}

			modalTrack.style.transform = `translateX(${currentTranslate}px)`;
		}
	}

	function touchEnd(e) {
		lastTouchDistance = 0;

		if (!isDragging) return;

		isDragging = false;
		modalTrack.classList.remove('dragging');

		if (isZoomed) {
			// Don't change slides when zoomed
			return;
		}

		const movedBy = currentTranslate - prevTranslate;
		const timeDiff = Date.now() - startTime;
		const velocity = Math.abs(movedBy) / timeDiff;

		// Determine if we should change slide
		const threshold = containerWidth * 0.25; // 25% of container width
		const velocityThreshold = 0.5;

		if (Math.abs(movedBy) > threshold || velocity > velocityThreshold) {
			if (movedBy < 0 && currentIndex < currentImages.length - 1) {
				currentIndex++;
			} else if (movedBy > 0 && currentIndex > 0) {
				currentIndex--;
			}
		}

		updateCarouselPosition();
	}

	// Double-click/tap to zoom
	modalImagesContainer.addEventListener('click', function(e) {
		const now = Date.now();
		const timeSinceLastTap = now - lastTapTime;
		lastTapTime = now;

		// Double-click/tap detected
		if (timeSinceLastTap < 300 && timeSinceLastTap > 0) {
			const img = getCurrentImage();
			if (isZoomed) {
				// Zoom out
				resetZoom();
			} else {
				// Zoom in
				scale = 2;
				isZoomed = true;
				img.classList.add('zoomed');
				applyZoom(img);
			}
		}
	});

	// Touch events
	modalImagesContainer.addEventListener('touchstart', touchStart, { passive: false });
	modalImagesContainer.addEventListener('touchmove', touchMove, { passive: false });
	modalImagesContainer.addEventListener('touchend', touchEnd);

	// Mouse events for desktop
	modalImagesContainer.addEventListener('mousedown', touchStart);
	modalImagesContainer.addEventListener('mousemove', touchMove);
	modalImagesContainer.addEventListener('mouseup', touchEnd);
	modalImagesContainer.addEventListener('mouseleave', function() {
		if (isDragging) touchEnd();
	});

	// Close modal
	function closeCarouselModal() {
		resetZoom();
		carouselModal.classList.remove('active');

		// Small delay before restoring body scroll to prevent event propagation issues
		setTimeout(function() {
			document.body.style.overflow = 'auto';
		}, 100);
	}

	// Handle all clicks on the modal
	carouselModal.addEventListener('click', function(e) {
		// Always prevent propagation to article modal
		e.stopPropagation();

		// Check if clicking close button or background
		if (e.target === closeModalBtn || e.target === carouselModal) {
			closeCarouselModal();
		}
	});

	document.addEventListener('keydown', function(e) {
		if (e.key === 'Escape' && carouselModal.classList.contains('active')) {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			closeCarouselModal();
		}
	}, true);
});

// Lightbox
document.addEventListener('DOMContentLoaded', function() {
	const lightbox = document.getElementById('lightbox');
	const lightboxImg = document.getElementById('lightbox-img');
	const closeLightbox = document.querySelector('.close-lightbox');
	const galleryImages = document.querySelectorAll('.gallery img');

	// Add click listeners to all gallery images
	galleryImages.forEach(function(img) {
		img.style.cursor = 'pointer';
		img.addEventListener('click', function() {
			lightboxImg.src = this.src;
			lightboxImg.alt = this.alt;
			lightbox.classList.add('active');
			document.body.style.overflow = 'hidden'; // Prevent background scrolling
		});
	});

	// Close lightbox when clicking the close button
	closeLightbox.addEventListener('click', function(e) {
		e.stopPropagation(); // Prevent event from bubbling up to article modal
		closeLightboxFunction();
	});

	// Close lightbox when clicking the background (but prevent closing the gallery modal)
	lightbox.addEventListener('click', function(e) {
		if (e.target === lightbox) {
			e.stopPropagation(); // Prevent event from bubbling up to gallery modal
			closeLightboxFunction();
		}
	});

	// Prevent lightbox content from closing when clicked
	lightboxImg.addEventListener('click', function(e) {
		e.stopPropagation();
	});

	// Close lightbox with ESC key
	document.addEventListener('keydown', function(e) {
		if (e.key === 'Escape' && lightbox.classList.contains('active')) {
			closeLightboxFunction();
		}
	});

	function closeLightboxFunction() {
		lightbox.classList.remove('active');
		document.body.style.overflow = 'auto'; // Restore background scrolling
	}
});
