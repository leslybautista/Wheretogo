/* ─────────────────────────────────────────────────────────────────────────
   WhereToGo · Interaction Logger
   Añadir a Wheretogo/logger.js  Y  Wheretogolist/logger.js  (archivo idéntico)
   Cargar en index.html ANTES de wayfinder-app.js:
     <script src="logger.js"></script>
   ───────────────────────────────────────────────────────────────────────── */

(function () {

  /* ── 1. Lee parámetros de la URL (?c=A&p=P07) ── */
  const params      = new URLSearchParams(window.location.search);
  const condition   = params.get("c") || "dev";    // "A" = Map+Cards | "B" = Cards-only
  const participant = params.get("p") || "dev";     // "P01" … "P40"
  const sessionId   = `${participant}_${condition}_${Date.now()}`;

  /* ── 2. Expone variables globales (las lee wayfinder-app.js) ── */
  window.STUDY_CONDITION   = condition;
  window.STUDY_SESSION_ID  = sessionId;
  window.STUDY_PARTICIPANT = participant;
  window.SESSION_LOG       = [];

  /* ── 3. Timers internos para calcular duración de hover ── */
  const _ht = {};

  /* ── 4. Función principal de log ── */
  window.logEvent = function (type, payload) {
    const event = {
      type,
      ts:          Date.now(),
      condition,
      session_id:  sessionId,
      participant,
      ...payload
    };

    window.SESSION_LOG.push(event);

    /* Persiste en localStorage — accesible desde userstudy/ (mismo dominio) */
    try {
      localStorage.setItem("wtg_log",         JSON.stringify(window.SESSION_LOG));
      localStorage.setItem("wtg_condition",   condition);
      localStorage.setItem("wtg_session",     sessionId);
      localStorage.setItem("wtg_participant", participant);
    } catch (_) { /* quota exceeded — continúa sin crashear */ }
  };

  /* ── 5. Helpers de hover (start/end con duración automática) ── */
  window.hoverStart = function (dest, source) {
    if (_ht[dest]) return;                          // evita doble-start
    _ht[dest] = { ts: Date.now(), source };
    logEvent("DEST_HOVER_START", { dest, source });
  };

  window.hoverEnd = function (dest) {
    const t = _ht[dest];
    if (!t) return;
    logEvent("DEST_HOVER_END", {
      dest,
      source:      t.source,
      duration_ms: Date.now() - t.ts
    });
    delete _ht[dest];
  };

  /* ── 6. Eventos automáticos de sesión ── */
  window.addEventListener("load", function () {
    logEvent("SESSION_START", {
      url:       location.href,
      interface: condition === "A" ? "MapCard" : "CardOnly"
    });
  });

  window.addEventListener("beforeunload", function () {
    logEvent("SESSION_END", { n_events: window.SESSION_LOG.length });
    /* Fuerza escritura final antes de salir */
    try {
      localStorage.setItem("wtg_log", JSON.stringify(window.SESSION_LOG));
    } catch (_) {}
  });

})();
