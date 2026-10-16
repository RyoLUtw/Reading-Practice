/* Code-point offsets preserve repeated text and non-BMP characters across Python/JS. */
(() => {
  function proposeUnits(text) {
    const chars = Array.from(text), ranges = [];
    let start = 0;
    function add(end) {
      let left = start, right = end;
      while (left < right && /\s/u.test(chars[left])) left++;
      while (right > left && /\s/u.test(chars[right - 1])) right--;
      if (right > left) ranges.push({start_offset: left, end_offset: right, included: true});
      start = end;
    }
    for (let i = 0; i < chars.length; i++) {
      if (!/[.!?。！？]/u.test(chars[i])) continue;
      const before = chars.slice(start, i + 1).join('');
      if (chars[i] === '.' && (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\be\.g|\bi\.e)\.$/i.test(before) || /\d/.test(chars[i - 1] || '') && /\d/.test(chars[i + 1] || ''))) continue;
      let end = i + 1;
      while (end < chars.length && /[.!?。！？"”’')\]]/u.test(chars[end])) end++;
      if (end === chars.length || /\s/u.test(chars[end])) { add(end); i = end - 1; }
    }
    add(chars.length);
    return ranges;
  }

  // Replace each break character separately to retain the source-offset mapping.
  function singleLineUnit(text) { return String(text || '').replace(/[\r\n]/g, ' '); }

  // An uncertain failure retains its ID and payload for an idempotent retry. New edits
  // queue behind it, never race a Finish or overwrite another tab's save version.
  class DraftSaver {
    constructor({save, version = 0, onStatus = () => {}, onSaved = () => {}, delay = 500, storage = null, storageKey = null}) {
      Object.assign(this, {save, version, onStatus, onSaved, delay, storage, storageKey});
      this.latest = null; this.persisted = null; this.pending = null; this.running = null; this.timer = null;
      this.localSaved = false; this.autosave = true;
    }
    prime(value) { this.latest = this.persisted = JSON.stringify(value); }
    restore(serverState) {
      if (!this.storage || !this.storageKey) return null;
      try {
        const cached = JSON.parse(this.storage.getItem(this.storageKey) || 'null');
        if (!cached || cached.cache_version !== 1 || !Number.isInteger(cached.version) || typeof cached.latest !== 'string') return null;
        const state = JSON.parse(cached.latest);
        if (state.format_version !== 1 || state.tokenization_version !== 1) return null;
        // A response may have been lost after the server committed the request.
        if (cached.pending && this.version === cached.version + 1 &&
            JSON.stringify(serverState) === JSON.stringify(cached.pending.activity_state)) {
          cached.version = this.version; cached.persisted = JSON.stringify(serverState); cached.pending = null;
        }
        this.version = cached.version; this.latest = cached.latest;
        this.persisted = cached.persisted; this.pending = cached.pending || null;
        this.cache();
        return state;
      } catch { return null; }
    }
    cache() {
      if (!this.storage || !this.storageKey) return;
      try {
        if (!this.dirty) this.storage.removeItem(this.storageKey);
        else this.storage.setItem(this.storageKey, JSON.stringify({cache_version: 1,
          latest: this.latest, persisted: this.persisted, version: this.version, pending: this.pending}));
        this.localSaved = true;
      } catch { this.localSaved = false; }
    }
    change(value, {autosave = true} = {}) {
      this.latest = JSON.stringify(value);
      this.autosave = autosave; clearTimeout(this.timer); this.cache();
      if (!this.dirty) return;
      this.onStatus(this.localSaved ? 'Saved in this browser' : this.storage ? 'Browser storage unavailable — work kept in this tab' : 'Unsaved');
      if (autosave) this.timer = setTimeout(() => this.flush().catch(() => {}), this.delay);
    }
    get dirty() { return !!this.pending || this.latest !== this.persisted; }
    async flush(finish = false) {
      clearTimeout(this.timer);
      while (this.running) await this.running;
      const run = async () => {
        let flushLatest = true;
        while (this.pending || ((flushLatest || this.autosave) && this.latest !== this.persisted) || finish) {
          if (!this.pending) {
            this.pending = {activity_state: JSON.parse(this.latest), save_version: this.version,
              finish, request_id: crypto.randomUUID()};
            finish = false;
            flushLatest = false;
          }
          const request = this.pending;
          this.cache();
          this.onStatus('Saving…');
          try {
            const result = await this.save(request);
            this.version = result.save_version;
            this.persisted = JSON.stringify(request.activity_state);
            this.pending = null;
            this.cache();
            this.onSaved(result);
          } catch (error) {
            // HTTP 400 confirms validation rejected the request without committing.
            // Keeping it pending would block every newer edit (including Reset),
            // and persist that blocked request across browser reloads.
            if (error.status === 400) {
              this.pending = null;
              this.cache();
              if (JSON.stringify(request.activity_state) !== this.latest) {
                flushLatest = true;
                continue;
              }
            }
            this.onStatus(`Save failed — ${error.message}`); throw error;
          }
        }
        this.onStatus(this.dirty ? (this.localSaved ? 'Saved in this browser' : 'Unsaved') : 'Saved to database');
      };
      this.running = run();
      try { await this.running; } finally { this.running = null; }
    }
  }
  const core = {proposeUnits, singleLineUnit, DraftSaver};
  if (typeof module !== 'undefined') module.exports = core;
  else window.ReadingCore = core;
})();
