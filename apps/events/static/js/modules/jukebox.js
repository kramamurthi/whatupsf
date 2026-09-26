/**
 * Jukebox — tonight's San Francisco, as a playlist.
 *
 * Every track here belongs to an artist playing in the city tonight, so the chain
 * SONG -> ARTIST -> EVENT -> VENUE -> POINT ON THE MAP always holds. Nothing is synthesised:
 * if an event has no media URL it simply is not in the jukebox.
 *
 * Playback runs through YouTube's IFrame Player API so the transport controls in the dock are
 * real. The player element itself is kept out of the visual design.
 */

const YT_ID = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/;

/** Pull a YouTube video id out of a media URL, or null if it is not a YouTube link. */
export function youtubeId(url) {
    const m = YT_ID.exec(url || '');
    return m ? m[1] : null;
}

/** Metres between two {lat,lng}-ish points, good enough for ranking venues. */
function metres(a, b) {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
    const x = dLng * Math.cos(lat);
    return Math.sqrt(dLat * dLat + x * x) * R;
}

export class Jukebox {
    /** @param {Array} venues  publish.json payload
     *  @param {Function} onChange called with the current track whenever it changes
     *  @param {Function} onPlayState called with true/false as playback starts/stops */
    constructor({ venues, onChange, onPlayState }) {
        this.onChange = onChange || (() => {});
        this.onPlayState = onPlayState || (() => {});

        this.tracks = [];
        // One entry per artist per venue. Some acts play two sets a night, and without this
        // "next" lands on the same name at the same place and reads as a broken button.
        // Two venues for one artist stays two entries — that is genuinely two things.
        const seen = new Set();
        for (const venue of venues || []) {
            for (const event of venue.events || []) {
                const videoId = youtubeId(event.eventUrl);
                if (!videoId) continue;
                const key = `${(event.eventName || '').trim().toLowerCase()}@${venue.venue}`;
                if (seen.has(key)) continue;
                seen.add(key);
                this.tracks.push({
                    videoId,
                    artist: event.eventName || 'Untitled',
                    time: event.eventTime || '',
                    venue: venue.venue,
                    lat: venue.lat,
                    lng: venue.lng,
                    venueUrl: venue.url,
                    event,
                });
            }
        }

        this.index = -1;
        this.history = [];
        this.player = null;
        this.playerReady = false;
        this.playing = false;
        this.pendingPlay = false;
    }

    get count() {
        return this.tracks.length;
    }

    get current() {
        return this.index >= 0 ? this.tracks[this.index] : null;
    }

    /**
     * Index of the playable track at the venue nearest a point, or -1.
     * @param {Function} [accept] optional filter, so callers can rank only the tracks that
     *   are actually relevant right now rather than the nearest thing that already finished.
     */
    nearestTo(point, accept) {
        if (!point || !this.tracks.length) return -1;
        let best = -1;
        let bestDist = Infinity;
        this.tracks.forEach((t, i) => {
            if (t.lat == null || t.lng == null) return;
            if (accept && !accept(t)) return;
            const d = metres(point, t);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        });
        this.lastDistance = bestDist;
        return best;
    }

    /** Select a track without starting playback (respects autoplay policy). */
    select(index, { play = false } = {}) {
        if (index < 0 || index >= this.tracks.length) return;
        if (this.index !== -1 && this.index !== index) this.history.push(this.index);
        this.index = index;
        this.onChange(this.current);
        if (this.playerReady) {
            // cueVideoById loads without playing, so selecting a track never makes noise on
            // its own — the first play has to be a real user action.
            if (play) this.player.loadVideoById(this.current.videoId);
            else this.player.cueVideoById(this.current.videoId);
        } else {
            this.pendingPlay = play;
        }
    }

    next() {
        if (!this.tracks.length) return;
        this.select((this.index + 1) % this.tracks.length, { play: this.playing });
    }

    /** Walk back through what has actually been listened to, not just index - 1. */
    previous() {
        if (!this.history.length) {
            if (this.tracks.length) {
                const back = (this.index - 1 + this.tracks.length) % this.tracks.length;
                this.index = back;
                this.onChange(this.current);
                this._load(this.playing);
            }
            return;
        }
        this.index = this.history.pop();
        this.onChange(this.current);
        this._load(this.playing);
    }

    toggle() {
        if (!this.playerReady || !this.current) {
            this.pendingPlay = true;
            return;
        }
        if (this.playing) this.player.pauseVideo();
        else this.player.playVideo();
    }

    _load(play) {
        if (!this.playerReady) {
            this.pendingPlay = play;
            return;
        }
        if (play) this.player.loadVideoById(this.current.videoId);
        else this.player.cueVideoById(this.current.videoId);
    }

    /**
     * Boot the YouTube IFrame API and build the player into `host`.
     * Resolves once the player reports ready.
     */
    attach(host) {
        return new Promise((resolve) => {
            const build = () => {
                this.player = new YT.Player(host, {
                    height: '180',
                    width: '320',
                    playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
                    events: {
                        onReady: () => {
                            this.playerReady = true;
                            if (this.current) this._load(this.pendingPlay);
                            if (this.pendingPlay) this.pendingPlay = false;
                            resolve(this);
                        },
                        onStateChange: (e) => {
                            const playing = e.data === YT.PlayerState.PLAYING;
                            if (playing !== this.playing) {
                                this.playing = playing;
                                this.onPlayState(playing);
                            }
                            // Roll on when a track finishes, so the city keeps going.
                            if (e.data === YT.PlayerState.ENDED) this.next();
                        },
                        onError: () => {
                            // A pulled or region-blocked video should not dead-end the jukebox.
                            if (this.tracks.length > 1) this.next();
                        },
                    },
                });
            };

            if (window.YT?.Player) return build();
            const prev = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (typeof prev === 'function') prev();
                build();
            };
            if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
                const s = document.createElement('script');
                s.src = 'https://www.youtube.com/iframe_api';
                document.head.appendChild(s);
            }
        });
    }
}
