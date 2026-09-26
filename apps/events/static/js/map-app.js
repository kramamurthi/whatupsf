/**
 * WhatUpSF — an instrument for seeing and hearing what San Francisco is doing right now.
 *
 * This file is wiring only. Each concern lives in its own module:
 *   map viewport + selection  -> modules/map-manager.js
 *   marker language           -> modules/markers.js
 *   city time                 -> modules/city-time.js
 *   tonight's playlist        -> modules/jukebox.js
 *   the dock's DOM            -> modules/dock.js
 *   bottom sheet / loading    -> modules/ui.js
 */
import { MapManager } from './modules/map-manager.js';
import { UIManager } from './modules/ui.js';
import { CityTime, nowCityMinutes, formatClock } from './modules/city-time.js';
import { Jukebox } from './modules/jukebox.js';
import { Dock } from './modules/dock.js';
import { pickEvent, venueState } from './modules/markers.js';

const STADIA_KEY = '1ce6d341-6ad2-4e0e-a58f-9948f9f8d224';

class WhatUpSFApp {
    constructor() {
        this.ui = new UIManager();
        this.map = null;
        this.cityTime = null;
        this.jukebox = null;
        this.dock = null;
        this.venues = [];
    }

    async init() {
        this.ui.initialize();
        this.ui.showLoading('Tuning in…');

        this.map = new MapManager('map', STADIA_KEY);
        this.map.initialize();
        this.map.onSelect = (venue) => this.onVenueSelected(venue);

        this.venues = await this.fetchVenues();

        // City time first: markers need a time before they can be styled.
        this.cityTime = new CityTime({
            host: document.getElementById('city-rail'),
            onChange: () => this.onCityTimeChanged(),
        });

        this.map.loadVenueData(this.venues);
        this.map.setCityTime(this.cityTime.getMinutes());

        this.jukebox = new Jukebox({
            venues: this.venues,
            onChange: (track) => this.onTrackChanged(track),
            onPlayState: (playing) => this.dock.setPlaying(playing),
        });

        this.dock = new Dock({
            host: document.getElementById('dock'),
            handlers: {
                onPrev: () => this.jukebox.previous(),
                onNext: () => this.jukebox.next(),
                onToggle: () => this.jukebox.toggle(),
                onInfo: () => this.openDetail(),
                onLive: () => this.cityTime.goToNow(),
            },
        });
        this.dock.setEnabled(this.jukebox.count > 0);
        this.dock.setLive(this.cityTime.isNow());

        // Player is attached but nothing is played: the first audible sound must come from a
        // real tap. No autoplay workarounds.
        this.jukebox.attach(this.dock.playerHost).catch(() => {});

        document.getElementById('recenter')?.addEventListener('click', () => this.recenter());

        // Open on whatever is nearest, then upgrade to the user's actual position if it arrives.
        this.pickOpeningTrack(this.map.map.getCenter());
        this.requestLocation();

        this.ui.hideLoading();
    }

    async fetchVenues() {
        const res = await fetch('/api/map-data.json?v=20260810');
        if (!res.ok) throw new Error(`map data ${res.status}`);
        return res.json();
    }

    // --- geolocation ------------------------------------------------------------

    /**
     * Ask for location without blocking startup. An unanswered permission prompt fires no
     * callback at all, so the app must already be usable before this resolves.
     */
    requestLocation() {
        const btn = document.getElementById('recenter');
        if (!navigator.geolocation) {
            btn?.classList.add('is-idle');
            return;
        }
        btn?.classList.remove('is-idle');
        btn?.classList.add('is-locating');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude, accuracy } = pos.coords;
                btn?.classList.remove('is-locating', 'is-idle');
                this.map.setUserPosition(latitude, longitude, accuracy);
                // Permission granted means the city should open where the user is standing.
                this.map.map.panTo([latitude, longitude], { animate: true, duration: 0.8 });
                // …and the nearest act should not immediately pan away from them again.
                this.pickOpeningTrack(L.latLng(latitude, longitude), { force: true, pan: false });
            },
            () => {
                // Denied, unavailable, or never answered. Say so quietly instead of pretending.
                btn?.classList.remove('is-locating');
                btn?.classList.add('is-idle');
            },
            { timeout: 8000, maximumAge: 300000 }
        );
    }

    recenter() {
        if (!this.map.recenterOnUser()) this.requestLocation();
    }

    // --- jukebox ----------------------------------------------------------------

    /** Nearest playable venue to a point becomes the opening selection. */
    pickOpeningTrack(point, { force = false, pan = true } = {}) {
        if (!this.jukebox || !this.jukebox.count) return;
        if (this.jukebox.current && !force) return;

        const at = { lat: point.lat, lng: point.lng };
        const minutes = this.cityTime.getMinutes();
        // Nearest, but only among acts that still mean something at this hour — opening on the
        // closest set that finished two hours ago is technically "nearest" and useless. Falls
        // back to plain nearest if the whole city is already done for the night.
        const relevant = (t) => {
            const venue = this.venues.find((v) => v.venue === t.venue);
            const state = venue ? venueState(venue, minutes) : 'quiet';
            return state === 'live' || state === 'upcoming';
        };
        const idx = this.jukebox.nearestTo(at, relevant);
        const chosen = idx >= 0 ? idx : this.jukebox.nearestTo(at);
        if (chosen < 0) return;
        this.suppressPan = !pan;
        this.jukebox.select(chosen);
        this.suppressPan = false;
    }

    onTrackChanged(track) {
        if (!track) return;
        this.dock.setContext(this.contextFor(track));
        // Following the music through the city: highlight the venue, nudge it into view if it
        // is off-screen, never change the scale. Silent, because the context is already set.
        this.map.selectVenue(track.venue, { silent: true, pan: !this.suppressPan });
    }

    /** Dock copy for a track: what it is, where it is, and how far away. */
    contextFor(track) {
        const venue = this.venues.find((v) => v.venue === track.venue);
        const pick = venue ? pickEvent(venue, this.cityTime.getMinutes()) : null;
        const bits = [track.venue];
        if (this.map.userPosition && track.lat != null) {
            const miles = this.map.userPosition.distanceTo([track.lat, track.lng]) / 1609.34;
            bits.push(`${miles < 0.1 ? '<0.1' : miles.toFixed(1)} mi`);
        } else if (track.time) {
            bits.push(track.time);
        }
        return {
            eyebrow: pick ? pick.label : (this.map.userPosition ? 'NEAR YOU TONIGHT' : 'TONIGHT'),
            title: track.artist,
            sub: bits.join(' · '),
        };
    }

    // --- reactions --------------------------------------------------------------

    onCityTimeChanged() {
        const minutes = this.cityTime.getMinutes();
        this.map.setCityTime(minutes);
        this.dock.setLive(this.cityTime.isNow());
        // The rail changes what the city looks like, never what is playing.
        const track = this.jukebox?.current;
        if (track) this.dock.setContext(this.contextFor(track));
    }

    onVenueSelected(venue) {
        // Selecting a venue that has a playable act moves the jukebox with it, so the map and
        // the music never disagree about where you are. One context path for both, so the
        // richer track version is never replaced by a plainer venue-only one.
        const idx = this.jukebox?.tracks.findIndex((t) => t.venue === venue.venue) ?? -1;
        if (idx >= 0) {
            if (this.jukebox.index !== idx) {
                this.jukebox.select(idx, { play: this.jukebox.playing });
            } else {
                this.dock.setContext(this.contextFor(this.jukebox.current));
            }
            return;
        }
        // A venue with nothing playable tonight still deserves an honest answer.
        const pick = pickEvent(venue, this.cityTime.getMinutes());
        this.dock.setContext({
            eyebrow: pick ? pick.label : 'DARK TONIGHT',
            title: pick ? pick.event.eventName : venue.venue,
            sub: pick ? venue.venue : 'No listings tonight',
        });
    }

    /** The intentional path to fuller detail, using the existing bottom sheet. */
    openDetail() {
        const track = this.jukebox?.current;
        const name = this.map.selected?.venueData?.venue || track?.venue;
        const venue = this.venues.find((v) => v.venue === name);
        if (!venue) return;

        const rows = (venue.events || [])
            .filter((e) => (e.eventName || '').trim())
            .map((e) => `<li><span>${e.eventTime || ''}</span><b>${e.eventName}</b></li>`)
            .join('');

        this.ui.openBottomSheet(`
            <h2 class="sheet__venue">${venue.venue}</h2>
            <p class="sheet__meta">${formatClock(nowCityMinutes())} · San Francisco</p>
            <ul class="sheet__list">${rows || '<li><b>No listings tonight</b></li>'}</ul>
            ${venue.url ? `<a class="sheet__link" href="http://${venue.url}" target="_blank" rel="noopener">${venue.url}</a>` : ''}
        `);
    }
}

const boot = () => {
    window.whatUpSFApp = new WhatUpSFApp();
    window.whatUpSFApp.init().catch((err) => {
        console.error('WhatUpSF failed to start:', err);
        window.whatUpSFApp.ui.hideLoading();
    });
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
