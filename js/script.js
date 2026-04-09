(() => {
    const DEFAULT_CONFIG = {
        googlePlacesApiKey: "",
        googlePlaceId: "",
        googleMapsApiVersion: "weekly",
        reviewsApiUrl: "",
        reviewsLink: "",
        cacheDurationMs: 24 * 60 * 60 * 1000,
        refreshIntervalMs: 5 * 60 * 1000,
        maxReviews: 5,
        fallbackReviews: []
    };

    const APP_CONFIG = Object.freeze({
        ...DEFAULT_CONFIG,
        ...(window.DJ_FLOYD_CONFIG || {})
    });

    const CACHE_KEY = "djfloyd_reviews_cache_v3";
    const CACHE_TIME_KEY = "djfloyd_reviews_cache_time_v3";
    const QUOTE_EMAIL = "DJFLOYD@outlook.fr";

    const dom = {};
    let isFetching = false;
    let googleMapsLoaderPromise = null;

    document.addEventListener("DOMContentLoaded", () => {
        dom.navToggle = document.querySelector(".nav-toggle");
        dom.navMenu = document.querySelector(".nav-menu");
        dom.navLinks = Array.from(document.querySelectorAll(".nav-menu a"));
        dom.faqButtons = Array.from(document.querySelectorAll(".faq-question"));
        dom.reviewsContainer = document.querySelector("[data-reviews-container]");
        dom.reviewsStatus = document.querySelector("[data-reviews-status]");
        dom.refreshReviewsButton = document.querySelector("[data-refresh-reviews]");
        dom.leaveReviewLink = document.getElementById("leave-review-link");
        dom.quoteForm = document.getElementById("quote-form");
        dom.formStatus = document.querySelector("[data-form-status]");

        setupNavigation();
        setupFaq();
        setupQuoteForm();
        setupReviewLink();
        initGoogleReviews();
    });

    function setupNavigation() {
        if (dom.navToggle && dom.navMenu) {
            dom.navToggle.addEventListener("click", () => {
                const isOpen = dom.navMenu.classList.toggle("is-open");
                dom.navToggle.setAttribute("aria-expanded", String(isOpen));
                document.body.classList.toggle("nav-open", isOpen);
            });
        }

        document.querySelectorAll('a[href^="#"]').forEach((link) => {
            link.addEventListener("click", (event) => {
                const targetId = link.getAttribute("href");
                if (!targetId || targetId === "#") {
                    return;
                }

                const target = document.querySelector(targetId);
                if (!target) {
                    return;
                }

                event.preventDefault();
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                closeMobileMenu();
            });
        });

        const sections = Array.from(document.querySelectorAll("section[id]"));
        if (!sections.length || !dom.navLinks.length) {
            return;
        }

        const updateActiveNav = () => {
            const scrollPosition = window.scrollY + 160;
            let currentId = sections[0].id;

            sections.forEach((section) => {
                if (scrollPosition >= section.offsetTop) {
                    currentId = section.id;
                }
            });

            dom.navLinks.forEach((link) => {
                const isActive = link.getAttribute("href") === `#${currentId}`;
                link.classList.toggle("active", isActive);
            });
        };

        updateActiveNav();
        window.addEventListener("scroll", updateActiveNav, { passive: true });
        window.addEventListener("resize", updateActiveNav);
    }

    function closeMobileMenu() {
        if (!dom.navMenu || !dom.navToggle) {
            return;
        }

        dom.navMenu.classList.remove("is-open");
        dom.navToggle.setAttribute("aria-expanded", "false");
        document.body.classList.remove("nav-open");
    }

    function setupFaq() {
        dom.faqButtons.forEach((button) => {
            button.addEventListener("click", () => {
                const isExpanded = button.getAttribute("aria-expanded") === "true";
                const answer = button.nextElementSibling;

                button.setAttribute("aria-expanded", String(!isExpanded));
                if (answer) {
                    answer.hidden = isExpanded;
                }
            });
        });
    }

    function setupReviewLink() {
        if (!dom.leaveReviewLink) {
            return;
        }

        const reviewLink = APP_CONFIG.reviewsLink
            || (APP_CONFIG.googlePlaceId
                ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(APP_CONFIG.googlePlaceId)}`
                : "https://www.google.com/search?q=DJ+FLOYD+avis");

        dom.leaveReviewLink.href = reviewLink;
    }

    function setupQuoteForm() {
        if (!dom.quoteForm) {
            return;
        }

        dom.quoteForm.addEventListener("submit", (event) => {
            event.preventDefault();

            const formData = new FormData(dom.quoteForm);
            const payload = {
                nom: String(formData.get("nom") || "").trim(),
                prenom: String(formData.get("prenom") || "").trim(),
                telephone: String(formData.get("telephone") || "").trim(),
                email: String(formData.get("email") || "").trim(),
                typeEvenement: String(formData.get("type_evenement") || "").trim(),
                nombrePersonnes: String(formData.get("nombre_personnes") || "").trim()
            };

            if (Object.values(payload).some((value) => !value)) {
                setFormStatus("Merci de remplir tous les champs du formulaire.", "error");
                return;
            }

            const subject = `Demande de devis - ${payload.typeEvenement} - ${payload.prenom} ${payload.nom}`;
            const body = [
                "Bonjour,",
                "",
                "Je souhaite obtenir un devis pour un evenement.",
                "",
                `Nom : ${payload.nom}`,
                `Prenom : ${payload.prenom}`,
                `Telephone : ${payload.telephone}`,
                `Adresse mail : ${payload.email}`,
                `Type d'evenement : ${payload.typeEvenement}`,
                `Nombre de personnes estime : ${payload.nombrePersonnes}`
            ].join("\n");

            const mailtoUrl = `mailto:${QUOTE_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            window.location.href = mailtoUrl;
            setFormStatus("Votre client e-mail va s'ouvrir avec la demande pre-remplie.", "success");
        });
    }

    function initGoogleReviews() {
        if (!dom.reviewsContainer) {
            return;
        }

        if (dom.refreshReviewsButton) {
            dom.refreshReviewsButton.addEventListener("click", () => {
                fetchGoogleReviews({ force: true });
            });
        }

        fetchGoogleReviews();

        if (APP_CONFIG.refreshIntervalMs > 0) {
            window.setInterval(() => {
                fetchGoogleReviews({ force: true, silent: true });
            }, APP_CONFIG.refreshIntervalMs);
        }
    }

    async function fetchGoogleReviews({ force = false, silent = false } = {}) {
        if (isFetching || !dom.reviewsContainer) {
            return;
        }

        const cachedReviews = force ? null : getCachedReviews();
        if (cachedReviews && cachedReviews.length) {
            renderReviews(cachedReviews, {
                status: `Avis en cache mis a jour le ${formatDate(getCachedTimestamp())}.`,
                statusState: "success",
                isFallback: false
            });
            return;
        }

        isFetching = true;
        setRefreshButtonState(true);

        if (!silent) {
            renderLoadingState();
            setStatus("Chargement des avis Google...", "default");
        }

        try {
            const reviews = APP_CONFIG.reviewsApiUrl
                ? await fetchReviewsFromApi()
                : await fetchReviewsFromGooglePlaces();

            if (!reviews.length) {
                throw new Error("Aucun avis exploitable n'a ete renvoye.");
            }

            cacheReviews(reviews);
            renderReviews(reviews, {
                status: `Avis Google actualises le ${formatDate(Date.now())}.`,
                statusState: "success",
                isFallback: false
            });
        } catch (error) {
            console.error("Impossible de recuperer les avis Google.", error);

            const staleReviews = getCachedReviews();
            if (staleReviews && staleReviews.length) {
                renderReviews(staleReviews, {
                    status: "Les avis Google sont momentanement indisponibles. Version en cache affichee.",
                    statusState: "error",
                    isFallback: false
                });
            } else {
                renderFallbackReviews("Les avis Google sont momentanement indisponibles.");
            }
        } finally {
            isFetching = false;
            setRefreshButtonState(false);
        }
    }

    async function fetchReviewsFromApi() {
        const response = await fetch(APP_CONFIG.reviewsApiUrl, {
            headers: {
                Accept: "application/json"
            },
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Reponse HTTP ${response.status}`);
        }

        const payload = await parseJsonResponse(response);
        return normalizeReviews(payload).slice(0, APP_CONFIG.maxReviews);
    }

    async function fetchReviewsFromGooglePlaces() {
        if (!APP_CONFIG.googlePlacesApiKey || !APP_CONFIG.googlePlaceId) {
            throw new Error("La configuration Google Places est incomplete.");
        }

        await loadGooglePlacesLibrary();

        if (!window.google?.maps?.importLibrary) {
            throw new Error("La bibliotheque Places de Google Maps n'est pas disponible.");
        }

        const placesLibrary = await window.google.maps.importLibrary("places");
        const Place = placesLibrary.Place || window.google.maps.places?.Place;

        if (!Place) {
            throw new Error("La classe Place n'est pas disponible.");
        }

        const place = new Place({ id: APP_CONFIG.googlePlaceId });
        await place.fetchFields({
            fields: ["displayName", "googleMapsURI", "reviewsURI", "reviews", "rating"]
        });

        if (!APP_CONFIG.reviewsLink && dom.leaveReviewLink) {
            dom.leaveReviewLink.href = place.reviewsURI || place.googleMapsURI || dom.leaveReviewLink.href;
        }

        return normalizeReviews(place.reviews || []).slice(0, APP_CONFIG.maxReviews);
    }

    function loadGooglePlacesLibrary() {
        if (window.google?.maps?.importLibrary) {
            return Promise.resolve();
        }

        if (googleMapsLoaderPromise) {
            return googleMapsLoaderPromise;
        }

        googleMapsLoaderPromise = new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-google-maps-loader="true"]');
            if (existingScript) {
                existingScript.addEventListener("load", () => resolve(), { once: true });
                existingScript.addEventListener("error", () => reject(new Error("Chargement Google Maps echoue.")), { once: true });
                return;
            }

            const params = new URLSearchParams({
                key: APP_CONFIG.googlePlacesApiKey,
                libraries: "places",
                v: APP_CONFIG.googleMapsApiVersion,
                loading: "async",
                language: "fr"
            });

            const script = document.createElement("script");
            script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
            script.async = true;
            script.defer = true;
            script.dataset.googleMapsLoader = "true";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Impossible de charger Google Maps JavaScript API."));

            document.head.appendChild(script);
        });

        return googleMapsLoaderPromise;
    }

    async function parseJsonResponse(response) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            return response.json();
        }

        const text = await response.text();
        return JSON.parse(text);
    }

    function normalizeReviews(payload) {
        if (payload?.status && payload.status !== "OK") {
            throw new Error(`API Google renvoyee avec le statut ${payload.status}`);
        }

        let rawReviews = [];

        if (Array.isArray(payload)) {
            rawReviews = payload;
        } else if (Array.isArray(payload?.reviews)) {
            rawReviews = payload.reviews;
        } else if (Array.isArray(payload?.result?.reviews)) {
            rawReviews = payload.result.reviews;
        }

        return rawReviews
            .map((review) => {
                const attribution = review.authorAttribution || {};
                return {
                    author: String(attribution.displayName || review.author_name || review.author || "Client").trim(),
                    authorUrl: String(attribution.uri || review.author_url || "").trim(),
                    authorPhotoUrl: String(attribution.photoURI || "").trim(),
                    rating: clampRating(review.rating),
                    text: extractReviewText(review.text),
                    timeLabel: extractReviewTime(review)
                };
            })
            .filter((review) => review.author && review.text);
    }

    function extractReviewText(textValue) {
        if (typeof textValue === "string" && textValue.trim()) {
            return textValue.trim();
        }

        if (textValue && typeof textValue.text === "string" && textValue.text.trim()) {
            return textValue.text.trim();
        }

        return "Merci pour votre confiance.";
    }

    function extractReviewTime(review) {
        if (review.relativePublishTimeDescription) {
            return String(review.relativePublishTimeDescription).trim();
        }

        if (review.publishTime) {
            return formatDate(review.publishTime);
        }

        if (review.time) {
            return String(review.time).trim();
        }

        return "Recemment";
    }

    function clampRating(value) {
        const rounded = Math.round(Number(value) || 5);
        return Math.min(5, Math.max(1, rounded));
    }

    function renderLoadingState() {
        if (!dom.reviewsContainer) {
            return;
        }

        dom.reviewsContainer.innerHTML = "";

        const loadingCard = document.createElement("div");
        loadingCard.className = "loading-card";

        const spinner = document.createElement("div");
        spinner.className = "spinner";
        spinner.setAttribute("aria-hidden", "true");

        const message = document.createElement("p");
        message.textContent = "Chargement des avis...";

        loadingCard.append(spinner, message);
        dom.reviewsContainer.appendChild(loadingCard);
    }

    function renderReviews(reviews, { status, statusState = "default", isFallback = false } = {}) {
        if (!dom.reviewsContainer) {
            return;
        }

        dom.reviewsContainer.innerHTML = "";

        reviews.forEach((review) => {
            const card = document.createElement("article");
            card.className = "testimonial";
            card.dataset.fallback = String(isFallback);

            const stars = document.createElement("div");
            stars.className = "stars";
            stars.setAttribute("aria-label", `${review.rating} etoiles sur 5`);
            stars.textContent = `${"\u2605".repeat(review.rating)}${"\u2606".repeat(5 - review.rating)}`;

            const meta = document.createElement("div");
            meta.className = "testimonial-meta";

            if (review.authorPhotoUrl) {
                const photo = document.createElement("img");
                photo.className = "testimonial-photo";
                photo.src = review.authorPhotoUrl;
                photo.alt = "";
                photo.loading = "lazy";
                meta.appendChild(photo);
            }

            if (review.authorUrl) {
                const authorLink = document.createElement("a");
                authorLink.className = "testimonial-author testimonial-author-link";
                authorLink.href = review.authorUrl;
                authorLink.target = "_blank";
                authorLink.rel = "noreferrer";
                authorLink.textContent = review.author;
                meta.appendChild(authorLink);
            } else {
                const author = document.createElement("h3");
                author.className = "testimonial-author";
                author.textContent = review.author;
                meta.appendChild(author);
            }

            const quote = document.createElement("p");
            quote.className = "testimonial-quote";
            quote.textContent = `"${review.text}"`;

            const time = document.createElement("p");
            time.className = "testimonial-time";
            time.textContent = review.timeLabel;

            card.append(stars, meta, quote, time);
            dom.reviewsContainer.appendChild(card);
        });

        setStatus(status || "Avis disponibles.", statusState);
    }

    function renderFallbackReviews(message) {
        const fallbackReviews = Array.isArray(APP_CONFIG.fallbackReviews)
            ? APP_CONFIG.fallbackReviews.slice(0, APP_CONFIG.maxReviews)
            : [];

        if (!fallbackReviews.length) {
            dom.reviewsContainer.innerHTML = "";

            const emptyCard = document.createElement("div");
            emptyCard.className = "empty-card";
            emptyCard.textContent = "Les avis seront affiches ici des que l'integration sera active.";
            dom.reviewsContainer.appendChild(emptyCard);
            setStatus(message, "error");
            return;
        }

        renderReviews(fallbackReviews, {
            status: message,
            statusState: "error",
            isFallback: true
        });
    }

    function setStatus(message, state = "default") {
        if (!dom.reviewsStatus) {
            return;
        }

        dom.reviewsStatus.textContent = message;
        dom.reviewsStatus.dataset.state = state;
    }

    function setFormStatus(message, state = "default") {
        if (!dom.formStatus) {
            return;
        }

        dom.formStatus.textContent = message;
        dom.formStatus.dataset.state = state;
    }

    function setRefreshButtonState(isBusy) {
        if (!dom.refreshReviewsButton) {
            return;
        }

        dom.refreshReviewsButton.disabled = isBusy;
        dom.refreshReviewsButton.textContent = isBusy ? "Actualisation..." : "Actualiser";
    }

    function cacheReviews(reviews) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(reviews));
            localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
        } catch (error) {
            console.warn("Impossible d'ecrire le cache local des avis.", error);
        }
    }

    function getCachedReviews() {
        try {
            const rawReviews = localStorage.getItem(CACHE_KEY);
            const rawTimestamp = localStorage.getItem(CACHE_TIME_KEY);

            if (!rawReviews || !rawTimestamp) {
                return null;
            }

            const timestamp = Number(rawTimestamp);
            if (!timestamp || Date.now() - timestamp > APP_CONFIG.cacheDurationMs) {
                clearCache();
                return null;
            }

            const parsed = JSON.parse(rawReviews);
            return Array.isArray(parsed) ? parsed : null;
        } catch (error) {
            console.warn("Impossible de lire le cache local des avis.", error);
            clearCache();
            return null;
        }
    }

    function getCachedTimestamp() {
        try {
            return Number(localStorage.getItem(CACHE_TIME_KEY) || 0);
        } catch (error) {
            return 0;
        }
    }

    function clearCache() {
        try {
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_TIME_KEY);
        } catch (error) {
            console.warn("Impossible de nettoyer le cache local des avis.", error);
        }
    }

    function formatDate(value) {
        const date = new Date(value || Date.now());
        return date.toLocaleString("fr-FR");
    }
})();
