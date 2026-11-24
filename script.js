/* =========================================
   NEXUS AI
========================================= */

const $ = id => document.getElementById(id);

/* ===== SUPABASE SETUP: paste your two values from Supabase (Project Settings > API) ===== */
const SUPABASE_URL = "PASTE_PROJECT_URL";
const SUPABASE_KEY = "PASTE_ANON_PUBLIC_KEY";
const cloudReady = typeof supabase !== "undefined" && !SUPABASE_URL.startsWith("PASTE");

let online = false, neuralOpen = false, handRunning = false, neuralPaused = false;
let scene, camera, renderer, neuralGroup;
let nodes = [], branches = [], coreNode = null, selectedComponent = null;
let lastPinchAt = 0, pinchX = 0.5, pinchY = 0.5, neuralStarted = false;
let lastHandX = null, lastHandY = null, pinch = false;
let busy = false, authMode = "login", currentUser = null, chat = [], typers = [];
let uid = null, sb = null;

const LS = { users: "nexus_users", session: "nexus_session", chat: u => "nexus_chat_" + (u || "guest") };
const jget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const setStatus = t => { $("status").textContent = t; };
const setReply = t => { if ($("reply")) $("reply").textContent = t; };

function toast(m) {
    const t = $("toast");
    t.textContent = m;
    t.classList.add("show");
    clearTimeout(toast.id);
    toast.id = setTimeout(() => t.classList.remove("show"), 2200);
}


/* =========================================
   VOICE OUTPUT
========================================= */

function speak(text) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const clean = String(text).replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    (clean.match(/[^.!?]+[.!?]*/g) || [clean]).forEach(s => {
        if (!s.trim()) return;
        const u = new SpeechSynthesisUtterance(s.trim());
        u.rate = 0.95; u.pitch = 1; u.volume = 1;
        speechSynthesis.speak(u);
    });
}

$("stopSpeakBtn").onclick = () => { if ("speechSynthesis" in window) speechSynthesis.cancel(); toast("Stopped speaking"); };


/* =========================================
   CHAT FEED
========================================= */

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = t => t.split(/\n{2,}/).map(p => "<p>" + esc(p).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>") + "</p>").join("");
const scrollEnd = () => { const c = $("chat"); c.scrollTop = c.scrollHeight; };

function addMsg(role, text, src, animate, save = true) {
    $("empty").style.display = "none";
    const m = document.createElement("div");
    m.className = "msg " + role;
    const b = document.createElement("div");
    b.className = "bubble";
    m.appendChild(b);

    if (role === "user") {
        b.textContent = text;
    } else {
        b.innerHTML = fmt(text);
        if (src && src.url) {
            const a = document.createElement("a");
            a.className = "src"; a.href = src.url; a.target = "_blank"; a.rel = "noopener";
            a.textContent = "Source: " + (src.name || "link");
            b.appendChild(a);
        }
        const bar = document.createElement("div");
        bar.className = "bar";
        const c = document.createElement("button");
        c.textContent = "Copy Answer";
        c.onclick = () => copyText(text, c);
        bar.appendChild(c);
        m.appendChild(bar);
        if (animate) typeIn(b);
    }

    $("chat").appendChild(m);
    scrollEnd();

    if (save) {
        chat.push({ role, text, src: src || null });
        saveChat();
    }
}

function saveChat() {
    jset(LS.chat(currentUser), chat.slice(-100));
    if (uid && sb) sb.from("chats").upsert({ user_id: uid, data: JSON.stringify(chat.slice(-100)) }).then(() => {}, () => {});
}

function typeIn(b) {
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const spans = [];
    textNodes.forEach(n => {
        const f = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach(p => {
            if (!p) return;
            if (/^\s+$/.test(p)) f.appendChild(document.createTextNode(p));
            else {
                const s = document.createElement("span");
                s.className = "w"; s.textContent = p;
                f.appendChild(s); spans.push(s);
            }
        });
        n.replaceWith(f);
    });
    const step = Math.max(10, Math.min(45, 4000 / Math.max(spans.length, 1)));
    let i = 0;
    const id = setInterval(() => {
        if (i >= spans.length) { clearInterval(id); scrollEnd(); return; }
        spans[i++].classList.add("on");
        if (i % 3 === 0) scrollEnd();
    }, step);
    typers.push(id);
}

function copyText(t, btn) {
    const plain = t.replace(/\*\*/g, "");
    const done = () => { btn.textContent = "Copied ✓"; setTimeout(() => btn.textContent = "Copy Answer", 1500); };
    const fallback = () => {
        const a = document.createElement("textarea");
        a.value = plain; document.body.appendChild(a); a.select();
        try { document.execCommand("copy"); done(); } catch (e) {}
        a.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(plain).then(done, fallback);
    else fallback();
}

function showThinking() {
    const m = document.createElement("div");
    m.className = "msg ai"; m.id = "thinking";
    m.innerHTML = '<div class="dots"><i></i><i></i><i></i></div>';
    $("chat").appendChild(m);
    scrollEnd();
}
function hideThinking() { const t = $("thinking"); if (t) t.remove(); }

function renderChat() {
    document.querySelectorAll("#chat .msg").forEach(e => e.remove());
    chat.forEach(c => addMsg(c.role, c.text, c.src, false, false));
    $("empty").style.display = chat.length ? "none" : "block";
    scrollEnd();
}

$("clearBtn").onclick = () => {
    typers.forEach(clearInterval); typers = [];
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    chat = [];
    saveChat();
    renderChat();
    toast("Chat cleared");
};


/* =========================================
   LOCK / UNLOCK
========================================= */

$("unlockBtn").onclick = () => { online ? lockNexus() : unlockNexus(); };

function unlockNexus() {
    document.body.classList.add("unlocking");
    setStatus("Activating Nexus AI...");
    speak("Activating Nexus AI.");

    setTimeout(() => {
        document.body.classList.remove("locked", "unlocking");
        document.body.classList.add("online");
        online = true;
        setStatus("Nexus AI — Online");
        $("unlockBtn").innerHTML = "🔒<small>Lock</small>";
        $("command").disabled = false;
        $("command").placeholder = "Message Nexus AI...";
        $("emptySub").textContent = "Ask me anything — math, time, facts or topics.";
        setReply("All systems online");
        if (!chat.length) addMsg("ai", "Hello! I'm **Nexus AI**. Ask me anything — I can calculate, tell the time, and search DuckDuckGo and Wikipedia right here.", null, true);
    }, 700);
}

function lockNexus() {
    stopCamera();
    neuralOpen = false;
    $("neuralScreen").style.display = "none";
    online = false;
    document.body.classList.remove("online");
    document.body.classList.add("locked");
    setStatus("Nexus AI — Sleep mode");
    $("unlockBtn").innerHTML = "🔓<small>Unlock</small>";
    $("command").disabled = true;
    $("command").value = "";
    $("command").placeholder = "Nexus AI is sleeping...";
    $("emptySub").textContent = "Tap Unlock below to wake Nexus AI.";
    setReply("System standby");
    speak("Entering sleep mode.");
}


/* =========================================
   VOICE INPUT
========================================= */

$("voiceBtn").onclick = voice;

function voice() {
    if (!online) { speak("Nexus AI is in sleep mode."); toast("Tap Unlock first"); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { speak("Voice recognition is not supported."); return; }

    setStatus("Listening...");
    $("voiceBtn").classList.add("listening");
    const rec = new SR();
    rec.lang = "en-US"; rec.continuous = false; rec.interimResults = false;
    const end = () => { $("voiceBtn").classList.remove("listening"); if (online && !busy) setStatus("Nexus AI — Online"); };
    rec.onresult = e => runCommand(e.results[0][0].transcript);
    rec.onerror = end;
    rec.onend = end;
    rec.start();
}


/* =========================================
   TEXT COMMAND INPUT
========================================= */

$("sendBtn").onclick = () => runCommand($("command").value);
$("command").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.isComposing) runCommand($("command").value);
});


/* =========================================
   STEP 1 — INSTANT SKILLS
========================================= */

function evalMath(str) {
    const t = str.replace(/\s+/g, "");
    let i = 0;
    const peek = () => t[i];
    function expr() { let v = term(); while (peek() === "+" || peek() === "-") { const o = t[i++]; const r = term(); v = o === "+" ? v + r : v - r; } return v; }
    function term() {
        let v = unary();
        while (peek() === "*" || peek() === "/" || peek() === "%") {
            const o = t[i++]; const r = unary();
            if ((o === "/" || o === "%") && r === 0) throw new Error("div0");
            v = o === "*" ? v * r : o === "/" ? v / r : v % r;
        }
        return v;
    }
    function unary() { if (peek() === "-") { i++; return -unary(); } if (peek() === "+") { i++; return unary(); } return power(); }
    function power() { const b = primary(); if (peek() === "^") { i++; return Math.pow(b, unary()); } return b; }
    function primary() {
        if (peek() === "(") { i++; const v = expr(); if (peek() !== ")") throw new Error("paren"); i++; return v; }
        if (peek() === "√") { i++; const v = primary(); if (v < 0) throw new Error("neg"); return Math.sqrt(v); }
        const m = /^\d*\.?\d+/.exec(t.slice(i));
        if (!m) throw new Error("num");
        i += m[0].length;
        return parseFloat(m[0]);
    }
    const v = expr();
    if (i !== t.length) throw new Error("trailing");
    return v;
}

function tryMath(raw) {
    let s = raw.toLowerCase().replace(/[?=!]+$/, "").trim();
    s = s.replace(/^(?:what(?:'s|s| is)|calculate|calc|compute|solve|evaluate|how much is|work out)\s+/, "")
         .replace(/^the (?:result|answer|value) of\s+/, "");
    s = s.replace(/(\d),(?=\d{3})/g, "$1")
         .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*/g, "($1/100)*")
         .replace(/(?:square root of|sqrt of|sqrt)\s*(\d+(?:\.\d+)?)/g, "√($1)")
         .replace(/(\d+(?:\.\d+)?)\s*squared/g, "($1^2)")
         .replace(/(\d+(?:\.\d+)?)\s*cubed/g, "($1^3)")
         .replace(/to the power of|raised to|\*\*/g, "^")
         .replace(/multiplied by|times|×|\bx\b/g, "*")
         .replace(/divided by|over|÷/g, "/")
         .replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-").replace(/\bmod\b/g, "%");
    if (!/^[\d\s+\-*\/().%^√]+$/.test(s) || !/\d/.test(s) || !/[+\-*\/%^√]/.test(s.replace(/^\s*-/, ""))) return null;
    try {
        const v = evalMath(s);
        if (!isFinite(v)) return null;
        const pretty = s.replace(/\*/g, "×").replace(/\//g, "÷").replace(/\s+/g, " ").trim();
        return "**" + pretty + " = " + Number(v.toPrecision(12)).toLocaleString("en-US", { maximumFractionDigits: 10 }) + "**";
    } catch (e) {
        return e.message === "div0" ? "I can't divide by zero." : null;
    }
}

function instant(raw) {
    const l = raw.toLowerCase().trim().replace(/[?!.]+$/, "");
    const now = new Date(), h = now.getHours();

    if (/^(hi|hello|hey|yo|hola|greetings|good (morning|afternoon|evening))( there)?( (nexus|friday)( ai)?)?$/.test(l) || /\b(hello|hey|hi) (nexus|friday)\b/.test(l))
        return "Good " + (h < 12 ? "morning" : h < 18 ? "afternoon" : "evening") + "! I'm **Nexus AI**. How can I help you today?";
    if (/^how are you/.test(l)) return "I'm running smoothly, thank you! What would you like to know?";
    if (/^(who are you|what are you|what('s| is) your name)/.test(l)) return "I'm **Nexus AI**, a free in-browser assistant. I answer using instant skills, DuckDuckGo and Wikipedia — no paid API keys.";
    if (/^(what can you do|help)$/.test(l)) return "I can **calculate** (try *25 * 48*), tell the **time** and **date**, and look up facts and definitions from **DuckDuckGo** and **Wikipedia**. I also open sites (\"open youtube\"), maps (\"locate Paris\") and the neural system.";
    if (/^(thanks|thank you)/.test(l)) return "You're welcome!";
    if (/\b(what time is it|current time|time now|time right now|tell me the time|what('s| is) the time)\b/.test(l))
        return "It's **" + now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "** (" + (Intl.DateTimeFormat().resolvedOptions().timeZone || "local time") + ").";
    if (/\b(today'?s date|what('s| is) (the |today'?s )?date|what day is it|what('s| is) today)\b/.test(l))
        return "Today is **" + now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + "**.";
    return tryMath(raw);
}


/* =========================================
   STEPS 2–4 — DUCKDUCKGO + WIKIPEDIA
========================================= */

const STOP = new Set("the a an of in on at to is are was were be do does did why how what who when where which for and or with by from it this that as can you me my".split(" "));
const sig = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
const strip = h => new DOMParser().parseFromString(String(h || ""), "text/html").body.textContent.replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
const cleanW = t => strip(t).replace(/\s*\([^()]*[\/\u0250-\u02ff;][^()]*\)/g, "");

async function tfetch(u, ms = 7000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
        const r = await fetch(u, { signal: c.signal });
        if (!r.ok) throw new Error("http");
        return await r.json();
    } finally { clearTimeout(t); }
}

function sents(t) {
    const x = t.replace(/\b(Mr|Mrs|Ms|Dr|St|vs|etc|approx|Inc|Jr|Sr|e\.g|i\.e|U\.S)\./g, "$1\u0001").replace(/\b([A-Z])\./g, "$1\u0001");
    return (x.match(/[^.!?]+(?:[.!?]+|$)\s*/g) || [x]).map(s => s.replace(/\u0001/g, ".").trim()).filter(Boolean);
}

function boldKey(t, k) {
    if (!k || k.length < 2) return t;
    const i = t.toLowerCase().indexOf(k.toLowerCase());
    return i < 0 ? t : t.slice(0, i) + "**" + t.slice(i, i + k.length) + "**" + t.slice(i + k.length);
}

function build(list, key) {
    let out = "";
    list.slice(0, 4).forEach((s, i) => { out += (i ? (i % 2 === 0 ? "\n\n" : " ") : "") + s; });
    return boldKey(out, key);
}

function topicOf(q) {
    return q.trim().replace(/[?!.]+$/, "")
        .replace(/^(?:please\s+)?(?:(?:tell me|explain|describe|define|search for|search|look up|find out|google|wikipedia)\s+(?:about\s+)?|(?:what|who|where)\s+(?:is|are|was|were)\s+(?:an?\s+|the\s+)?(?:meaning of\s+)?)/i, "")
        .trim() || q;
}

async function ddg(topic) {
    const d = await tfetch("https://api.duckduckgo.com/?q=" + encodeURIComponent(topic) + "&format=json&no_html=1&skip_disambig=1");
    const rel = (d.RelatedTopics || []).find(r => r.Text);
    const txt = strip(d.Answer || d.AbstractText || d.Definition || (rel && rel.Text) || "");
    if (!txt) return null;
    return {
        text: build(sents(txt), d.Heading || topic),
        src: { name: d.AbstractSource || d.DefinitionSource || "DuckDuckGo", url: d.AbstractURL || d.DefinitionURL || "" }
    };
}

async function wsum(title) {
    try {
        const d = await tfetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title.replace(/ /g, "_")));
        if (d.type === "disambiguation" || !d.extract) return null;
        return { title: d.title, text: cleanW(d.extract), url: (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || "" };
    } catch (e) { return null; }
}

async function wikiTitle(topic) {
    const o = await tfetch("https://en.wikipedia.org/w/api.php?action=opensearch&search=" + encodeURIComponent(topic) + "&limit=3&namespace=0&format=json&origin=*");
    for (const t of (o[1] || [])) {
        const s = await wsum(t);
        if (s) return { text: build(sents(s.text), s.title), src: { name: "Wikipedia", url: s.url } };
    }
    return null;
}

async function wikiDeep(q) {
    const d = await tfetch("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + encodeURIComponent(q) + "&srlimit=3&format=json&origin=*");
    const hits = (d.query && d.query.search) || [];
    const kw = sig(q);
    let best = null, bestScore = -1;
    for (const h of hits) {
        const s = await wsum(h.title);
        if (!s) continue;
        const ss = sents(s.text);
        const sc = ss.map(x => { const w = sig(x); return kw.filter(k => w.includes(k)).length; });
        const total = sc.reduce((a, b) => a + b, 0);
        if (total > bestScore) { bestScore = total; best = { s, ss, sc }; }
    }
    if (!best) return null;
    const top = best.ss.map((_, i) => i).slice(1).sort((a, b) => best.sc[b] - best.sc[a] || a - b).slice(0, 3);
    const pick = [0].concat(top).sort((a, b) => a - b).map(i => best.ss[i]);
    return { text: build(pick, best.s.title), src: { name: "Wikipedia", url: best.s.url } };
}

async function answer(q) {
    const topic = topicOf(q);
    const questionStyle = /^(why|how|when|which|can|does|do|is|are|should|will)\b/i.test(q);
    const steps = [() => ddg(topic), () => questionStyle ? null : wikiTitle(topic), () => wikiDeep(q)];
    for (const step of steps) {
        try { const r = await step(); if (r && r.text) return r; } catch (e) {}
    }
    return null;
}


/* =========================================
   COMMAND SYSTEM
========================================= */

async function runCommand(text) {
    if (!online) { speak("Please activate Nexus AI first."); toast("Tap Unlock to wake Nexus AI"); return; }
    text = (text || "").trim();
    if (!text || busy) return;
    const lower = text.toLowerCase();

    $("command").value = "";
    addMsg("user", text);

    const reply = (t, src) => { addMsg("ai", t, src, true); speak(t); setStatus("Nexus AI — Online"); setReply("Ready"); };

    if (/neural system|show neural|open neural/.test(lower)) { reply("Opening the **neural system**."); showNeural(); return; }
    if (/exit neural|close neural/.test(lower)) { hideNeural(); reply("Neural system closed."); return; }
    if (/lock (nexus|friday)|sleep mode/.test(lower)) { lockNexus(); return; }
    if (/^(stop|be quiet|stop talking|silence)$/.test(lower)) { speechSynthesis.cancel(); return; }

    if (lower.includes("play golden")) return playDirect("Golden Brown", "https://m.youtube.com/watch?v=BTnM71u_v2I");
    if (lower.includes("play cherry")) return playDirect("Cherry Cherry Lady", "https://m.youtube.com/watch?v=Z4sty2B2bCE");
    if (lower.includes("play favourite") || lower.includes("play favorite")) return playDirect("Favourite", "https://m.youtube.com/watch?v=Fvt9hEAP6oQ");

    if (lower.startsWith("locate ") || (lower.startsWith("find ") && /\b(near|nearby|nearest)\b/.test(lower))) {
        const place = text.replace(/^locate\s+/i, "").replace(/^find\s+/i, "").trim();
        if (place) { locatePlace(place); return; }
    }
    if (lower.startsWith("open ")) { openSite(text.substring(5).trim()); return; }

    const quick = instant(text);
    if (quick) { reply(quick); return; }

    const q = lower.startsWith("find ") ? text.substring(5).trim() : text;
    busy = true;
    $("sendBtn").disabled = true;
    setStatus("Searching...");
    setReply("Searching: " + q);
    showThinking();
    let res = null;
    try { res = await answer(q); } catch (e) {}
    hideThinking();
    busy = false;
    $("sendBtn").disabled = false;
    if (!online) return;
    reply(res ? res.text : "I couldn't find a reliable answer for **" + topicOf(q) + "**. Try rephrasing, or ask about a specific name or topic.", res && res.src);
}

function playDirect(song, url) {
    addMsg("ai", "Playing **" + song + "**.", null, true);
    setStatus("Playing..."); setReply("Playing: " + song);
    speak("Playing " + song);
    window.open(url, "_blank");
}

function locatePlace(place) {
    addMsg("ai", "Locating **" + place + "** on Google Maps.", null, true);
    setStatus("Locating..."); setReply("Locating: " + place);
    speak("Locating " + place);
    window.open("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place), "_blank");
}

function openSite(name) {
    const known = { youtube: "youtube.com", google: "google.com", wikipedia: "wikipedia.org", github: "github.com", gmail: "mail.google.com", instagram: "instagram.com", facebook: "facebook.com", twitter: "x.com", x: "x.com", whatsapp: "web.whatsapp.com", maps: "maps.google.com", spotify: "open.spotify.com", netflix: "netflix.com", reddit: "reddit.com", amazon: "amazon.com" };
    let url = name;
    if (!/^https?:/i.test(url)) {
        const k = name.toLowerCase().replace(/\s+/g, "");
        if (known[k]) url = "https://" + known[k];
        else if (name.includes(".")) url = "https://" + name;
        else { runCommand("what is " + name); return; }
    }
    addMsg("ai", "Opening **" + name + "**.", null, true);
    speak("Opening " + name);
    window.open(url, "_blank");
}


/* =========================================
   NEURAL SYSTEM
========================================= */

$("neuralBtn").onclick = showNeural;
$("exitNeural").onclick = hideNeural;

function showNeural() {
    if (!online) { speak("Neural system unavailable while sleeping."); return; }
    neuralOpen = true;
    $("neuralScreen").style.display = "block";
    startNeural();
    startHands();
}

function hideNeural() {
    neuralOpen = false;
    stopCamera();
    $("neuralScreen").style.display = "none";
}

function startNeural() {
    if (neuralStarted) return;
    neuralStarted = true;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
    camera.position.z = 8;
    renderer = new THREE.WebGLRenderer({ canvas: $("neuralCanvas"), alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    neuralGroup = new THREE.Group();
    scene.add(neuralGroup);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 32), new THREE.MeshBasicMaterial({ color: 0x7c6cff }));
    core.userData = { componentType: "CORE", componentName: "NEXUS AI CORE", code: '// NEXUS AI CORE\nconst core = { role: "central processor", status: "online", connectedNodes: 180 };' };
    coreNode = core;
    neuralGroup.add(core);

    for (let i = 0; i < 180; i++) {
        const node = new THREE.Mesh(new THREE.SphereGeometry(0.025 + Math.random() * 0.025, 8, 8), new THREE.MeshBasicMaterial({ color: 0x58a6ff }));
        const radius = 1 + Math.random() * 2.7, theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
        node.position.set(radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), radius * Math.cos(phi));
        node.userData = { componentType: "NODE", componentName: "NEURON " + (i + 1), code: "// NEURON " + (i + 1) + '\nconst neuron = { type: "neural node", signalStrength: 1.0, active: true };' };
        neuralGroup.add(node);
        nodes.push(node);
    }

    for (let i = 0; i < 130; i++) {
        const a = nodes[Math.floor(Math.random() * nodes.length)];
        const b = nodes[Math.floor(Math.random() * nodes.length)];
        const geometry = new THREE.BufferGeometry().setFromPoints([a.position.clone(), b.position.clone()]);
        const branch = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x58a6ff, transparent: true, opacity: 0.22 }));
        branch.userData = { componentType: "BRANCH", componentName: "SYNAPSE " + (i + 1), code: "// SYNAPSE " + (i + 1) + '\nconst synapse = { from: "NEURON ' + (nodes.indexOf(a) + 1) + '", to: "NEURON ' + (nodes.indexOf(b) + 1) + '", strength: 0.22, enabled: true };' };
        neuralGroup.add(branch);
        branches.push(branch);
    }

    animateNeural();
}

function animateNeural() {
    requestAnimationFrame(animateNeural);
    if (neuralGroup && !neuralPaused) {
        neuralGroup.rotation.y += 0.0015;
        neuralGroup.rotation.x += 0.0005;
    }
    if (renderer) renderer.render(scene, camera);
}


/* =========================================
   HAND TRACKING
========================================= */

$("handBtn").onclick = startHands;

function stopCamera() {
    handRunning = false;
    lastHandX = null; lastHandY = null;
    const v = $("video");
    if (v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
    $("cameraBox").style.display = "none";
}

async function startHands() {
    if (!online) { speak("Activate Nexus AI first."); return; }
    if (handRunning) { stopCamera(); return; }
    if (typeof Hands === "undefined") { speak("Hand tracking library failed to load."); toast("Hand tracking unavailable"); return; }

    $("cameraBox").style.display = "block";
    $("handStatus").textContent = "Starting camera...";

    const hands = new Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.65, minTrackingConfidence: 0.65 });
    hands.onResults(handleHands);

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        $("video").srcObject = stream;
        handRunning = true;
        $("handStatus").textContent = "Hand tracking active";

        async function processFrame() {
            if (!handRunning) return;
            await hands.send({ image: $("video") });
            requestAnimationFrame(processFrame);
        }
        processFrame();
    } catch (error) {
        console.error(error);
        $("handStatus").textContent = "Camera permission required";
        speak("Camera permission is required.");
    }
}

function handleHands(results) {
    const canvas = $("handCanvas");
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        $("handStatus").textContent = "Hand not found";
        lastHandX = null; lastHandY = null;
        return;
    }

    const hand = results.multiHandLandmarks[0];
    $("handStatus").textContent = "Hand tracking active";

    for (const point of hand) {
        ctx.beginPath();
        ctx.arc(point.x * innerWidth, point.y * innerHeight, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#58a6ff";
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#58a6ff";
        ctx.fill();
    }

    const palm = hand[9];
    if (lastHandX !== null && lastHandY !== null && neuralGroup) {
        neuralGroup.rotation.y += (palm.x - lastHandX) * 8;
        neuralGroup.rotation.x += (palm.y - lastHandY) * 6;
    }
    lastHandX = palm.x;
    lastHandY = palm.y;

    const thumb = hand[4], index = hand[8];
    const distance = Math.hypot(thumb.x - index.x, thumb.y - index.y);
    pinchX = (thumb.x + index.x) / 2;
    pinchY = (thumb.y + index.y) / 2;

    if (distance < 0.065) {
        if (!pinch) {
            pinch = true;
            $("gesture").textContent = "🤏 Pinch — select";
            selectNeural();
        }
    } else {
        pinch = false;
        $("gesture").textContent = "✋ Hand — rotate";
    }

    if (isOpen(hand)) {
        neuralPaused = true;
        $("gesture").textContent = "🖐 Open palm — paused";
    } else {
        neuralPaused = false;
    }
}

function isOpen(hand) {
    return hand[8].y < hand[6].y && hand[12].y < hand[10].y && hand[16].y < hand[14].y && hand[20].y < hand[18].y;
}


/* =========================================
   PINCH SELECT + CODE EDITOR
========================================= */

function selectNeural() {
    if (!renderer || !camera || !neuralGroup) return;
    const now = Date.now();
    const doublePinch = now - lastPinchAt < 650;
    lastPinchAt = now;
    const target = findNearestComponent(pinchX, pinchY);
    if (!target) return;
    selectComponent(target, true);
    if (doublePinch) openComponentEditor();
}

function findNearestComponent(nx, ny) {
    const candidates = [...(coreNode ? [coreNode] : []), ...nodes, ...branches];
    const pointer = new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1));
    let best = null, bestDistance = Infinity;
    neuralGroup.updateMatrixWorld(true);
    for (const obj of candidates) {
        const world = new THREE.Vector3();
        if (obj.isLine) {
            const attr = obj.geometry.attributes.position;
            world.fromBufferAttribute(attr, 0).add(new THREE.Vector3().fromBufferAttribute(attr, 1)).multiplyScalar(0.5);
            world.applyMatrix4(neuralGroup.matrixWorld);
        } else obj.getWorldPosition(world);
        world.project(camera);
        if (world.z < -1 || world.z > 1) continue;
        const dist = Math.hypot(world.x - pointer.x, world.y - pointer.y);
        if (dist < (obj.isLine ? 0.24 : 0.34) && dist < bestDistance) { best = obj; bestDistance = dist; }
    }
    if (!best) best = candidates.find(o => o.userData.componentType === "CORE") || candidates[0];
    return best;
}

function selectComponent(obj, zoom) {
    selectedComponent = obj;
    $("selectedTitle").textContent = obj.userData.componentName || "NEURAL COMPONENT";
    $("selectedInfo").textContent = obj.userData.componentType + " selected. Pinch again quickly or tap Edit code.";
    $("gesture").textContent = "Selected: " + obj.userData.componentName;
    if (zoom && camera) {
        camera.position.z = obj.userData.componentType === "CORE" ? 3.1 : (obj.isLine ? 4.1 : 3.5);
        if (obj.isLine) {
            const a = new THREE.Vector3().fromBufferAttribute(obj.geometry.attributes.position, 0);
            const b = new THREE.Vector3().fromBufferAttribute(obj.geometry.attributes.position, 1);
            const mid = a.add(b).multiplyScalar(0.5);
            neuralGroup.position.set(-mid.x * 0.35, -mid.y * 0.35, -mid.z * 0.35);
        } else {
            neuralGroup.position.set(-obj.position.x * 0.25, -obj.position.y * 0.25, -obj.position.z * 0.25);
        }
    }
}

function openComponentEditor() {
    if (!selectedComponent) return;
    $("editorTitle").textContent = selectedComponent.userData.componentName || "Component code";
    $("componentCode").value = selectedComponent.userData.code || "// No code notes.";
    $("editorStatus").textContent = "Edit the component's code notes/logic template.";
    $("codeEditor").style.display = "grid";
}

$("editCodeBtn").onclick = openComponentEditor;
$("closeEditor").onclick = () => { $("codeEditor").style.display = "none"; };
$("saveCode").onclick = () => {
    if (!selectedComponent) return;
    selectedComponent.userData.code = $("componentCode").value;
    $("editorStatus").textContent = "Saved to component (current session).";
};
$("resetCode").onclick = () => {
    if (selectedComponent) $("componentCode").value = selectedComponent.userData.code || "";
};
$("closeHand").onclick = stopCamera;


/* =========================================
   LOGIN / ACCOUNTS (SHA-256 + localStorage)
========================================= */

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const sha = async s => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const randSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

function setAuthMode(m) {
    authMode = m;
    $("tabLogin").classList.toggle("on", m === "login");
    $("tabSignup").classList.toggle("on", m === "signup");
    $("loginSubmit").textContent = m === "login" ? "Login" : "Create Account";
    $("password").autocomplete = m === "login" ? "current-password" : "new-password";
    $("loginStatus").textContent = "";
}

function updateLoginBtn() {
    $("loginBtn").textContent = currentUser ? "Logout · " + currentUser : "Login";
}

function loadChat() {
    chat = uid ? [] : jget(LS.chat(currentUser), []);
    renderChat();
    if (uid && sb) {
        const mine = uid;
        sb.from("chats").select("data").eq("user_id", uid).maybeSingle().then(r => {
            if (mine !== uid) return;
            try { chat = r.data ? JSON.parse(r.data.data || "[]") : []; } catch (e) { chat = []; }
            renderChat();
        }, () => toast("Couldn't load cloud chats"));
    }
}

function loginAs(name) {
    currentUser = name;
    jset(LS.session, name);
    loadChat();
    updateLoginBtn();
    toast("Signed in as " + name);
}

function logout() {
    if (cloudReady) { sb.auth.signOut(); toast("Logged out"); return; }
    currentUser = null;
    try { localStorage.removeItem(LS.session); } catch (e) {}
    loadChat();
    updateLoginBtn();
    toast("Logged out");
}

async function submitAuth() {
    const name = $("username").value.trim(), pass = $("password").value, st = $("loginStatus");
    if (!name || !pass) { st.textContent = "Enter a username and password."; return; }
    if (!(window.crypto && crypto.subtle)) { st.textContent = "Secure hashing needs HTTPS (GitHub Pages works)."; return; }

    const users = jget(LS.users, {}), key = name.toLowerCase();

    if (authMode === "signup") {
        if (!/^[\w.-]{3,20}$/.test(name)) { st.textContent = "Username: 3–20 letters, numbers, . _ -"; return; }
        if (pass.length < 6) { st.textContent = "Password must be at least 6 characters."; return; }
        if (users[key]) { st.textContent = "That username is taken."; return; }
        const salt = randSalt();
        users[key] = { name, salt, hash: await sha(salt + ":" + pass) };
        jset(LS.users, users);
    } else {
        const u = users[key];
        if (!u || u.hash !== await sha(u.salt + ":" + pass)) { st.textContent = "Wrong username or password."; return; }
    }

    $("password").value = "";
    $("loginPanel").style.display = "none";
    loginAs(users[key].name);
}

$("loginBtn").onclick = () => {
    if (currentUser) logout();
    else { setAuthMode("login"); showCloudUI(); $("loginPanel").style.display = "grid"; }
};
$("closeLogin").onclick = () => { $("loginPanel").style.display = "none"; };
$("tabLogin").onclick = () => setAuthMode("login");
$("tabSignup").onclick = () => setAuthMode("signup");
$("loginSubmit").onclick = submitAuth;
$("password").addEventListener("keydown", e => { if (e.key === "Enter") submitAuth(); });


/* =========================================
   RESIZE + STARTUP
========================================= */

window.addEventListener("resize", () => {
    if (!camera || !renderer) return;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

function showCloudUI() {
    $("cloudAuth").style.display = cloudReady ? "block" : "none";
    $("localAuth").style.display = cloudReady ? "none" : "block";
}

function initCloud() {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const st = $("cloudStatus");
    loadChat();
    updateLoginBtn();

    $("emailBtn").onclick = async () => {
        const em = $("authEmail").value.trim();
        if (!/^\S+@\S+\.\S+$/.test(em)) { st.textContent = "Enter a valid email."; return; }
        st.textContent = "Sending...";
        const { error } = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + location.pathname } });
        st.textContent = error ? error.message : "Check your inbox — we sent a secure sign-in link to " + em + ". Open it to log in.";
    };

    const apply = (session, fresh) => {
        const u = session && session.user, nid = u ? u.id : null;
        if (nid === uid) return;
        uid = nid;
        currentUser = u ? ((u.user_metadata && u.user_metadata.name) || u.email) : null;
        loadChat();
        updateLoginBtn();
        if (fresh && u) { $("loginPanel").style.display = "none"; toast("Signed in"); }
    };
    sb.auth.getSession().then(r => apply(r.data.session, false));
    sb.auth.onAuthStateChange((ev, session) => { if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") apply(session, true); });
}

(function init() {
    if (cloudReady) { initCloud(); return; }
    const saved = jget(LS.session, null);
    const users = jget(LS.users, {});
    if (saved && users[String(saved).toLowerCase()]) currentUser = users[String(saved).toLowerCase()].name;
    loadChat();
    updateLoginBtn();
})();
