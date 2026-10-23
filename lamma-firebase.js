/* lamma-firebase.js
   Bridges the game page to Firebase. The page was written against Claude's artifact runtime
   (window.claude.use('room' | 'user' | 'artifact' | 'assets')); this file provides the same
   calls backed by Firebase Realtime Database, Auth and (optionally) Storage, so the page code
   stays the same.

   Database layout
     content            the site content (what the admin panel saves)
     secrets/hostPin    plain host PIN, never readable by clients; the rules compare against it
     hosts/{uid}        a device that entered the right host PIN
     room/presence/{sid} one open tab: {by: uid, p: {...presence}, t}
     room/events/{topic} last message on a topic (the host's screen state)
*/
(function () {
  const cfg = window.LAMMA_CONFIG || {};
  if (!window.firebase || !cfg.firebase || !cfg.firebase.apiKey || cfg.firebase.apiKey.startsWith('PUT_')) {
    console.warn('[lamma] Firebase is not configured yet — running in single-device mode.');
    return;
  }
  firebase.initializeApp(cfg.firebase);
  const auth = firebase.auth();
  const db = firebase.database();
  const adminEmail = String(cfg.adminEmail || '').toLowerCase();
  const sid = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // Everyone is signed in: anonymously by default, with Google for the owner.
  const ready = new Promise((resolve) => {
    let done = false;
    auth.onAuthStateChanged((u) => {
      if (u) { if (!done) { done = true; resolve(u); } return; }
      auth.signInAnonymously().catch((e) => { console.error('[lamma] sign-in failed', e); if (!done) { done = true; resolve(null); } });
    });
  });
  auth.getRedirectResult().then((r) => { if (r && r.user) location.reload(); }).catch(() => {});

  const isAdmin = () => {
    const u = auth.currentUser;
    return !!(u && !u.isAnonymous && u.emailVerified && String(u.email || '').toLowerCase() === adminEmail);
  };
  const uid = () => (auth.currentUser ? auth.currentUser.uid : null);
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const mapErr = (e) => (e && /permission/i.test(String(e.code || e.message)) ? err('not_writer', 'permission denied') : err('upstream_error', String(e && e.message)));

  /* ---------------- room ---------------- */
  function makeRoom() {
    const presRef = db.ref('room/presence');
    const meRef = presRef.child(sid);
    let mine = {};
    let snapshot = {};       // sid -> {by, p, t}
    let peersArr = [];
    let connected = false;
    const peerCbs = new Set(), connCbs = new Set();

    const toPeer = (k, v) => ({
      peer: k, by: v.by || null, isMe: v.by === uid(), sameTab: k === sid, kind: 'viewer', guest: false,
      presence: Object.freeze(Object.assign({}, v.p || {})), updatedAt: Date.now(),
    });
    const rebuild = () => { peersArr = Object.freeze(Object.keys(snapshot).map((k) => toPeer(k, snapshot[k]))); };

    function writeMe() {
      if (!uid()) return Promise.resolve();
      return meRef.set({ by: uid(), p: mine, t: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
    }

    db.ref('.info/connected').on('value', (s) => {
      connected = !!s.val();
      if (connected) { meRef.onDisconnect().remove(); writeMe(); }
      connCbs.forEach((f) => { try { f(connected); } catch (e) { console.error(e); } });
    });

    presRef.on('value', (s) => {
      const next = s.val() || {};
      const prev = snapshot;
      snapshot = next;
      rebuild();
      const joined = [], left = [], updated = [];
      for (const k of Object.keys(next)) {
        if (!prev[k]) joined.push(toPeer(k, next[k]));
        else if (JSON.stringify(prev[k].p || {}) !== JSON.stringify(next[k].p || {})) updated.push(toPeer(k, next[k]));
      }
      for (const k of Object.keys(prev)) if (!next[k]) left.push(toPeer(k, prev[k]));
      const change = { peers: peersArr, joined, left, updated };
      peerCbs.forEach((f) => { try { f(change); } catch (e) { console.error(e); } });
    });

    return Object.freeze({
      presence(patch) {
        for (const [k, v] of Object.entries(patch || {})) { if (v === null) delete mine[k]; else mine[k] = v; }
        mine = JSON.parse(JSON.stringify(mine));
        return writeMe();
      },
      peers: () => peersArr,
      onPeers(fn) {
        peerCbs.add(fn);
        setTimeout(() => fn({ peers: peersArr, joined: peersArr, left: [], updated: [] }), 0);
        return () => peerCbs.delete(fn);
      },
      emit(topic, data) {
        return db.ref('room/events/' + topic).set({ data: JSON.parse(JSON.stringify(data ?? null)), by: sid, t: firebase.database.ServerValue.TIMESTAMP })
          .catch((e) => { throw mapErr(e); });
      },
      on(topic, fn) {
        const ref = db.ref('room/events/' + topic);
        const h = ref.on('value', (s) => {
          const v = s.val(); if (!v) return;
          fn({ topic, data: v.data, peer: v.by, by: null, isMe: v.by === sid, sameTab: v.by === sid, kind: 'viewer', guest: false });
        });
        return () => ref.off('value', h);
      },
      connected: () => connected,
      onConnection(fn) { connCbs.add(fn); setTimeout(() => fn(connected), 0); return () => connCbs.delete(fn); },
    });
  }

  /* ---------------- user ---------------- */
  const userNS = Object.freeze({
    isOwner: async () => { await ready; return isAdmin(); },
    canEdit: async () => { await ready; return isAdmin(); },
    can: async () => isAdmin(),
    id: async () => { await ready; return uid(); },
  });

  /* ---------------- artifact (save content) ---------------- */
  const artifactNS = Object.freeze({
    async publish(files) {
      await ready;
      if (!isAdmin()) throw err('not_writer');
      const f = files && files['content.json'];
      const text = typeof f === 'string' ? f : f && f.content;
      if (typeof text !== 'string') throw err('invalid_content');
      try { await db.ref('content').set(JSON.parse(text)); } catch (e) { throw mapErr(e); }
      return { version: String(Date.now()) };
    },
  });

  /* ---------------- assets (uploads) ---------------- */
  const assetsNS = cfg.storage ? Object.freeze({
    async upload(file) {
      await ready;
      if (!isAdmin()) throw err('not_granted');
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const ext = (String(file.name || '').match(/\.[a-z0-9]{1,5}$/i) || [''])[0].toLowerCase();
      const ref = firebase.storage().ref('media/' + id + ext);
      try {
        await ref.put(file, { contentType: file.type || undefined });
        const url = await ref.getDownloadURL();
        return { id, url, sizeBytes: file.size, contentType: file.type };
      } catch (e) { throw /unauthorized|permission/i.test(String(e.code)) ? err('not_granted') : err('upstream_error', String(e.message)); }
    },
  }) : null;

  let roomNS = null;
  window.claude = Object.freeze({
    async use(name) {
      await ready;
      if (!uid()) return null;
      if (name === 'room') return roomNS || (roomNS = makeRoom());
      if (name === 'user') return userNS;
      if (name === 'artifact') return isAdmin() ? artifactNS : null;
      if (name === 'assets') return isAdmin() ? assetsNS : null;
      return null;
    },
  });

  /* ---------------- extras the page calls directly ---------------- */
  window.lamma = Object.freeze({
    async watchContent(cb) {
      await ready;
      let first = true;
      return new Promise((resolve, reject) => {
        db.ref('content').on('value', async (s) => {
          let v = s.val();
          if (!v && first) { try { const r = await fetch('content.json', { cache: 'no-store' }); v = r.ok ? await r.json() : {}; } catch (e) { v = {}; } }
          cb(v || {}); if (first) { first = false; resolve(); }
        }, (e) => { if (first) { first = false; reject(e); } });
      });
    },
    async claimHost(pin) { await ready; return db.ref('hosts/' + uid()).set(String(pin)); },
    async setSecret(key, value) { await ready; if (!isAdmin()) throw err('not_writer'); return db.ref('secrets/' + key).set(value == null ? null : String(value)); },
    async adminSignIn() {
      const p = new firebase.auth.GoogleAuthProvider();
      try { await auth.signInWithPopup(p); location.reload(); }
      catch (e) { if (/popup/i.test(String(e.code))) return auth.signInWithRedirect(p); throw e; }
    },
    async adminSignOut() { await auth.signOut(); location.reload(); },
    isAdmin,
  });
})();
