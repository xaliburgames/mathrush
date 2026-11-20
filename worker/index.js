// Math Rush : serveur du duel en ligne (2 joueurs).
//   /ws?room=1234&role=host   -> l'hôte ouvre une salle
//   /ws?room=1234&role=join   -> l'adversaire rejoint la salle
// Une salle = un Durable Object. L'ARBITRE EST LE SERVEUR : l'hôte envoie la question (q) avec la bonne réponse (ci);
// le serveur garde ci et ne l'envoie pas à l'invité. Chaque joueur envoie sa réponse (ans); le premier qui répond juste
// gagne la manche (res). Une erreur (bad) bloque le joueur 2 s. L'hôte annonce la fin du temps (to).
//   go {grade}                : l'hôte lance (ou relance) le duel
//   q {r, q, ch, dec, ci, tm} : l'hôte envoie la question r (l'invité la reçoit sans ci)
//   ans {r, i}                : réponse du joueur (indice 0 à 3)
//   res {r, who, i}           : (serveur -> tous) who a répondu juste en premier
//   bad {r, who, i}           : (serveur -> tous) who s'est trompé
//   none {r}                  : (serveur -> tous) les deux sont bloqués en même temps
//   to {r}                    : fin du temps (envoyé par l'hôte, relayé à tous si la manche est ouverte)
//   rematch / leave / bye / away

const enc = new TextEncoder();
const dec = new TextDecoder();
const txt = (m) => (typeof m === "string" ? m : dec.decode(m));
const LOCK_MS = 2000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const room = (url.searchParams.get("room") || "").replace(/[^0-9]/g, "");
      if (room.length !== 4) return new Response("code de salle invalide", { status: 400 });
      if (req.headers.get("Upgrade") !== "websocket") return new Response("WebSocket attendu", { status: 426 });
      const stub = env.SALLES.get(env.SALLES.idFromName(room));
      return stub.fetch(req);
    }
    if (url.pathname === "/api/statut") return Response.json({ ok: true, jeu: "math-rush" }, { headers: { "Access-Control-Allow-Origin": "*" } });
    return new Response("Math Rush - serveur en ligne", { status: 200 });
  },
};

export class Salle {
  constructor(state, env) {
    this.state = state;
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  sockets(tag) {
    return this.state.getWebSockets(tag).filter((w) => w.readyState === 1 || w.readyState === undefined);
  }
  all() { return [...this.sockets("host"), ...this.sockets("guest")]; }
  send(ws, obj) { try { ws.send(enc.encode(typeof obj === "string" ? obj : JSON.stringify(obj))); } catch (e) {} }
  others(ws) { return this.all().filter((w) => w !== ws); }
  everyone(obj) { for (const w of this.all()) this.send(w, obj); }

  refuse(server, client, msg, code) {
    this.state.acceptWebSocket(server, ["refus"]);
    this.send(server, { t: "err", m: msg });
    try { server.close(code, msg); } catch (e) {}
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") === "host" ? "host" : "join";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === "host") {
      if (this.sockets("host").length > 0) return this.refuse(server, client, "pris", 4001);
      await this.state.storage.delete("g"); await this.state.storage.delete("go");
      this.state.acceptWebSocket(server, ["host"]);
      server.serializeAttachment({ role: "host", slot: 0 });
      this.send(server, { t: "ok", slot: 0 });
      return new Response(null, { status: 101, webSocket: client });
    }

    const host = this.sockets("host")[0];
    if (!host) return this.refuse(server, client, "introuvable", 4002);
    if (this.sockets("guest").length > 0 || (await this.state.storage.get("go"))) return this.refuse(server, client, "pleine", 4002);
    this.state.acceptWebSocket(server, ["guest"]);
    server.serializeAttachment({ role: "guest", slot: 1 });
    this.send(server, { t: "ok", slot: 1 });
    this.send(host, { t: "join", slot: 1 });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, msg) {
    const a = ws.deserializeAttachment() || {};
    const str = txt(msg);
    if (str === "ping") return;
    let m;
    try { m = JSON.parse(str); } catch (e) { return; }
    if (!m || typeof m.t !== "string") return;
    const st = this.state.storage, slot = a.slot;

    if (m.t === "go" && a.role === "host") {
      await st.put("go", m); await st.delete("g");
      for (const o of this.others(ws)) this.send(o, str);
      return;
    }
    if (m.t === "q" && a.role === "host") {
      const ci = Number(m.ci);
      if (!(ci >= 0 && ci <= 3)) return;
      await st.put("g", { r: m.r, ci, done: false, bad: [0, 0] });
      const out = { ...m }; delete out.ci;
      for (const o of this.others(ws)) this.send(o, out);   // l'invité ne reçoit pas la bonne réponse
      return;
    }
    if (m.t === "ans") {
      const g = await st.get("g");
      const i = Number(m.i);
      if (!g || g.done || m.r !== g.r || !(i >= 0 && i <= 3)) return;
      const now = Date.now();
      if (now - g.bad[slot] < LOCK_MS) return;   // encore bloqué
      if (i === g.ci) {
        g.done = true; await st.put("g", g);
        this.everyone({ t: "res", r: g.r, who: slot, i });
      } else {
        g.bad[slot] = now;
        if (now - g.bad[1 - slot] < LOCK_MS) { g.done = true; await st.put("g", g); this.everyone({ t: "bad", r: g.r, who: slot, i }); this.everyone({ t: "none", r: g.r, ci: g.ci }); }
        else { await st.put("g", g); this.everyone({ t: "bad", r: g.r, who: slot, i }); }
      }
      return;
    }
    if (m.t === "to" && a.role === "host") {
      const g = await st.get("g");
      if (!g || g.done || m.r !== g.r) return;
      g.done = true; await st.put("g", g);
      this.everyone({ t: "to", r: g.r, ci: g.ci });
      return;
    }
    if (m.t === "leave") {
      ws.serializeAttachment({ ...a, left: true });
      for (const o of this.others(ws)) this.send(o, { t: "bye" });
      return;
    }
    if (m.t === "rematch") { for (const o of this.others(ws)) this.send(o, str); return; }
    // tout le reste est ignoré
  }

  async webSocketClose(ws) { await this.left(ws); }
  async webSocketError(ws) { await this.left(ws); }

  async left(ws) {
    const a = ws.deserializeAttachment() || {};
    if (!a.left) for (const o of this.others(ws)) this.send(o, { t: "bye" });
    try { ws.close(1000, "fin"); } catch (e) {}
  }
}
