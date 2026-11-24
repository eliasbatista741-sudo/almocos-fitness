/* Tajokefy — captura de eventos das páginas de vendas. Carregado com async; depende do trecho do <head> (window.__tjk).
   O Pixel da Meta desta página vem do painel (rota /api/c/config, pelo domínio): o mesmo build serve vários domínios. */
(function (w, d) {
  "use strict";
  var RE = /^[A-Za-z0-9]{20}$/;
  var PIXEL_RE = /^\d{5,25}$/;
  var me = d.currentScript;
  var ORIGIN = me && me.src ? new URL(me.src).origin : "https://painel.tajokefy.online";
  var ENDPOINT = ORIGIN + "/api/c";
  var CHECKOUT_HOSTS = ["app.zuptos.com.br", "pay.hotmart.com", "go.hotmart.com", "pay.wiapy.com"];
  // Pixel ativo nesta página (null = modo sombra: só registra, nada vai para a Meta pelo navegador).
  // A página pode já ter carregado o Pixel no <head> (w.__tjk.pixel, com o eventID do PageView em w.__tjk.pv):
  // assim ele não espera este script nem o painel, e quem sai rápido ainda é contado pela Meta.
  var PIXEL = w.__tjk && PIXEL_RE.test(w.__tjk.pixel || "") && w.fbq ? String(w.__tjk.pixel) : null;
  // Trocas de checkout deste domínio, vindas do painel: { "app.zuptos.com.br/checkout/abc": "https://..." }.
  var SWAPS = {};
  // Regras extras de "Iniciar checkout" vindas do painel (como na UTMify), para botões que não são link de checkout:
  // [{ type: "text", value: "COMPRAR AGORA" }, { type: "css", value: "btn-comprar" }, { type: "url", value: "meucheckout.com" }].
  var IC_RULES = [];
  // Clone (cópia de uma página com este script) com desvio ligado no painel: o checkout dele vira o da dona da página.
  // CLONE = { tag: domínio do clone, swaps: [{ from: chave, to: link }], any: link para qualquer outro checkout }.
  var CLONE = null;
  var CLONE_TARGETS = {};
  // No clone, checkout destas plataformas também cai no "any" (o copiador pode trocar de plataforma). Só os endereços de
  // checkout: link de ajuda ou área de membros da mesma plataforma não é desviado.
  var CLONE_PLATFORMS = ["pay.kiwify.com.br", "pay.kiwify.app", "pay.cakto.com.br", "checkout.cakto.com.br", "pay.kirvano.com",
    "go.perfectpay.com.br", "checkout.perfectpay.com.br", "payment.ticto.app", "checkout.ticto.app", "sun.eduzz.com", "chk.eduzz.com",
    "ev.braip.com", "payfast.greenn.com.br", "checkout.payt.com.br", "pay.lowify.com.br"];
  function clonePlatform(host) {
    return CLONE_PLATFORMS.indexOf(host) !== -1;
  }

  // Link de checkout -> chave "host/caminho" (sem protocolo, sem query, sem barra no fim).
  // Chave da troca: domínio + caminho; na Hotmart também o ?off= (a mesma página de checkout tem várias ofertas).
  function swapKey(u) {
    var k = (u.hostname + u.pathname).replace(/\/+$/, "").toLowerCase();
    // Só o código da oferta: página que cola a própria query no fim do link gera "?off=abc?utm_source=…".
    var off = (u.searchParams.get("off") || "").split("?")[0];
    return off ? k + "?off=" + off.toLowerCase() : k;
  }

  function visitorId() {
    var id = w.__tjk && w.__tjk.id;
    if (RE.test(id || "")) return id;
    var m = d.cookie.match(/(?:^|; )_tjk=([A-Za-z0-9]{20})/);
    return m ? m[1] : null;
  }

  function cookie(name) {
    var m = d.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    if (!m) return undefined;
    try { return decodeURIComponent(m[1]); } catch (e) { return undefined; }
  }

  function uuid() {
    if (w.crypto && w.crypto.randomUUID) return w.crypto.randomUUID();
    var b = new Uint8Array(16);
    w.crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // Carrega o Pixel da Meta (sem o PageView automático do código padrão: nós disparamos com eventID).
  // Se a página já tem outro Pixel (ex.: o da UTMify), não carrega: misturar contaria em dobro.
  function startPixel(id) {
    if (PIXEL || !PIXEL_RE.test(id || "") || w.fbq) return;
    (function (f, b, e, v) {
      var n = (f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); });
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
      var t = b.createElement(e); t.async = true; t.src = v;
      var s0 = b.getElementsByTagName(e)[0]; s0.parentNode.insertBefore(t, s0);
    })(w, d, "script", "https://connect.facebook.net/en_US/fbevents.js");
    PIXEL = id;
    // external_id em texto: o Pixel faz o hash SHA-256 (o servidor manda o mesmo hash).
    w.fbq("init", PIXEL, visitorId() ? { external_id: visitorId() } : {});
    pixel("PageView", pageViewEid);
    // ViewContent que aconteceu antes do Pixel carregar: dispara agora, com o mesmo eventID.
    if (viewContentEid) pixel("ViewContent", viewContentEid);
  }

  function pixel(eventName, eid) {
    if (PIXEL && w.fbq) { try { w.fbq("track", eventName, {}, { eventID: eid }); } catch (e) {} }
  }

  function send(eventName, presetEid) {
    var uid = visitorId();
    if (!uid) return null;
    var eid = presetEid || uuid();
    var body = JSON.stringify({
      v: 1, eid: eid, uid: uid, ev: eventName, url: w.location.href,
      ref: d.referrer || undefined, fbp: cookie("_fbp"), fbc: cookie("_fbc"),
      // Teste A/B de ticket: versão sorteada pelo Cloudflare da página ("<id do teste>.A" ou ".B").
      ab: cookie("tjk_ab")
    });
    // sendBeacon sobrevive à saída da página (clique no checkout). text/plain evita preflight de CORS.
    var sent = false;
    try { sent = w.navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" })); } catch (e) {}
    if (!sent) {
      try {
        var p = w.fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, mode: "no-cors", headers: { "content-type": "text/plain" } });
        if (p && p.catch) p.catch(function () {});
      } catch (e) {}
    }
    return eid;
  }

  // ViewContent: sinal de interesse, uma vez por página — o que vier primeiro entre 5 s na página
  // ou rolar até a metade. Vai pelo Pixel e pelo servidor com o MESMO eventID (a Meta conta uma vez).
  var viewContentEid = null;
  function sendViewContent() {
    if (viewContentEid) return;
    viewContentEid = uuid();
    pixel("ViewContent", viewContentEid);
    send("ViewContent", viewContentEid);
    w.removeEventListener("scroll", onScroll);
  }
  function onScroll() {
    var el = d.documentElement;
    var seen = (w.scrollY || el.scrollTop) + w.innerHeight;
    if (el.scrollHeight > 0 && seen / el.scrollHeight >= 0.5) sendViewContent();
  }
  setTimeout(sendViewContent, 5000);
  w.addEventListener("scroll", onScroll, { passive: true });

  // PageView: espera o cookie _fbp aparecer (o Pixel carrega depois), no máximo ~2,5 s.
  // Se a pessoa sair antes disso, manda na saída mesmo assim.
  // O Pixel do navegador dispara assim que o painel diz qual é; o envio ao servidor espera o _fbp, com o MESMO eventID.
  var prePv = PIXEL && w.__tjk.pv;
  var pageViewEid = typeof prePv === "string" && prePv.length >= 8 && prePv.length <= 64 ? prePv : uuid(), pageViewSent = false, tries = 0;

  // Abre já a ligação com a Meta, enquanto o painel responde qual é o Pixel.
  if (!PIXEL && !w.fbq) {
    try { var pc = d.createElement("link"); pc.rel = "preconnect"; pc.href = "https://connect.facebook.net"; d.head.appendChild(pc); } catch (e) {}
  }

  // Pixel: se a página já carregou no <head>, o PageView já saiu com pageViewEid; data-pixel no <script> (jeito antigo)
  // ainda vale; senão, o painel diz qual é. A configuração do painel é buscada SEMPRE (traz também as regras de IC).
  var attrPixel = me && me.getAttribute("data-pixel");
  if (!PIXEL && PIXEL_RE.test(attrPixel || "")) startPixel(attrPixel);
  try {
    var cfg = w.fetch(ORIGIN + "/api/c/config?h=" + encodeURIComponent(w.location.hostname) + "&p=" + encodeURIComponent(w.location.pathname));
    cfg.then(function (r) { return r.json(); }).then(function (c) {
      if (!c) return;
      if (c.ic && c.ic.length) IC_RULES = c.ic;
      if (c.clone) setupClone(c.clone);
      if (c.swaps && c.swaps.length) {
        for (var i = 0; i < c.swaps.length; i++) {
          var to = String(c.swaps[i].to);
          SWAPS[String(c.swaps[i].from).toLowerCase()] = to;
          // O destino da troca também conta como checkout (para o clique registrar o InitiateCheckout).
          try { var host = new URL(to).hostname; if (CHECKOUT_HOSTS.indexOf(host) === -1) CHECKOUT_HOSTS.push(host); } catch (e) {}
        }
        applySwapsNow();
      }
      // Teste A/B de ticket: quem foi sorteado para a B vai para os checkouts da B.
      if (c.ab && c.ab.length) {
        var mine = cookie("tjk_ab");
        for (var t = 0; t < c.ab.length; t++) {
          if (mine !== c.ab[t].test + ".B" || !c.ab[t].swaps) continue;
          for (var s2 = 0; s2 < c.ab[t].swaps.length; s2++) {
            try {
              var fromU = new URL(String(c.ab[t].swaps[s2].from));
              var toS = String(c.ab[t].swaps[s2].to);
              SWAPS[swapKey(fromU)] = toS;
              var h2 = new URL(toS).hostname;
              if (CHECKOUT_HOSTS.indexOf(h2) === -1) CHECKOUT_HOSTS.push(h2);
            } catch (e) {}
          }
        }
        applySwapsNow();
      }
      if (c.pixel) startPixel(String(c.pixel));
    }).catch(function () {});
  } catch (e) {}

  function sendPageView() {
    if (pageViewSent) return;
    pageViewSent = true;
    send("PageView", pageViewEid);
  }
  (function waitFbp() {
    if (cookie("_fbp") || tries++ >= 10) return sendPageView();
    setTimeout(waitFbp, 250);
  })();
  w.addEventListener("pagehide", sendPageView);

  // Ajusta um link de checkout: aplica a troca do painel (se houver) e garante a etiqueta (src).
  // A troca leva junto os parâmetros do link original (UTMs, src etc.) e mantém os do novo (ex.: ?off= da Hotmart).
  // Devolve true se o link é de checkout.
  function prepareLink(a) {
    var href;
    try { href = new URL(a.href, w.location.href); } catch (err) { return false; }
    if (CLONE && (CHECKOUT_HOSTS.indexOf(href.hostname) !== -1 || clonePlatform(href.hostname))) return prepareCloneLink(a, href);
    if (CHECKOUT_HOSTS.indexOf(href.hostname) === -1) return false;
    // Link que já trocamos (e que ninguém mudou depois) é procurado pelo endereço ORIGINAL: assim a B de um plano
    // que for igual à A de outro (ex.: Premium da B = Upgrade da A) não troca de novo.
    var key = swapKey(href);
    if (a.getAttribute && a.getAttribute("data-tjk-out") === a.href && a.getAttribute("data-tjk-key")) key = a.getAttribute("data-tjk-key");
    var to = SWAPS[key];
    if (to) {
      try {
        var swapped = new URL(to);
        // Leva os parâmetros do link original (UTMs, src…), menos a oferta da Hotmart (?off=), que é a do link novo.
        href.searchParams.forEach(function (v, k) { if (k !== "off" && !swapped.searchParams.has(k)) swapped.searchParams.set(k, v); });
        href = swapped;
      } catch (err) {}
    }
    var uid = visitorId();
    if (uid && href.searchParams.get("src") !== uid) href.searchParams.set("src", uid);
    // Wiapy: o checkout não roda o Pixel; ele lê o fbc de ?fbclick= e o fbp de ?fbp= (e devolve os dois no aviso da
    // venda). Sem isso o aviso vem com o cookie antigo do checkout ou vazio. Atualiza a cada clique (o _fbp pode
    // aparecer depois que o link foi ajustado).
    if (href.hostname === "pay.wiapy.com") {
      var fbc = cookie("_fbc") || fbcFromUrl(), fbp = cookie("_fbp");
      if (fbc && href.searchParams.get("fbclick") !== fbc) href.searchParams.set("fbclick", fbc);
      if (fbp && href.searchParams.get("fbp") !== fbp) href.searchParams.set("fbp", fbp);
    }
    if (a.href !== href.toString()) a.href = href.toString();
    if (to && a.setAttribute) {
      a.setAttribute("data-tjk-key", key);
      a.setAttribute("data-tjk-out", a.href);
    }
    return true;
  }

  // fbc no formato da Meta montado do fbclid da URL, para quando o Pixel ainda não criou o cookie _fbc. Calculado uma
  // vez só: um valor novo a cada chamada mudaria o link sem parar (o observador de links reage a cada mudança).
  var urlFbc;
  function fbcFromUrl() {
    if (urlFbc === undefined) {
      urlFbc = null;
      try {
        var id = new URL(w.location.href).searchParams.get("fbclid");
        if (id) urlFbc = "fb.1." + Date.now() + "." + id;
      } catch (e) {}
    }
    return urlFbc;
  }

  // Troca os links já na tela (o link certo aparece até ao segurar o dedo no botão) e os que o React
  // desenhar depois. O clique continua conferindo, como garantia.
  var observing = false;
  function applySwapsNow() {
    var links = d.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) prepareLink(links[i]);
    if (observing || !w.MutationObserver) return;
    observing = true;
    var pending = false;
    new w.MutationObserver(function () {
      if (pending) return;
      pending = true;
      // Agrupa as mudanças da tela num único ajuste.
      setTimeout(function () {
        pending = false;
        var all = d.querySelectorAll("a[href]");
        for (var j = 0; j < all.length; j++) prepareLink(all[j]);
      }, 50);
    }).observe(d.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  }

  // Clone: troca o checkout do copiador pelo da dona (plano a plano; o resto vai para o "any"). O link novo NÃO leva os
  // parâmetros da página do clone (as UTMs são das campanhas do copiador): leva só a etiqueta do clone, que o painel
  // mostra como campanha "Clone <domínio>" (Hotmart: no xcod, no formato da UTMify; Zuptos/Wiapy: nas UTMs).
  function prepareCloneLink(a, href) {
    var key = swapKey(href);
    var to = CLONE_TARGETS[key] ? href.toString() : SWAPS[key] || CLONE.any;
    if (!to) return true;
    try {
      var out = new URL(to);
      var name = "Clone " + CLONE.tag;
      out.searchParams.set("utm_source", "clone");
      out.searchParams.set("utm_campaign", name);
      if (/hotmart\.com$/.test(out.hostname)) {
        var SEP = "hQwK21wXxR";
        out.searchParams.set("xcod", "clone" + SEP + name + SEP + SEP + SEP);
      }
      if (a.href !== out.toString()) a.href = out.toString();
    } catch (err) {}
    return true;
  }

  function setupClone(c) {
    if (CLONE || !c || !c.tag) return;
    CLONE = { tag: String(c.tag), any: null };
    function addTarget(to) {
      try {
        var u = new URL(String(to));
        if (u.protocol !== "https:") return null;
        CLONE_TARGETS[swapKey(u)] = true;
        if (CHECKOUT_HOSTS.indexOf(u.hostname) === -1) CHECKOUT_HOSTS.push(u.hostname);
        return u.toString();
      } catch (e) { return null; }
    }
    for (var i = 0; c.swaps && i < c.swaps.length; i++) {
      var to = addTarget(c.swaps[i].to);
      var fromKey = String(c.swaps[i].from).toLowerCase();
      if (!to) continue;
      SWAPS[fromKey] = to;
      // O checkout do copiador pode ser de outra plataforma (Kiwify, Cakto…): passa a contar como checkout.
      var fromHost = fromKey.split("/")[0];
      if (fromHost && CHECKOUT_HOSTS.indexOf(fromHost) === -1) CHECKOUT_HOSTS.push(fromHost);
    }
    if (c.any) CLONE.any = addTarget(c.any);
    applySwapsNow();
    // Checkout aberto por código (location.assign/href), sem link: a Navigation API deixa cancelar a ida e trocar o
    // destino (Chrome/Android; Safari 26.2+). Nos navegadores sem ela, só os links e o window.open são trocados.
    if (w.navigation && w.navigation.addEventListener) {
      w.navigation.addEventListener("navigate", function (e) {
        if (!e.cancelable || e.navigationType === "traverse" || e.navigationType === "reload") return;
        var dest;
        try { dest = new URL(e.destination.url); } catch (err) { return; }
        var a = d.createElement("a");
        a.href = dest.toString();
        if (!prepareLink(a) || a.href === dest.toString()) return;
        e.preventDefault();
        w.location.assign(a.href);
      });
    }
    var open = w.open;
    if (typeof open === "function") {
      w.open = function (url) {
        var args = Array.prototype.slice.call(arguments);
        try {
          if (url) {
            var a = d.createElement("a");
            a.href = String(url);
            if (prepareLink(a)) args[0] = a.href;
          }
        } catch (err) {}
        return open.apply(w, args);
      };
    }
  }

  // InitiateCheckout: clique em qualquer link de checkout (inclusive botão do meio / nova aba).
  var lastIc = 0;
  function fireCheckout() {
    if (Date.now() - lastIc <= 3000) return;
    lastIc = Date.now();
    var icEid = uuid();
    pixel("InitiateCheckout", icEid);
    send("InitiateCheckout", icEid);
  }
  // O clique bate com alguma regra de IC da página? (texto do botão contém / classe ou seletor CSS / link contém)
  function matchesIcRule(target) {
    if (!IC_RULES.length || !target || !target.closest) return false;
    var el = target.closest("a,button,[role=button],input[type=submit],input[type=button],label") || target;
    var text = String(el.innerText || el.value || el.textContent || "").replace(/\s+/g, " ").toUpperCase();
    for (var i = 0; i < IC_RULES.length; i++) {
      var r = IC_RULES[i], v = String((r && r.value) || "").trim();
      if (!v) continue;
      if (r.type === "text" && text.indexOf(v.replace(/\s+/g, " ").toUpperCase()) !== -1) return true;
      if (r.type === "css") {
        // "btn-comprar" vira ".btn-comprar"; seletores completos (".a .b", "#id", "[data-x]") valem como estão.
        var sel = /^[A-Za-z_][\w-]*$/.test(v) ? "." + v : v;
        try { if (target.closest(sel)) return true; } catch (err) {}
      }
      if (r.type === "url") {
        var link = target.closest("a[href]");
        if (link && link.href.indexOf(v) !== -1) {
          // Checkout fora da lista padrão: garante a etiqueta (src) no link, como nos checkouts conhecidos.
          try { var u = new URL(link.href), uid = visitorId(); if (uid && u.searchParams.get("src") !== uid) { u.searchParams.set("src", uid); link.href = u.toString(); } } catch (err) {}
          return true;
        }
      }
    }
    return false;
  }

  // Páginas com botão (sem link) montam o checkout copiando o endereço da página (location.search): no clique, antes do
  // botão agir, o fbc/fbp da página entram no endereço como ?fbclick=/&fbp= (o que o checkout da Wiapy lê).
  function putClickIds() {
    var fbc = cookie("_fbc") || fbcFromUrl(), fbp = cookie("_fbp");
    if (!fbc && !fbp) return;
    try {
      var l = new URL(w.location.href), changed = false;
      if (fbc && l.searchParams.get("fbclick") !== fbc) { l.searchParams.set("fbclick", fbc); changed = true; }
      if (fbp && l.searchParams.get("fbp") !== fbp) { l.searchParams.set("fbp", fbp); changed = true; }
      if (changed) w.history.replaceState(w.history.state, "", l.toString());
    } catch (err) {}
  }

  function onCheckoutClick(e) {
    if (e.type === "auxclick" && e.button !== 1) return;
    putClickIds();
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a && prepareLink(a)) return fireCheckout();
    if (matchesIcRule(e.target)) fireCheckout();
  }
  d.addEventListener("click", onCheckoutClick, true);
  d.addEventListener("auxclick", onCheckoutClick, true);

  // Páginas que abrem o checkout por código (location.assign), sem link: chamam window.tjkCheckout(url) logo antes
  // de sair. Registra o InitiateCheckout e devolve o link com a etiqueta (src) garantida.
  w.tjkCheckout = function (url) {
    try {
      var a = d.createElement("a");
      a.href = url;
      if (!prepareLink(a)) return url;
      fireCheckout();
      return a.href;
    } catch (e) {
      return url;
    }
  };
})(window, document);
