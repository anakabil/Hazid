import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Shield, LogOut, Plus, Trash2, Pencil, Download, Users, FileText,
  Grid3x3, ListChecks, BarChart3, ChevronLeft, X, Save, AlertTriangle,
  LayoutDashboard, FolderOpen, Wind, Info, ClipboardList, CheckCircle2,
  Search, Lock, User, KeyRound, Eye, EyeOff, Copy
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid
} from "recharts";
import * as XLSX from "xlsx";

/* ============================================================================
   NUSA SAFETY — HAZID ASSESSMENT TOOL
   Single-file React SPA. Mirrors AIRA configuration:
   - window.storage API with in-memory fallback
   - useConfirm() hook for destructive actions
   - No array destructuring in JSX map parameters
   - No AI; manual entry following the CCPS Excel structure
   - Two roles: admin & user (pengguna). No subscription / pricing.
   Reference: CCPS Guidelines for Hazard Evaluation Procedures, 3rd Ed.
============================================================================ */

/* ---------- Brand & risk palette ---------- */
const C = {
  navy: "#1F3864",
  deepNavy: "#0D1F3C",
  red: "#C00000",
  bg: "#EEF1F6",
  card: "#FFFFFF",
  border: "#DDE2EB",
  ink: "#19233A",
  sub: "#64708A",
  faint: "#F4F6FA",
};
const RISK = {
  Acceptable: { bg: "#1A9E5A", fg: "#FFFFFF", label: "Acceptable" },
  Low:        { bg: "#7FB942", fg: "#15280A", label: "Low" },
  Medium:     { bg: "#E8B500", fg: "#3A2E00", label: "Medium" },
  High:       { bg: "#EF7B12", fg: "#FFFFFF", label: "High" },
  Critical:   { bg: "#D62121", fg: "#FFFFFF", label: "Critical" },
};

/* ---------- CCPS reference data ---------- */
const GUIDEWORDS = [
  "NO / NOT", "MORE", "LESS", "REVERSE", "OTHER THAN", "AS WELL AS", "PART OF",
  "EARLY / LATE", "FIRE", "EXPLOSION", "TOXIC RELEASE", "OVERPRESSURE",
  "CONTAMINATION", "CORROSION / EROSION", "LOSS OF CONTAINMENT",
  "WRONG OPERATION", "MAINTENANCE ERROR", "MANAGEMENT OF CHANGE",
  "FLOODING", "EARTHQUAKE", "WIND / LIGHTNING", "THIRD PARTY ACTION",
];

const LIKELIHOOD = [
  { v: 1, name: "Rare", id: "Belum pernah terjadi di industri", freq: "<1E-06" },
  { v: 2, name: "Unlikely", id: "Sangat jarang, bisa terjadi", freq: "1E-06 – 1E-04" },
  { v: 3, name: "Possible", id: "Pernah terjadi di industri sejenis", freq: "1E-04 – 1E-02" },
  { v: 4, name: "Likely", id: "Pernah terjadi di fasilitas ini", freq: "1E-02 – 1E-01" },
  { v: 5, name: "Frequent", id: "Sering terjadi di fasilitas ini", freq: ">0.1" },
];
const CONSEQUENCE = [
  { v: 1, name: "Negligible", safety: "P3K / cedera ringan", env: "Tidak terdeteksi", asset: "<$10K" },
  { v: 2, name: "Minor", safety: "Perawatan medis, tanpa LTI", env: "Minor, di dalam lokasi", asset: "$10K–$100K" },
  { v: 3, name: "Moderate", safety: "LTI / restricted duty", env: "Signifikan, di lokasi", asset: "$100K–$1M" },
  { v: 4, name: "Severe", safety: "Fatality / cacat permanen", env: "Mayor, sebagian keluar", asset: "$1M–$10M" },
  { v: 5, name: "Catastrophic", safety: "Multiple fatality", env: "Masif, lintas batas", asset: ">$10M" },
];
const TOLERANCE = [
  { level: "Acceptable", range: "1–2",  tol: "Tolerable",            action: "Tidak perlu tindakan; dokumentasi" },
  { level: "Low",        range: "3–6",  tol: "Tolerable + kontrol",  action: "Monitor; review safeguard berkala" },
  { level: "Medium",     range: "7–12", tol: "Conditionally tol.",   action: "Langkah mitigasi; rencana tindak lanjut" },
  { level: "High",       range: "13–20",tol: "Intolerable",          action: "Tindakan segera; prioritas rekayasa" },
  { level: "Critical",   range: "21–25",tol: "Unacceptable",         action: "HENTIKAN kegiatan; eskalasi manajemen" },
];
const STATUS_OPTS = ["Open", "In Progress", "Closed", "Deferred", "N/A"];

/* ---------- Risk math ---------- */
function rpnOf(l, c) {
  const L = Number(l), Cv = Number(c);
  if (!L || !Cv) return null;
  return L * Cv;
}
function levelOf(rpn) {
  if (rpn == null) return null;
  if (rpn <= 2) return "Acceptable";
  if (rpn <= 6) return "Low";
  if (rpn <= 12) return "Medium";
  if (rpn <= 20) return "High";
  return "Critical";
}
function priorityOf(rpn) {
  const lv = levelOf(rpn);
  if (lv === "Critical") return "Critical";
  if (lv === "High") return "High";
  if (lv === "Medium") return "Medium";
  return "Low";
}

/* ---------- Storage layer (localStorage + in-memory fallback) ----------
   Same async interface as AIRA's storage wrapper. For a production multi-user /
   multi-device setup, swap the body of get/set for a KV/REST backend (e.g. the
   Upstash pattern used by AIRA). See README → "Upgrade ke backend KV". */
const _mem = {};
const store = {
  async get(key) {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const v = window.localStorage.getItem(key);
        if (v !== null) return v;
      }
    } catch (e) { /* fall through to memory */ }
    return Object.prototype.hasOwnProperty.call(_mem, key) ? _mem[key] : null;
  },
  async set(key, value) {
    _mem[key] = value;
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch (e) { /* memory already holds the value */ }
    return true;
  },
};
async function loadJSON(key, fallback) {
  const v = await store.get(key);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}
async function saveJSON(key, obj) { await store.set(key, JSON.stringify(obj)); }

const K_USERS = "hazid_users";
const K_PROJECTS = "hazid_projects";
const K_SESSION = "hazid_session";

function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function nowISO() { return new Date().toISOString(); }
function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); }
  catch (e) { return "—"; }
}

/* ---------- Confirm hook ---------- */
function useConfirm() {
  const [state, setState] = useState({ open: false, title: "", message: "", danger: true, resolve: null });
  const confirm = useCallback(function (opts) {
    const o = typeof opts === "string" ? { message: opts } : (opts || {});
    return new Promise(function (resolve) {
      setState({
        open: true,
        title: o.title || "Konfirmasi",
        message: o.message || "Anda yakin?",
        danger: o.danger !== false,
        confirmText: o.confirmText || "Hapus",
        resolve: resolve,
      });
    });
  }, []);
  const done = function (val) {
    if (state.resolve) state.resolve(val);
    setState(function (s) { return Object.assign({}, s, { open: false, resolve: null }); });
  };
  const dialog = state.open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(10,18,38,0.55)" }}>
      <div className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
           style={{ background: C.card, border: "1px solid " + C.border }}>
        <div className="px-5 py-4 flex items-center gap-3" style={{ background: state.danger ? "#FBE9E9" : C.faint }}>
          <div className="flex items-center justify-center rounded-full"
               style={{ width: 36, height: 36, background: state.danger ? "#F6D2D2" : "#DCE6F5" }}>
            <AlertTriangle size={18} style={{ color: state.danger ? C.red : C.navy }} />
          </div>
          <h3 className="font-semibold text-base" style={{ color: C.ink }}>{state.title}</h3>
        </div>
        <div className="px-5 py-5 text-sm leading-relaxed" style={{ color: C.sub }}>{state.message}</div>
        <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: "1px solid " + C.border }}>
          <button onClick={function () { done(false); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition"
                  style={{ background: C.faint, color: C.ink, border: "1px solid " + C.border }}>
            Batal
          </button>
          <button onClick={function () { done(true); }}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition"
                  style={{ background: state.danger ? C.red : C.navy }}>
            {state.confirmText}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return { confirm: confirm, ConfirmDialog: dialog };
}

/* ---------- Toast ---------- */
function useToast() {
  const [toast, setToast] = useState(null);
  const ref = useRef(null);
  const show = useCallback(function (msg, kind) {
    setToast({ msg: msg, kind: kind || "ok" });
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(function () { setToast(null); }, 2600);
  }, []);
  const node = toast ? (
    <div className="fixed z-50 bottom-6 left-1/2 -translate-x-1/2 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-medium"
         style={{ background: toast.kind === "err" ? "#7A1010" : C.deepNavy, color: "#fff" }}>
      {toast.kind === "err" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      {toast.msg}
    </div>
  ) : null;
  return { showToast: show, ToastNode: node };
}

/* ---------- Small UI atoms ---------- */
function Field(props) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1" style={{ color: C.sub }}>
        {props.label}{props.required ? <span style={{ color: C.red }}> *</span> : null}
      </span>
      {props.children}
    </label>
  );
}
const inputStyle = {
  width: "100%", padding: "8px 10px", fontSize: 13, borderRadius: 8,
  border: "1px solid " + C.border, color: C.ink, background: "#fff", outline: "none",
};
function TextInput(props) {
  return <input {...props} style={Object.assign({}, inputStyle, props.style || {})} />;
}
function TextArea(props) {
  return <textarea {...props} style={Object.assign({}, inputStyle, { resize: "vertical", minHeight: 64, lineHeight: 1.5 }, props.style || {})} />;
}
function Select(props) {
  return (
    <select {...props} style={Object.assign({}, inputStyle, { appearance: "auto", background: "#fff" }, props.style || {})}>
      {props.children}
    </select>
  );
}
/* Searchable select that references data from other parts of the project.
   options: [{ value, label, hint }]. allowCustom lets the user type a free value. */
function Combobox(props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef(null);
  useEffect(function () {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return function () { document.removeEventListener("mousedown", onDoc); };
  }, []);
  const options = props.options || [];
  const selected = options.find(function (o) { return o.value === props.value; });
  const display = selected ? selected.label : (props.value || "");
  const orphan = props.value && !selected && !props.allowCustom;
  const filtered = options.filter(function (o) {
    if (!q.trim()) return true;
    return (o.label + " " + (o.hint || "")).toLowerCase().indexOf(q.toLowerCase()) >= 0;
  });
  function pick(val) { props.onChange(val); setOpen(false); setQ(""); }
  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div onClick={function () { setOpen(!open); setQ(""); }}
           style={Object.assign({}, inputStyle, {
             cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
             borderColor: orphan ? C.red : C.border,
           })}>
        <span style={{ color: display ? (orphan ? C.red : C.ink) : C.sub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {orphan ? "⚠ " + display + " (tidak ditemukan)" : (display || props.placeholder)}
        </span>
        <Search size={14} style={{ color: C.sub, flexShrink: 0 }} />
      </div>
      {open ? (
        <div style={{ position: "absolute", zIndex: 30, top: "calc(100% + 4px)", left: 0, right: 0, background: "#fff",
                      border: "1px solid " + C.border, borderRadius: 10, boxShadow: "0 12px 32px rgba(16,30,60,0.16)", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid " + C.faint }}>
            <input autoFocus value={q} onChange={function (e) { setQ(e.target.value); }}
                   onKeyDown={function (e) { if (e.key === "Enter" && props.allowCustom && q.trim()) pick(q.trim()); }}
                   placeholder="Ketik untuk mencari…"
                   style={Object.assign({}, inputStyle, { padding: "6px 8px" })} />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "10px 12px", fontSize: 12, color: C.sub }}>
                {props.allowCustom && q.trim() ? "Tekan Enter untuk memakai “" + q + "”" : "Tidak ada hasil"}
              </div>
            ) : filtered.map(function (o) {
              const sel = o.value === props.value;
              return (
                <button key={o.value} onClick={function () { pick(o.value); }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                                 background: sel ? C.faint : "#fff", border: "none", cursor: "pointer" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{o.label}</div>
                  {o.hint ? <div style={{ fontSize: 11, color: C.sub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.hint}</div> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
function RiskBadge(props) {
  const lv = props.level;
  if (!lv) return <span style={{ color: C.sub, fontSize: 12 }}>—</span>;
  const r = RISK[lv];
  return (
    <span className="inline-flex items-center gap-1 rounded-md font-bold"
          style={{ background: r.bg, color: r.fg, fontSize: 11, padding: "3px 8px", letterSpacing: 0.2 }}>
      {props.rpn != null ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{props.rpn}</span> : null}
      {r.label}
    </span>
  );
}
function Btn(props) {
  const variants = {
    primary: { background: C.navy, color: "#fff", border: "1px solid " + C.navy },
    danger:  { background: "#fff", color: C.red, border: "1px solid #E7BcBc" },
    ghost:   { background: "#fff", color: C.ink, border: "1px solid " + C.border },
    solidRed:{ background: C.red, color: "#fff", border: "1px solid " + C.red },
  };
  const v = variants[props.variant || "primary"];
  return (
    <button onClick={props.onClick} disabled={props.disabled} type={props.type || "button"}
      className="inline-flex items-center gap-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
      style={Object.assign({ padding: props.sm ? "6px 12px" : "9px 16px", fontSize: props.sm ? 12 : 13 }, v, props.style || {})}>
      {props.children}
    </button>
  );
}
function Modal(props) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-4 overflow-y-auto"
         style={{ background: "rgba(10,18,38,0.55)" }}>
      <div className="w-full rounded-2xl shadow-2xl my-6"
           style={{ maxWidth: props.wide ? 920 : 640, background: C.card, border: "1px solid " + C.border }}>
        <div className="px-6 py-4 flex items-center justify-between sticky top-0 rounded-t-2xl"
             style={{ background: C.deepNavy }}>
          <h3 className="font-semibold text-white text-base flex items-center gap-2">{props.icon}{props.title}</h3>
          <button onClick={props.onClose} className="text-white/80 hover:text-white"><X size={20} /></button>
        </div>
        <div className="px-6 py-5">{props.children}</div>
        {props.footer ? (
          <div className="px-6 py-4 flex justify-end gap-2" style={{ borderTop: "1px solid " + C.border }}>
            {props.footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================================
   LOGIN
============================================================================ */
function LoginScreen(props) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");

  function submit() {
    const found = props.users.find(function (x) { return x.username.toLowerCase() === u.trim().toLowerCase(); });
    if (!found || found.password !== p) { setErr("Username atau kata sandi salah."); return; }
    setErr("");
    props.onLogin(found);
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4"
         style={{ background: "linear-gradient(135deg, #0D1F3C 0%, #1F3864 55%, #2A4A82 100%)" }}>
      <div className="w-full max-w-4xl grid md:grid-cols-2 rounded-3xl overflow-hidden shadow-2xl"
           style={{ background: C.card }}>
        {/* Left — brand panel */}
        <div className="p-9 flex flex-col justify-between text-white relative"
             style={{ background: "radial-gradient(120% 120% at 0% 0%, #24467F 0%, #0D1F3C 70%)" }}>
          <div>
            <div className="flex items-center gap-2 mb-8">
              <div className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: C.red }}>
                <Shield size={22} />
              </div>
              <div>
                <div className="font-bold tracking-tight" style={{ fontSize: 15 }}>NUSA SAFETY</div>
                <div style={{ fontSize: 10, color: "#A9BBDB" }}>PT. Nusa Rendra Jayatama</div>
              </div>
            </div>
            <h1 className="font-bold leading-tight mb-3" style={{ fontSize: 30, letterSpacing: -0.5 }}>
              HAZID<br />Assessment Tool
            </h1>
            <p style={{ fontSize: 13, color: "#B7C6E2", lineHeight: 1.6, maxWidth: 280 }}>
              Identifikasi bahaya & penilaian risiko terstruktur berbasis CCPS — Guidelines for Hazard Evaluation Procedures.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-8" style={{ fontSize: 11, color: "#8FA4CC" }}>
            <Wind size={14} /> ISO 45001 · SMK3 · QHSE Consulting
          </div>
        </div>

        {/* Right — form */}
        <div className="p-9 flex flex-col justify-center">
          <h2 className="font-bold mb-1" style={{ fontSize: 20, color: C.ink }}>Masuk</h2>
          <p className="mb-6" style={{ fontSize: 13, color: C.sub }}>Silakan masuk untuk melanjutkan penilaian.</p>

          <div className="space-y-4">
            <Field label="Username">
              <div className="relative">
                <User size={15} style={{ position: "absolute", left: 10, top: 10, color: C.sub }} />
                <TextInput value={u} onChange={function (e) { setU(e.target.value); }}
                           onKeyDown={function (e) { if (e.key === "Enter") submit(); }}
                           placeholder="cth. admin" style={{ paddingLeft: 32 }} />
              </div>
            </Field>
            <Field label="Kata Sandi">
              <div className="relative">
                <Lock size={15} style={{ position: "absolute", left: 10, top: 10, color: C.sub }} />
                <TextInput type={showPw ? "text" : "password"} value={p}
                           onChange={function (e) { setP(e.target.value); }}
                           onKeyDown={function (e) { if (e.key === "Enter") submit(); }}
                           placeholder="••••••••" style={{ paddingLeft: 32, paddingRight: 36 }} />
                <button onClick={function () { setShowPw(!showPw); }}
                        style={{ position: "absolute", right: 10, top: 9, color: C.sub }}>
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>

            {err ? (
              <div className="rounded-lg px-3 py-2 text-sm flex items-center gap-2"
                   style={{ background: "#FBE9E9", color: C.red }}>
                <AlertTriangle size={15} /> {err}
              </div>
            ) : null}

            <Btn onClick={submit} style={{ width: "100%", justifyContent: "center", background: C.red, border: "1px solid " + C.red }}>
              <KeyRound size={16} /> Masuk
            </Btn>
          </div>

          <div className="mt-6 rounded-xl p-3" style={{ background: C.faint, border: "1px dashed " + C.border }}>
            <div className="text-xs font-semibold mb-1" style={{ color: C.sub }}>Akun demo</div>
            <div className="text-xs" style={{ color: C.ink, lineHeight: 1.7 }}>
              <div><b>Admin</b> — username <code>admin</code> · sandi <code>admin123</code></div>
              <div><b>Pengguna</b> — username <code>pengguna</code> · sandi <code>user123</code></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   APP SHELL
============================================================================ */
function Shell(props) {
  const user = props.user;
  const nav = props.nav; // [{id,label,icon}]
  return (
    <div className="min-h-screen flex" style={{ background: C.bg }}>
      {/* Sidebar */}
      <aside className="flex flex-col" style={{ width: 232, background: C.deepNavy, color: "#fff" }}>
        <div className="px-5 py-5 flex items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: C.red }}>
            <Shield size={18} />
          </div>
          <div>
            <div className="font-bold tracking-tight" style={{ fontSize: 13 }}>NUSA SAFETY</div>
            <div style={{ fontSize: 9.5, color: "#8FA4CC" }}>HAZID Tool</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(function (item) {
            const active = props.active === item.id;
            return (
              <button key={item.id} onClick={function () { props.onNav(item.id); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition"
                style={{
                  background: active ? "rgba(255,255,255,0.10)" : "transparent",
                  color: active ? "#fff" : "#A9BBDB",
                  fontWeight: active ? 600 : 500,
                  borderLeft: active ? "3px solid " + C.red : "3px solid transparent",
                }}>
                {item.icon}{item.label}
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-2 px-2 mb-3">
            <div className="flex items-center justify-center rounded-full font-bold"
                 style={{ width: 32, height: 32, background: C.navy, fontSize: 13 }}>
              {(user.name || user.username).slice(0, 1).toUpperCase()}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div className="font-semibold truncate" style={{ fontSize: 12.5 }}>{user.name || user.username}</div>
              <div style={{ fontSize: 10, color: "#8FA4CC", textTransform: "capitalize" }}>
                {user.role === "admin" ? "Administrator" : "Pengguna"}
              </div>
            </div>
          </div>
          <button onClick={props.onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: "rgba(255,255,255,0.06)", color: "#C7D3EA" }}>
            <LogOut size={15} /> Keluar
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 flex flex-col">
        {props.children}
      </main>
    </div>
  );
}

function PageHead(props) {
  return (
    <div className="px-7 py-5 flex items-center justify-between flex-wrap gap-3"
         style={{ background: "#fff", borderBottom: "1px solid " + C.border }}>
      <div>
        <h1 className="font-bold" style={{ fontSize: 19, color: C.ink, letterSpacing: -0.3 }}>{props.title}</h1>
        {props.sub ? <p style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{props.sub}</p> : null}
      </div>
      <div className="flex items-center gap-2">{props.actions}</div>
    </div>
  );
}

/* ============================================================================
   USER DASHBOARD — list of projects
============================================================================ */
function ProjectCard(props) {
  const p = props.project;
  const counts = useMemo(function () {
    const c = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
    (p.scenarios || []).forEach(function (s) {
      const lv = levelOf(rpnOf(s.L1, s.C1));
      if (lv) c[lv] += 1;
    });
    return c;
  }, [p]);
  const total = (p.scenarios || []).length;

  return (
    <div className="rounded-2xl overflow-hidden transition hover:shadow-lg"
         style={{ background: "#fff", border: "1px solid " + C.border, boxShadow: "0 1px 2px rgba(16,30,60,0.05)" }}>
      <div className="px-5 py-4" style={{ borderBottom: "1px solid " + C.faint }}>
        <div className="flex items-start justify-between gap-2">
          <div style={{ minWidth: 0 }}>
            <h3 className="font-bold truncate" style={{ fontSize: 15, color: C.ink }}>{p.info.title || "Tanpa Judul"}</h3>
            <p className="truncate" style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>
              {p.info.facility || "—"}{p.info.location ? " · " + p.info.location : ""}
            </p>
          </div>
          <span className="rounded-md font-semibold whitespace-nowrap"
                style={{ fontSize: 10.5, padding: "3px 8px", background: C.faint, color: C.navy, border: "1px solid " + C.border }}>
            {p.info.number || "No. —"}
          </span>
        </div>
        {props.ownerName ? (
          <div className="flex items-center gap-1 mt-2" style={{ fontSize: 11, color: C.sub }}>
            <User size={12} /> {props.ownerName}
          </div>
        ) : null}
      </div>

      <div className="px-5 py-3">
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 11.5, color: C.sub }}>Skenario bahaya</span>
          <span className="font-bold" style={{ fontSize: 13, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{total}</span>
        </div>
        {/* risk distribution bar */}
        <div className="flex rounded-full overflow-hidden" style={{ height: 8, background: C.faint }}>
          {["Critical", "High", "Medium", "Low", "Acceptable"].map(function (lv) {
            const w = total ? (counts[lv] / total) * 100 : 0;
            if (!w) return null;
            return <div key={lv} style={{ width: w + "%", background: RISK[lv].bg }} />;
          })}
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {["Critical", "High", "Medium", "Low", "Acceptable"].map(function (lv) {
            if (!counts[lv]) return null;
            return (
              <span key={lv} className="inline-flex items-center gap-1" style={{ fontSize: 10.5, color: C.sub }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: RISK[lv].bg, display: "inline-block" }} />
                {counts[lv]}
              </span>
            );
          })}
        </div>
      </div>

      <div className="px-5 py-3 flex items-center justify-between" style={{ background: C.faint }}>
        <span style={{ fontSize: 11, color: C.sub }}>Diperbarui {fmtDate(p.updatedAt)}</span>
        <div className="flex items-center gap-1.5">
          <Btn sm variant="primary" onClick={function () { props.onOpen(p.id); }}><FolderOpen size={14} /> Buka</Btn>
          <Btn sm variant="danger" onClick={function () { props.onDelete(p.id); }}><Trash2 size={14} /></Btn>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
   EDITOR TABS
============================================================================ */

/* ---- Tab 1: Project Info ---- */
function InfoTab(props) {
  const info = props.project.info;
  function set(field, val) { props.update(function (pr) { pr.info[field] = val; }); }
  function addMember() {
    props.update(function (pr) { pr.info.team = (pr.info.team || []).concat([{ name: "", company: "", role: "", discipline: "" }]); });
  }
  function setMember(i, field, val) {
    props.update(function (pr) { pr.info.team[i][field] = val; });
  }
  function delMember(i) {
    props.update(function (pr) { pr.info.team = pr.info.team.filter(function (_, idx) { return idx !== i; }); });
  }
  const fields = [
    ["title", "Judul Proyek / Project Title", true],
    ["number", "Nomor Dokumen / Project No.", false],
    ["facility", "Fasilitas / Facility", false],
    ["location", "Lokasi / Location", false],
    ["client", "Klien / Client", false],
    ["consultant", "Konsultan / Consultant", false],
    ["studyDate", "Tanggal Studi / Study Date", false],
    ["leader", "Ketua Studi / Study Leader", false],
    ["rev", "Revisi / Rev", false],
  ];
  return (
    <div className="space-y-6">
      <Section title="Informasi Proyek" icon={<Info size={16} />}>
        <div className="grid md:grid-cols-2 gap-4">
          {fields.map(function (f) {
            return (
              <Field key={f[0]} label={f[1]} required={f[2]}>
                <TextInput value={info[f[0]] || ""} onChange={function (e) { set(f[0], e.target.value); }} />
              </Field>
            );
          })}
        </div>
      </Section>

      <Section title="Tim Studi / Study Team" icon={<Users size={16} />}
               action={<Btn sm variant="ghost" onClick={addMember}><Plus size={14} /> Tambah Anggota</Btn>}>
        {(info.team || []).length === 0 ? (
          <Empty text="Belum ada anggota tim. Klik “Tambah Anggota”." />
        ) : (
          <div className="space-y-2">
            {(info.team || []).map(function (m, i) {
              return (
                <div key={i} className="grid gap-2 items-center"
                     style={{ gridTemplateColumns: "1.4fr 1.4fr 1.2fr 1.2fr auto" }}>
                  <TextInput placeholder="Nama" value={m.name} onChange={function (e) { setMember(i, "name", e.target.value); }} />
                  <TextInput placeholder="Perusahaan" value={m.company} onChange={function (e) { setMember(i, "company", e.target.value); }} />
                  <TextInput placeholder="Jabatan" value={m.role} onChange={function (e) { setMember(i, "role", e.target.value); }} />
                  <TextInput placeholder="Disiplin" value={m.discipline} onChange={function (e) { setMember(i, "discipline", e.target.value); }} />
                  <button onClick={function () { delMember(i); }} className="p-2 rounded-lg" style={{ color: C.red, border: "1px solid #E7BcBc" }}>
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}

/* ---- Tab 2: Risk Criteria (reference) ---- */
function CriteriaTab() {
  function MatrixCell(props) {
    const rpn = props.l * props.c;
    const lv = levelOf(rpn);
    const r = RISK[lv];
    return (
      <td className="text-center font-bold" style={{ background: r.bg, color: r.fg, fontSize: 12, padding: "10px 4px", border: "1px solid #fff" }}>
        {rpn}
      </td>
    );
  }
  return (
    <div className="space-y-6">
      <Section title="Kriteria Kemungkinan (Likelihood)" icon={<BarChart3 size={16} />} sub="Ref: CCPS Table 2-2">
        <RefTable head={["Level", "Rating", "Deskripsi (ID)", "Frekuensi / tahun"]}
                  rows={LIKELIHOOD.map(function (x) { return [String(x.v), x.name, x.id, x.freq]; })}
                  colorIdx={0} colors={["#D6E4F0", "#D6E4F0", "#FFF2CC", "#FCE4D6", "#F6D2D2"]} />
      </Section>

      <Section title="Kriteria Konsekuensi (Consequence)" icon={<BarChart3 size={16} />} sub="Ref: CCPS Table 2-3">
        <RefTable head={["Level", "Rating", "Keselamatan", "Lingkungan", "Aset"]}
                  rows={CONSEQUENCE.map(function (x) { return [String(x.v), x.name, x.safety, x.env, x.asset]; })}
                  colorIdx={0} colors={["#E2EFDA", "#D6E4F0", "#FFF2CC", "#FCE4D6", "#F6D2D2"]} />
      </Section>

      <Section title="Matriks Risiko 5×5" icon={<Grid3x3 size={16} />} sub="RPN = Kemungkinan × Konsekuensi">
        <div className="overflow-x-auto">
          <table style={{ borderCollapse: "collapse", minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ background: "#D9D9D9", color: C.navy, fontSize: 10.5, padding: 8, border: "1px solid #fff" }}>L ↓ / C →</th>
                {CONSEQUENCE.map(function (c) {
                  return <th key={c.v} style={{ background: C.red, color: "#fff", fontSize: 11, padding: 8, border: "1px solid #fff" }}>{c.v}. {c.name}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {LIKELIHOOD.slice().reverse().map(function (l) {
                return (
                  <tr key={l.v}>
                    <th style={{ background: C.red, color: "#fff", fontSize: 11, padding: 8, border: "1px solid #fff", whiteSpace: "nowrap" }}>{l.v}. {l.name}</th>
                    {CONSEQUENCE.map(function (c) { return <MatrixCell key={c.v} l={l.v} c={c.v} />; })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Tingkat Toleransi Risiko" icon={<ListChecks size={16} />}>
        <RefTable head={["Tingkat", "RPN", "Tolerabilitas", "Tindakan Wajib"]}
                  rows={TOLERANCE.map(function (t) { return [t.level, t.range, t.tol, t.action]; })}
                  badgeIdx={0} />
      </Section>
    </div>
  );
}

function RefTable(props) {
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid " + C.border }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            {props.head.map(function (h, i) {
              return <th key={i} style={{ background: C.navy, color: "#fff", textAlign: "left", padding: "9px 12px", fontSize: 11.5, fontWeight: 600 }}>{h}</th>;
            })}
          </tr>
        </thead>
        <tbody>
          {props.rows.map(function (row, ri) {
            const rowBg = props.colors ? props.colors[ri] : (ri % 2 ? C.faint : "#fff");
            return (
              <tr key={ri} style={{ background: rowBg }}>
                {row.map(function (cell, ci) {
                  if (props.badgeIdx === ci) {
                    return <td key={ci} style={{ padding: "8px 12px", borderTop: "1px solid " + C.border }}><RiskBadge level={cell} /></td>;
                  }
                  const bold = (props.colorIdx === ci);
                  return <td key={ci} style={{ padding: "8px 12px", borderTop: "1px solid " + C.border, color: C.ink, fontWeight: bold ? 700 : 400, textAlign: bold ? "center" : "left", width: bold ? 56 : "auto" }}>{cell}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Tab 3: Nodes ---- */
function NodesTab(props) {
  const nodes = props.project.nodes || [];
  const scenarios = props.project.scenarios || [];
  const [editing, setEditing] = useState(null); // node object or {new:true}
  const { confirm, ConfirmDialog } = useConfirm();

  const usage = {};
  scenarios.forEach(function (s) { usage[s.nodeCode] = (usage[s.nodeCode] || 0) + 1; });

  function blank() { return { id: "", code: "", descEn: "", descId: "", drawing: "", boundaries: "", included: "", excluded: "" }; }
  function save(n) {
    props.update(function (pr) {
      if (n.id) {
        pr.nodes = pr.nodes.map(function (x) { return x.id === n.id ? n : x; });
      } else {
        n.id = uid("node");
        pr.nodes = (pr.nodes || []).concat([n]);
      }
    });
    setEditing(null);
  }
  async function del(node) {
    const used = usage[node.code] || 0;
    const msg = used > 0
      ? "Node “" + node.code + "” dipakai oleh " + used + " skenario. Skenario tersebut tidak ikut terhapus, namun kolom Node-nya akan ditandai tidak valid sampai diperbaiki. Lanjut hapus?"
      : "Hapus node “" + node.code + "”? Tindakan ini permanen.";
    const ok = await confirm({ title: "Hapus Node", message: msg });
    if (!ok) return;
    props.update(function (pr) { pr.nodes = pr.nodes.filter(function (x) { return x.id !== node.id; }); });
  }

  return (
    <div>
      {ConfirmDialog}
      <Section title="Node Studi HAZID" icon={<Grid3x3 size={16} />}
               sub="Batasan & sistem yang dikaji (CCPS §2.3). Kolom “Dipakai” menautkan ke lembar kerja."
               action={<Btn sm onClick={function () { setEditing(blank()); }}><Plus size={14} /> Tambah Node</Btn>}>
        {nodes.length === 0 ? <Empty text="Belum ada node. Definisikan node untuk membatasi lingkup studi." /> : (
          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid " + C.border }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {["Kode", "Deskripsi", "Drawing", "Batasan", "Dipakai", ""].map(function (h, i) {
                    return <th key={i} style={{ background: C.navy, color: "#fff", textAlign: i === 4 ? "center" : "left", padding: "9px 12px", fontSize: 11.5 }}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {nodes.map(function (n, i) {
                  const used = usage[n.code] || 0;
                  return (
                    <tr key={n.id} style={{ background: i % 2 ? C.faint : "#fff" }}>
                      <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, fontWeight: 700, color: C.navy, fontFamily: "ui-monospace, monospace" }}>{n.code || "—"}</td>
                      <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, color: C.ink }}>
                        <div style={{ fontWeight: 600 }}>{n.descId || n.descEn || "—"}</div>
                        {n.descEn && n.descId ? <div style={{ color: C.sub, fontSize: 11 }}>{n.descEn}</div> : null}
                      </td>
                      <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, color: C.sub, fontSize: 11.5 }}>{n.drawing || "—"}</td>
                      <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, color: C.sub, fontSize: 11.5, maxWidth: 280 }}>{n.boundaries || "—"}</td>
                      <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, textAlign: "center" }}>
                        <span className="rounded-full font-bold" style={{ fontSize: 11, padding: "2px 9px", background: used ? "#DCE6F5" : C.faint, color: used ? C.navy : C.sub, fontVariantNumeric: "tabular-nums" }}>{used}</span>
                      </td>
                      <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, whiteSpace: "nowrap" }}>
                        <button onClick={function () { setEditing(n); }} className="p-1.5 rounded-md" style={{ color: C.navy, border: "1px solid " + C.border, marginRight: 4 }}><Pencil size={14} /></button>
                        <button onClick={function () { del(n); }} className="p-1.5 rounded-md" style={{ color: C.red, border: "1px solid #E7BcBc" }}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <NodeModal node={editing} onClose={function () { setEditing(null); }} onSave={save} />
    </div>
  );
}

function NodeModal(props) {
  const [n, setN] = useState(props.node || null);
  useEffect(function () { setN(props.node ? Object.assign({}, props.node) : null); }, [props.node]);
  if (!n) return null;
  function f(k, v) { setN(function (s) { return Object.assign({}, s, { [k]: v }); }); }
  return (
    <Modal open={true} onClose={props.onClose} wide
           icon={<Grid3x3 size={18} />} title={n.id ? "Edit Node" : "Tambah Node"}
           footer={<>
             <Btn variant="ghost" onClick={props.onClose}>Batal</Btn>
             <Btn onClick={function () { props.onSave(n); }}><Save size={15} /> Simpan</Btn>
           </>}>
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Kode Node (cth. N-01)" required>
          <TextInput value={n.code} onChange={function (e) { f("code", e.target.value); }} placeholder="N-01" />
        </Field>
        <Field label="Drawing / P&ID Ref">
          <TextInput value={n.drawing} onChange={function (e) { f("drawing", e.target.value); }} />
        </Field>
        <Field label="Deskripsi (ID)">
          <TextInput value={n.descId} onChange={function (e) { f("descId", e.target.value); }} />
        </Field>
        <Field label="Description (EN)">
          <TextInput value={n.descEn} onChange={function (e) { f("descEn", e.target.value); }} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Batasan / Boundaries">
            <TextArea value={n.boundaries} onChange={function (e) { f("boundaries", e.target.value); }} />
          </Field>
        </div>
        <Field label="Sistem Termasuk / Included">
          <TextArea value={n.included} onChange={function (e) { f("included", e.target.value); }} />
        </Field>
        <Field label="Sistem Dikecualikan / Excluded">
          <TextArea value={n.excluded} onChange={function (e) { f("excluded", e.target.value); }} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---- Tab 4: HAZID Worksheet ---- */
function WorksheetTab(props) {
  const project = props.project;
  const scenarios = project.scenarios || [];
  const nodes = project.nodes || [];
  const [editing, setEditing] = useState(null);
  const { confirm, ConfirmDialog } = useConfirm();

  function nodeLabel(code) {
    const n = nodes.find(function (x) { return x.code === code; });
    return n ? (n.code + (n.descId ? " — " + n.descId : "")) : code;
  }
  function nextRef() {
    let max = 0;
    scenarios.forEach(function (s) {
      const m = (s.actionRef || "").match(/(\d+)/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return "ACT-" + String(max + 1).padStart(3, "0");
  }
  function blank() {
    return {
      id: "", nodeCode: nodes[0] ? nodes[0].code : "", guideword: GUIDEWORDS[0],
      deviation: "", hazard: "", causes: "", consequences: "", safeguards: "",
      L1: "", C1: "", recommendation: "", party: "", targetDate: "", status: "Open",
      L2: "", C2: "", actionRef: nextRef(),
    };
  }
  function save(s) {
    props.update(function (pr) {
      if (s.id) {
        pr.scenarios = pr.scenarios.map(function (x) { return x.id === s.id ? s : x; });
      } else {
        s.id = uid("sc");
        pr.scenarios = (pr.scenarios || []).concat([s]);
      }
    });
    setEditing(null);
  }
  async function del(id) {
    const ok = await confirm({ title: "Hapus Skenario", message: "Skenario bahaya ini akan dihapus permanen." });
    if (!ok) return;
    props.update(function (pr) { pr.scenarios = pr.scenarios.filter(function (x) { return x.id !== id; }); });
  }

  return (
    <div>
      {ConfirmDialog}
      <Section title="Lembar Kerja HAZID" icon={<FileText size={16} />}
               sub={scenarios.length + " skenario · RPN dihitung otomatis (L × C)"}
               action={
                 <Btn sm onClick={function () {
                   if (nodes.length === 0) { props.onNeedNode(); return; }
                   setEditing(blank());
                 }}><Plus size={14} /> Tambah Skenario</Btn>
               }>
        {nodes.length === 0 ? (
          <Empty text="Definisikan minimal satu Node terlebih dahulu pada tab “Node HAZID” sebelum menambah skenario." />
        ) : scenarios.length === 0 ? (
          <Empty text="Belum ada skenario bahaya. Klik “Tambah Skenario” untuk memulai penilaian." />
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid " + C.border }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: 1180 }}>
              <thead>
                <tr>
                  {["No", "Node", "Guideword", "Deskripsi Bahaya", "Penyebab", "Konsekuensi", "Safeguard", "Awal", "Rekomendasi", "PJ", "Status", "Sisa", "Ref", ""].map(function (h, i) {
                    return <th key={i} style={{ background: C.deepNavy, color: "#fff", textAlign: "left", padding: "8px 10px", fontSize: 10.5, fontWeight: 600, position: "sticky", top: 0, whiteSpace: "nowrap" }}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {scenarios.map(function (s, i) {
                  const r1 = rpnOf(s.L1, s.C1), l1 = levelOf(r1);
                  const r2 = rpnOf(s.L2, s.C2), l2 = levelOf(r2);
                  const nodeKnown = nodes.some(function (n) { return n.code === s.nodeCode; });
                  return (
                    <tr key={s.id} style={{ background: i % 2 ? C.faint : "#fff", verticalAlign: "top" }}>
                      <td style={cellTd()}><span style={{ fontWeight: 700, color: C.navy }}>{i + 1}</span></td>
                      <td style={cellTd()}>
                        <span title={nodeKnown ? nodeLabel(s.nodeCode) : "Node tidak ditemukan — sudah dihapus?"}
                              style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: nodeKnown ? C.navy : C.red }}>
                          {nodeKnown ? s.nodeCode : "⚠ " + s.nodeCode}
                        </span>
                      </td>
                      <td style={cellTd()}><span style={{ fontWeight: 600 }}>{s.guideword}</span></td>
                      <td style={cellTd(220)}>{trim(s.hazard, 160)}</td>
                      <td style={cellTd(180)}>{trim(s.causes, 120)}</td>
                      <td style={cellTd(180)}>{trim(s.consequences, 120)}</td>
                      <td style={cellTd(160)}>{trim(s.safeguards, 100)}</td>
                      <td style={cellTd()}><RiskBadge level={l1} rpn={r1} /></td>
                      <td style={cellTd(200)}>{trim(s.recommendation, 140)}</td>
                      <td style={cellTd(110)}>{s.party || "—"}</td>
                      <td style={cellTd()}><StatusChip status={s.status} /></td>
                      <td style={cellTd()}><RiskBadge level={l2} rpn={r2} /></td>
                      <td style={cellTd()}><span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10.5, color: C.sub }}>{s.actionRef}</span></td>
                      <td style={cellTd()}>
                        <div className="flex gap-1">
                          <button onClick={function () { setEditing(s); }} className="p-1 rounded" style={{ color: C.navy, border: "1px solid " + C.border }}><Pencil size={13} /></button>
                          <button onClick={function () { del(s.id); }} className="p-1 rounded" style={{ color: C.red, border: "1px solid #E7BcBc" }}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <ScenarioModal scenario={editing} nodes={nodes} team={project.info.team || []} onClose={function () { setEditing(null); }} onSave={save} />
    </div>
  );
}

function cellTd(maxW) {
  return { padding: "8px 10px", borderTop: "1px solid " + C.border, color: C.ink, maxWidth: maxW || undefined, lineHeight: 1.45 };
}
function trim(t, n) {
  if (!t) return "—";
  return t.length > n ? t.slice(0, n) + "…" : t;
}
function StatusChip(props) {
  const map = {
    "Open": { bg: "#FBE0E0", fg: "#9A1B1B" },
    "In Progress": { bg: "#FCEFCB", fg: "#7A5800" },
    "Closed": { bg: "#DCF0DC", fg: "#1C6B1C" },
    "Deferred": { bg: "#DEE9F8", fg: "#1F4B8E" },
    "N/A": { bg: "#E8EAEF", fg: "#555" },
  };
  const m = map[props.status] || map["N/A"];
  return <span className="rounded font-semibold whitespace-nowrap" style={{ background: m.bg, color: m.fg, fontSize: 10.5, padding: "2px 7px" }}>{props.status}</span>;
}

function ScenarioModal(props) {
  const [s, setS] = useState(null);
  useEffect(function () { setS(props.scenario ? Object.assign({}, props.scenario) : null); }, [props.scenario]);
  if (!s) return null;
  function f(k, v) { setS(function (x) { return Object.assign({}, x, { [k]: v }); }); }
  const r1 = rpnOf(s.L1, s.C1), l1 = levelOf(r1);
  const r2 = rpnOf(s.L2, s.C2), l2 = levelOf(r2);

  // Cross-references to other parts of the project
  const nodeOptions = (props.nodes || []).map(function (n) {
    return { value: n.code, label: n.code + (n.descId ? " — " + n.descId : ""), hint: n.boundaries || n.included || "" };
  });
  const gwOptions = GUIDEWORDS.map(function (g) { return { value: g, label: g }; });
  const partyOptions = (props.team || []).filter(function (m) { return (m.name || "").trim(); })
    .map(function (m) { return { value: m.name, label: m.name, hint: [m.role, m.company].filter(Boolean).join(" · ") }; });
  const selectedNode = (props.nodes || []).find(function (n) { return n.code === s.nodeCode; });

  function ScoreRow(props2) {
    return (
      <div className="rounded-xl p-4" style={{ background: props2.tint, border: "1px solid " + C.border }}>
        <div className="font-semibold mb-3 flex items-center gap-2" style={{ fontSize: 12.5, color: C.ink }}>
          {props2.title}
          <div className="ml-auto"><RiskBadge level={props2.level} rpn={props2.rpn} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kemungkinan (L)">
            <Select value={props2.lVal} onChange={function (e) { props2.onL(e.target.value); }}>
              <option value="">—</option>
              {LIKELIHOOD.map(function (x) { return <option key={x.v} value={x.v}>{x.v} · {x.name}</option>; })}
            </Select>
          </Field>
          <Field label="Konsekuensi (C)">
            <Select value={props2.cVal} onChange={function (e) { props2.onC(e.target.value); }}>
              <option value="">—</option>
              {CONSEQUENCE.map(function (x) { return <option key={x.v} value={x.v}>{x.v} · {x.name}</option>; })}
            </Select>
          </Field>
        </div>
      </div>
    );
  }

  return (
    <Modal open={true} onClose={props.onClose} wide
           icon={<FileText size={18} />} title={s.id ? "Edit Skenario Bahaya" : "Tambah Skenario Bahaya"}
           footer={<>
             <Btn variant="ghost" onClick={props.onClose}>Batal</Btn>
             <Btn onClick={function () { props.onSave(s); }}><Save size={15} /> Simpan Skenario</Btn>
           </>}>
      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Node (referensi ke Node HAZID)" required>
            <Combobox value={s.nodeCode} onChange={function (v) { f("nodeCode", v); }}
                      options={nodeOptions} placeholder="Cari & pilih node…" />
          </Field>
          <Field label="Guideword / Kata Panduan" required>
            <Combobox value={s.guideword} onChange={function (v) { f("guideword", v); }}
                      options={gwOptions} placeholder="Cari guideword…" />
          </Field>
        </div>

        {selectedNode ? (
          <div className="rounded-lg px-3 py-2.5" style={{ background: "#EAF0FA", border: "1px solid #CDDBF1" }}>
            <div className="flex items-center gap-2 mb-0.5">
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: C.navy, fontSize: 12 }}>{selectedNode.code}</span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{selectedNode.descId || selectedNode.descEn}</span>
              {selectedNode.drawing ? <span style={{ marginLeft: "auto", fontSize: 10.5, color: C.sub }}>{selectedNode.drawing}</span> : null}
            </div>
            {selectedNode.boundaries ? <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.5 }}><b>Batasan:</b> {selectedNode.boundaries}</div> : null}
          </div>
        ) : (props.nodes || []).length === 0 ? (
          <div className="rounded-lg px-3 py-2.5 flex items-center gap-2" style={{ background: "#FBE9E9", color: C.red, fontSize: 12 }}>
            <AlertTriangle size={14} /> Belum ada node. Tutup dan definisikan node pada tab “Node HAZID”.
          </div>
        ) : null}

        <Field label="Penyimpangan / Deviation">
          <TextInput value={s.deviation} onChange={function (e) { f("deviation", e.target.value); }} placeholder="cth. Kebakaran Nacelle / Nacelle Fire" />
        </Field>
        <Field label="Deskripsi Bahaya / Hazard Description" required>
          <TextArea value={s.hazard} onChange={function (e) { f("hazard", e.target.value); }} />
        </Field>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Penyebab / Causes">
            <TextArea value={s.causes} onChange={function (e) { f("causes", e.target.value); }} />
          </Field>
          <Field label="Konsekuensi / Consequences">
            <TextArea value={s.consequences} onChange={function (e) { f("consequences", e.target.value); }} />
          </Field>
        </div>
        <Field label="Pengaman Eksisting / Existing Safeguards">
          <TextArea value={s.safeguards} onChange={function (e) { f("safeguards", e.target.value); }} />
        </Field>

        <ScoreRow title="Risiko Awal / Initial Risk" tint="#FDF1E7" level={l1} rpn={r1}
                  lVal={s.L1} cVal={s.C1} onL={function (v) { f("L1", v); }} onC={function (v) { f("C1", v); }} />

        <Field label="Rekomendasi Tindakan / Recommended Action">
          <TextArea value={s.recommendation} onChange={function (e) { f("recommendation", e.target.value); }} />
        </Field>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Penanggung Jawab (dari Tim Studi)">
            <Combobox value={s.party} onChange={function (v) { f("party", v); }}
                      options={partyOptions} allowCustom placeholder="Pilih atau ketik…" />
          </Field>
          <Field label="Target Tanggal">
            <TextInput value={s.targetDate} onChange={function (e) { f("targetDate", e.target.value); }} placeholder="cth. Q3 2026" />
          </Field>
          <Field label="Status">
            <Select value={s.status} onChange={function (e) { f("status", e.target.value); }}>
              {STATUS_OPTS.map(function (o) { return <option key={o} value={o}>{o}</option>; })}
            </Select>
          </Field>
        </div>

        <ScoreRow title="Risiko Sisa / Residual Risk" tint="#EAF4EC" level={l2} rpn={r2}
                  lVal={s.L2} cVal={s.C2} onL={function (v) { f("L2", v); }} onC={function (v) { f("C2", v); }} />

        <Field label="No. Referensi Tindakan">
          <TextInput value={s.actionRef} onChange={function (e) { f("actionRef", e.target.value); }} style={{ maxWidth: 180, fontFamily: "ui-monospace, monospace" }} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---- Tab 5: Action Register (derived) ---- */
function ActionsTab(props) {
  const project = props.project;
  const scenarios = (project.scenarios || []).filter(function (s) { return (s.recommendation || "").trim().length > 0; });

  function setStatus(id, val) {
    props.update(function (pr) {
      pr.scenarios = pr.scenarios.map(function (x) { return x.id === id ? Object.assign({}, x, { status: val }) : x; });
    });
  }

  return (
    <Section title="Daftar Tindakan / Action Register" icon={<ClipboardList size={16} />}
             sub="Otomatis dari skenario yang memiliki rekomendasi. Status dapat diperbarui di sini.">
      {scenarios.length === 0 ? (
        <Empty text="Belum ada tindakan. Tambahkan rekomendasi pada skenario di lembar kerja HAZID." />
      ) : (
        <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid " + C.border }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: 980 }}>
            <thead>
              <tr>
                {["Ref", "Node", "Rekomendasi Tindakan", "Penanggung Jawab", "Target", "Prioritas", "Status"].map(function (h, i) {
                  return <th key={i} style={{ background: C.red, color: "#fff", textAlign: "left", padding: "8px 11px", fontSize: 11, fontWeight: 600 }}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {scenarios.map(function (s, i) {
                const prio = priorityOf(rpnOf(s.L1, s.C1));
                const pColor = { Critical: RISK.Critical, High: RISK.High, Medium: RISK.Medium, Low: RISK.Low }[prio];
                return (
                  <tr key={s.id} style={{ background: i % 2 ? C.faint : "#fff", verticalAlign: "top" }}>
                    <td style={cellTd()}><span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: C.navy }}>{s.actionRef}</span></td>
                    <td style={cellTd()}><span style={{ fontFamily: "ui-monospace, monospace", color: C.navy }}>{s.nodeCode}</span></td>
                    <td style={cellTd(380)}>{s.recommendation}</td>
                    <td style={cellTd(140)}>{s.party || "—"}</td>
                    <td style={cellTd()}>{s.targetDate || "—"}</td>
                    <td style={cellTd()}>
                      <span className="rounded font-semibold" style={{ background: pColor.bg, color: pColor.fg, fontSize: 10.5, padding: "2px 8px" }}>{prio}</span>
                    </td>
                    <td style={cellTd()}>
                      <Select value={s.status} onChange={function (e) { setStatus(s.id, e.target.value); }} style={{ padding: "5px 8px", fontSize: 11.5, minWidth: 120 }}>
                        {STATUS_OPTS.map(function (o) { return <option key={o} value={o}>{o}</option>; })}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/* ---- Tab 6: Summary ---- */
function SummaryTab(props) {
  const project = props.project;
  const scenarios = project.scenarios || [];

  const stats = useMemo(function () {
    const init = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
    const resid = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
    const statusCount = { "Open": 0, "In Progress": 0, "Closed": 0, "Deferred": 0, "N/A": 0 };
    let actions = 0;
    scenarios.forEach(function (s) {
      const l1 = levelOf(rpnOf(s.L1, s.C1));
      if (l1) init[l1] += 1;
      const l2 = levelOf(rpnOf(s.L2, s.C2));
      if (l2) resid[l2] += 1;
      if ((s.recommendation || "").trim()) {
        actions += 1;
        statusCount[s.status] = (statusCount[s.status] || 0) + 1;
      }
    });
    const closed = statusCount["Closed"];
    const completion = actions ? Math.round((closed / actions) * 100) : 0;
    return { init: init, resid: resid, statusCount: statusCount, actions: actions, closed: closed, completion: completion };
  }, [scenarios]);

  const chartData = ["Acceptable", "Low", "Medium", "High", "Critical"].map(function (lv) {
    return { name: lv, Awal: stats.init[lv], Sisa: stats.resid[lv], color: RISK[lv].bg };
  });

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Skenario" value={scenarios.length} icon={<FileText size={18} />} tint={C.navy} />
        <StatCard label="Total Tindakan" value={stats.actions} icon={<ClipboardList size={18} />} tint={C.red} />
        <StatCard label="Tindakan Selesai" value={stats.closed} icon={<CheckCircle2 size={18} />} tint="#1A9E5A" />
        <StatCard label="Penyelesaian" value={stats.completion + "%"} icon={<BarChart3 size={18} />} tint="#7A5800" />
      </div>

      <Section title="Distribusi Risiko: Awal vs Sisa" icon={<BarChart3 size={16} />}>
        {scenarios.length === 0 ? <Empty text="Belum ada data untuk ditampilkan." /> : (
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 10, right: 16, left: -10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF1F6" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: C.sub }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: C.sub }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid " + C.border, fontSize: 12 }} />
                <Bar dataKey="Awal" radius={[4, 4, 0, 0]} maxBarSize={42}>
                  {chartData.map(function (d, i) { return <Cell key={i} fill={d.color} />; })}
                </Bar>
                <Bar dataKey="Sisa" radius={[4, 4, 0, 0]} maxBarSize={42} fillOpacity={0.45}>
                  {chartData.map(function (d, i) { return <Cell key={i} fill={d.color} />; })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="flex items-center gap-5 mt-1 justify-center" style={{ fontSize: 11.5, color: C.sub }}>
          <span className="inline-flex items-center gap-1.5"><span style={{ width: 12, height: 12, borderRadius: 3, background: C.navy, display: "inline-block" }} /> Awal (solid)</span>
          <span className="inline-flex items-center gap-1.5"><span style={{ width: 12, height: 12, borderRadius: 3, background: C.navy, opacity: 0.45, display: "inline-block" }} /> Sisa (transparan)</span>
        </div>
      </Section>

      <div className="grid lg:grid-cols-2 gap-6">
        <Section title="Hitungan per Tingkat Risiko (Awal)" icon={<Grid3x3 size={16} />}>
          <div className="space-y-2">
            {["Critical", "High", "Medium", "Low", "Acceptable"].map(function (lv) {
              const n = stats.init[lv];
              const pct = scenarios.length ? Math.round((n / scenarios.length) * 100) : 0;
              return (
                <div key={lv} className="flex items-center gap-3">
                  <div style={{ width: 90 }}><RiskBadge level={lv} /></div>
                  <div className="flex-1 rounded-full overflow-hidden" style={{ height: 10, background: C.faint }}>
                    <div style={{ width: pct + "%", height: "100%", background: RISK[lv].bg }} />
                  </div>
                  <div style={{ width: 64, textAlign: "right", fontSize: 12, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
                    <b>{n}</b> <span style={{ color: C.sub }}>({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Status Tindakan" icon={<ListChecks size={16} />}>
          <div className="space-y-2">
            {STATUS_OPTS.map(function (st) {
              const n = stats.statusCount[st] || 0;
              const pct = stats.actions ? Math.round((n / stats.actions) * 100) : 0;
              return (
                <div key={st} className="flex items-center gap-3">
                  <div style={{ width: 90 }}><StatusChip status={st} /></div>
                  <div className="flex-1 rounded-full overflow-hidden" style={{ height: 10, background: C.faint }}>
                    <div style={{ width: pct + "%", height: "100%", background: C.navy }} />
                  </div>
                  <div style={{ width: 64, textAlign: "right", fontSize: 12, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
                    <b>{n}</b> <span style={{ color: C.sub }}>({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}

function StatCard(props) {
  return (
    <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: "#fff", border: "1px solid " + C.border }}>
      <div className="flex items-center justify-center rounded-xl text-white" style={{ width: 44, height: 44, background: props.tint }}>
        {props.icon}
      </div>
      <div>
        <div className="font-bold" style={{ fontSize: 24, color: C.ink, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
        <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>{props.label}</div>
      </div>
    </div>
  );
}

/* ---- shared section + empty ---- */
function Section(props) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid " + C.border }}>
      <div className="px-5 py-3.5 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid " + C.faint }}>
        <div className="flex items-center gap-2.5" style={{ color: C.navy }}>
          {props.icon}
          <div>
            <h3 className="font-bold" style={{ fontSize: 14, color: C.ink }}>{props.title}</h3>
            {props.sub ? <p style={{ fontSize: 11.5, color: C.sub, marginTop: 1 }}>{props.sub}</p> : null}
          </div>
        </div>
        {props.action}
      </div>
      <div className="px-5 py-5">{props.children}</div>
    </div>
  );
}
function Empty(props) {
  return (
    <div className="text-center py-10 rounded-xl" style={{ background: C.faint, border: "1px dashed " + C.border }}>
      <p style={{ fontSize: 13, color: C.sub }}>{props.text}</p>
    </div>
  );
}

/* ============================================================================
   REPORT TAB — comprehensive, sortable management report (+ print to PDF)
============================================================================ */
const LEVEL_RANK = { Critical: 5, High: 4, Medium: 3, Low: 2, Acceptable: 1 };

function ReportTab(props) {
  const project = props.project;
  const info = project.info || {};
  const scenarios = project.scenarios || [];
  const nodes = project.nodes || [];
  const [sortBy, setSortBy] = useState("rpn1_desc");

  const stats = useMemo(function () {
    const init = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
    const resid = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
    const statusCount = { "Open": 0, "In Progress": 0, "Closed": 0, "Deferred": 0, "N/A": 0 };
    let actions = 0, improved = 0, withResid = 0;
    scenarios.forEach(function (s) {
      const r1 = rpnOf(s.L1, s.C1), l1 = levelOf(r1);
      const r2 = rpnOf(s.L2, s.C2), l2 = levelOf(r2);
      if (l1) init[l1] += 1;
      if (l2) { resid[l2] += 1; withResid += 1; }
      if (l1 && l2 && LEVEL_RANK[l2] < LEVEL_RANK[l1]) improved += 1;
      if ((s.recommendation || "").trim()) { actions += 1; statusCount[s.status] = (statusCount[s.status] || 0) + 1; }
    });
    const completion = actions ? Math.round((statusCount["Closed"] / actions) * 100) : 0;
    return { init: init, resid: resid, statusCount: statusCount, actions: actions, improved: improved, withResid: withResid, completion: completion };
  }, [scenarios]);

  const sorted = useMemo(function () {
    const arr = scenarios.slice();
    arr.sort(function (a, b) {
      const a1 = rpnOf(a.L1, a.C1) || 0, b1 = rpnOf(b.L1, b.C1) || 0;
      const a2 = rpnOf(a.L2, a.C2) || 0, b2 = rpnOf(b.L2, b.C2) || 0;
      if (sortBy === "rpn1_desc") return b1 - a1;
      if (sortBy === "rpn1_asc") return a1 - b1;
      if (sortBy === "rpn2_desc") return b2 - a2;
      if (sortBy === "node") return (a.nodeCode || "").localeCompare(b.nodeCode || "");
      if (sortBy === "status") return (a.status || "").localeCompare(b.status || "");
      if (sortBy === "priority") return (LEVEL_RANK[priorityOf(b1)] || 0) - (LEVEL_RANK[priorityOf(a1)] || 0);
      return 0;
    });
    return arr;
  }, [scenarios, sortBy]);

  const priorityItems = useMemo(function () {
    return scenarios.filter(function (s) { const lv = levelOf(rpnOf(s.L1, s.C1)); return lv === "Critical" || lv === "High"; })
      .sort(function (a, b) { return (rpnOf(b.L1, b.C1) || 0) - (rpnOf(a.L1, a.C1) || 0); });
  }, [scenarios]);

  const highestLevel = ["Critical", "High", "Medium", "Low", "Acceptable"].find(function (lv) { return stats.init[lv] > 0; }) || "—";

  function printReport() { window.print(); }

  const sortOptions = [
    ["rpn1_desc", "Risiko Awal — Tertinggi dahulu"],
    ["rpn1_asc", "Risiko Awal — Terendah dahulu"],
    ["rpn2_desc", "Risiko Sisa — Tertinggi dahulu"],
    ["priority", "Prioritas Tindakan"],
    ["node", "Node (A → Z)"],
    ["status", "Status Tindakan"],
  ];

  return (
    <div className="space-y-5">
      <style>{"@media print{ .no-print{display:none !important;} .report-area{box-shadow:none !important; border:none !important;} body{background:#fff;} @page{margin:14mm;} }"}</style>

      {/* Print/sort controls */}
      <div className="no-print flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 12.5, color: C.sub, fontWeight: 600 }}>Urutkan temuan:</span>
          <Select value={sortBy} onChange={function (e) { setSortBy(e.target.value); }} style={{ width: 280 }}>
            {sortOptions.map(function (o) { return <option key={o[0]} value={o[0]}>{o[1]}</option>; })}
          </Select>
        </div>
        <Btn variant="solidRed" onClick={printReport}><Download size={15} /> Cetak / Simpan PDF</Btn>
      </div>

      <div className="report-area rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid " + C.border }}>
        {/* Branded header band */}
        <div className="px-7 py-6 text-white" style={{ background: "linear-gradient(120deg, #0D1F3C 0%, #1F3864 70%)" }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-xl" style={{ width: 42, height: 42, background: C.red }}>
                <Shield size={22} />
              </div>
              <div>
                <div className="font-bold tracking-tight" style={{ fontSize: 14 }}>NUSA SAFETY</div>
                <div style={{ fontSize: 10.5, color: "#A9BBDB" }}>PT. Nusa Rendra Jayatama · QHSE & Fire Protection</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="font-bold" style={{ fontSize: 13 }}>LAPORAN STUDI HAZID</div>
              <div style={{ fontSize: 10.5, color: "#A9BBDB" }}>Hazard Identification Report</div>
            </div>
          </div>
          <h1 className="font-bold mt-5" style={{ fontSize: 22, letterSpacing: -0.3 }}>{info.title || "Tanpa Judul"}</h1>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2" style={{ fontSize: 11.5, color: "#C7D3EA" }}>
            <span><b style={{ color: "#fff" }}>No. Dok:</b> {info.number || "—"}</span>
            <span><b style={{ color: "#fff" }}>Klien:</b> {info.client || "—"}</span>
            <span><b style={{ color: "#fff" }}>Lokasi:</b> {info.location || "—"}</span>
            <span><b style={{ color: "#fff" }}>Tanggal:</b> {info.studyDate || "—"}</span>
            <span><b style={{ color: "#fff" }}>Rev:</b> {info.rev || "0"}</span>
          </div>
        </div>

        <div className="px-7 py-6 space-y-7">
          {/* 1. Executive summary */}
          <ReportBlock no="1" title="Ringkasan Eksekutif">
            <p style={{ fontSize: 13, color: C.ink, lineHeight: 1.7 }}>
              Studi HAZID pada <b>{info.facility || info.title || "fasilitas"}</b> mengidentifikasi <b>{scenarios.length} skenario bahaya</b> yang
              tersebar pada <b>{nodes.length} node</b> kajian. Profil risiko awal menunjukkan{" "}
              <b style={{ color: RISK.Critical.bg }}>{stats.init.Critical} Critical</b>,{" "}
              <b style={{ color: RISK.High.bg }}>{stats.init.High} High</b>,{" "}
              <b style={{ color: RISK.Medium.bg }}>{stats.init.Medium} Medium</b>,{" "}
              serta {stats.init.Low + stats.init.Acceptable} pada tingkat Low/Acceptable. Tingkat risiko tertinggi yang teridentifikasi adalah <b>{highestLevel}</b>.
              {" "}Sebanyak <b>{stats.actions} rekomendasi tindakan</b> dirumuskan; setelah penerapan mitigasi, <b>{stats.improved} skenario</b> diproyeksikan
              turun tingkat risikonya. Penyelesaian tindakan saat ini berada di <b>{stats.completion}%</b>.
            </p>
            {(stats.init.Critical + stats.init.High) > 0 ? (
              <div className="rounded-xl px-4 py-3 mt-3 flex items-start gap-2.5" style={{ background: "#FBE9E9", border: "1px solid #F0C9C9" }}>
                <AlertTriangle size={18} style={{ color: C.red, marginTop: 1, flexShrink: 0 }} />
                <p style={{ fontSize: 12.5, color: "#7A1010", lineHeight: 1.6 }}>
                  <b>Perhatian manajemen:</b> terdapat <b>{stats.init.Critical + stats.init.High} temuan berisiko tinggi/kritis</b> yang memerlukan
                  keputusan dan alokasi sumber daya segera (lihat Bagian 4).
                </p>
              </div>
            ) : (
              <div className="rounded-xl px-4 py-3 mt-3 flex items-start gap-2.5" style={{ background: "#EAF4EC", border: "1px solid #C9E3CE" }}>
                <CheckCircle2 size={18} style={{ color: "#1A7E45", marginTop: 1, flexShrink: 0 }} />
                <p style={{ fontSize: 12.5, color: "#1A5E35", lineHeight: 1.6 }}>
                  Tidak ada temuan pada tingkat High/Critical. Risiko berada pada rentang yang dapat dikelola dengan kontrol rutin.
                </p>
              </div>
            )}
          </ReportBlock>

          {/* 2. Risk profile metrics */}
          <ReportBlock no="2" title="Profil Risiko">
            <div className="grid sm:grid-cols-4 gap-3 mb-5">
              <MiniStat label="Skenario" value={scenarios.length} tint={C.navy} />
              <MiniStat label="Tindakan" value={stats.actions} tint={C.red} />
              <MiniStat label="Turun Risiko" value={stats.improved} tint="#1A9E5A" />
              <MiniStat label="Penyelesaian" value={stats.completion + "%"} tint="#7A5800" />
            </div>
            <div className="grid md:grid-cols-2 gap-5">
              <RiskDistBars title="Risiko Awal (Inheren)" counts={stats.init} total={scenarios.length} />
              <RiskDistBars title="Risiko Sisa (Setelah Mitigasi)" counts={stats.resid} total={stats.withResid} />
            </div>
          </ReportBlock>

          {/* 3. Findings register (sortable) */}
          <ReportBlock no="3" title={"Register Temuan (" + scenarios.length + ") — diurutkan: " + (sortOptions.find(function (o) { return o[0] === sortBy; }) || ["", ""])[1]}>
            {scenarios.length === 0 ? <Empty text="Belum ada temuan untuk dilaporkan." /> : (
              <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid " + C.border }}>
                <table style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%", minWidth: 860 }}>
                  <thead>
                    <tr>
                      {["#", "Node", "Guideword", "Deskripsi Bahaya", "Awal", "Sisa", "Prioritas", "Status"].map(function (h, i) {
                        return <th key={i} style={{ background: C.navy, color: "#fff", textAlign: "left", padding: "8px 10px", fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(function (s, i) {
                      const r1 = rpnOf(s.L1, s.C1), l1 = levelOf(r1);
                      const r2 = rpnOf(s.L2, s.C2), l2 = levelOf(r2);
                      const prio = priorityOf(r1);
                      const pc = RISK[prio];
                      return (
                        <tr key={s.id} style={{ background: i % 2 ? C.faint : "#fff", verticalAlign: "top" }}>
                          <td style={cellTd()}><b style={{ color: C.navy }}>{i + 1}</b></td>
                          <td style={cellTd()}><span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: C.navy }}>{s.nodeCode}</span></td>
                          <td style={cellTd()}><span style={{ fontWeight: 600 }}>{s.guideword}</span></td>
                          <td style={cellTd(360)}>
                            <div style={{ fontWeight: 600, color: C.ink }}>{s.deviation || trim(s.hazard, 60)}</div>
                            <div style={{ color: C.sub, fontSize: 11, marginTop: 1 }}>{trim(s.hazard, 150)}</div>
                          </td>
                          <td style={cellTd()}><RiskBadge level={l1} rpn={r1} /></td>
                          <td style={cellTd()}><RiskBadge level={l2} rpn={r2} /></td>
                          <td style={cellTd()}><span className="rounded font-semibold" style={{ background: pc.bg, color: pc.fg, fontSize: 10.5, padding: "2px 8px" }}>{prio}</span></td>
                          <td style={cellTd()}><StatusChip status={s.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ReportBlock>

          {/* 4. Management priority recommendations */}
          <ReportBlock no="4" title="Rekomendasi Prioritas untuk Manajemen">
            {priorityItems.length === 0 ? (
              <div className="rounded-xl px-4 py-3 flex items-center gap-2.5" style={{ background: "#EAF4EC", border: "1px solid #C9E3CE" }}>
                <CheckCircle2 size={18} style={{ color: "#1A7E45" }} />
                <p style={{ fontSize: 12.5, color: "#1A5E35" }}>Tidak ada item High/Critical. Lanjutkan pemantauan rutin terhadap kontrol yang ada.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p style={{ fontSize: 12.5, color: C.sub }}>
                  {priorityItems.length} temuan berikut memerlukan keputusan manajemen, diurutkan dari risiko tertinggi.
                </p>
                {priorityItems.map(function (s, i) {
                  const r1 = rpnOf(s.L1, s.C1), l1 = levelOf(r1);
                  const r2 = rpnOf(s.L2, s.C2), l2 = levelOf(r2);
                  return (
                    <div key={s.id} className="rounded-xl overflow-hidden" style={{ border: "1px solid " + C.border }}>
                      <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap" style={{ background: l1 === "Critical" ? "#FBE9E9" : "#FDF1E7" }}>
                        <span className="rounded font-bold" style={{ background: C.navy, color: "#fff", fontSize: 10.5, padding: "2px 7px", fontFamily: "ui-monospace, monospace" }}>{s.actionRef || ("P-" + (i + 1))}</span>
                        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, color: C.navy, fontSize: 12 }}>{s.nodeCode}</span>
                        <span style={{ fontWeight: 700, color: C.ink, fontSize: 12.5 }}>{s.deviation || s.guideword}</span>
                        <span className="ml-auto inline-flex items-center gap-1.5" style={{ fontSize: 11 }}>
                          <RiskBadge level={l1} rpn={r1} />
                          <span style={{ color: C.sub }}>→</span>
                          <RiskBadge level={l2} rpn={r2} />
                        </span>
                      </div>
                      <div className="px-4 py-3" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>
                        <div style={{ marginBottom: 6 }}><b style={{ color: C.sub, fontSize: 11 }}>BAHAYA · </b>{s.hazard || "—"}</div>
                        <div style={{ marginBottom: 6 }}><b style={{ color: C.sub, fontSize: 11 }}>REKOMENDASI · </b>{s.recommendation || "—"}</div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 11.5, color: C.sub, marginTop: 4 }}>
                          <span><b>PJ:</b> {s.party || "—"}</span>
                          <span><b>Target:</b> {s.targetDate || "—"}</span>
                          <span><b>Status:</b> {s.status}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ReportBlock>

          {/* 5. Methodology footer */}
          <ReportBlock no="5" title="Metodologi & Acuan">
            <p style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.7 }}>
              Penilaian menggunakan metode HAZID terstruktur berbasis <b>CCPS — Guidelines for Hazard Evaluation Procedures (3rd Edition)</b>.
              Tingkat risiko ditetapkan dari matriks 5×5 dengan <b>RPN = Kemungkinan (L) × Konsekuensi (C)</b>: Acceptable (1–2), Low (3–6),
              Medium (7–12), High (13–20), Critical (21–25). Laporan ini disusun oleh PT. Nusa Rendra Jayatama (Nusa Safety) sebagai dasar
              pengambilan keputusan manajemen risiko dan tidak menggantikan kewajiban kepatuhan regulasi yang berlaku.
            </p>
          </ReportBlock>

          <div className="pt-3 flex items-center justify-between" style={{ borderTop: "1px solid " + C.border, fontSize: 11, color: C.sub }}>
            <span>Disusun oleh: {info.consultant || "PT. Nusa Rendra Jayatama (Nusa Safety)"}</span>
            <span>Ketua Studi: {info.leader || "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportBlock(props) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex items-center justify-center rounded-lg font-bold text-white" style={{ width: 26, height: 26, background: C.navy, fontSize: 12 }}>{props.no}</div>
        <h2 className="font-bold" style={{ fontSize: 15, color: C.ink, letterSpacing: -0.2 }}>{props.title}</h2>
      </div>
      <div style={{ paddingLeft: 36 }}>{props.children}</div>
    </div>
  );
}
function MiniStat(props) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: C.faint, border: "1px solid " + C.border }}>
      <div className="font-bold" style={{ fontSize: 22, color: props.tint, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{props.label}</div>
    </div>
  );
}
function RiskDistBars(props) {
  const counts = props.counts, total = props.total;
  return (
    <div className="rounded-xl p-4" style={{ background: C.faint, border: "1px solid " + C.border }}>
      <div className="font-semibold mb-3" style={{ fontSize: 12.5, color: C.ink }}>{props.title}</div>
      <div className="space-y-1.5">
        {["Critical", "High", "Medium", "Low", "Acceptable"].map(function (lv) {
          const n = counts[lv] || 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <div key={lv} className="flex items-center gap-2">
              <div style={{ width: 78 }}><RiskBadge level={lv} /></div>
              <div className="flex-1 rounded-full overflow-hidden" style={{ height: 9, background: "#fff" }}>
                <div style={{ width: pct + "%", height: "100%", background: RISK[lv].bg }} />
              </div>
              <div style={{ width: 30, textAlign: "right", fontSize: 12, color: C.ink, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{n}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================================
   EDITOR (wraps tabs)
============================================================================ */
function Editor(props) {
  const project = props.project;
  const [tab, setTab] = useState("info");
  const { showToast, ToastNode } = useToast();

  const tabs = [
    { id: "info", label: "Informasi", icon: <Info size={15} /> },
    { id: "criteria", label: "Kriteria Risiko", icon: <Grid3x3 size={15} /> },
    { id: "nodes", label: "Node HAZID", icon: <LayoutDashboard size={15} /> },
    { id: "worksheet", label: "Lembar Kerja", icon: <FileText size={15} /> },
    { id: "actions", label: "Daftar Tindakan", icon: <ClipboardList size={15} /> },
    { id: "summary", label: "Ringkasan", icon: <BarChart3 size={15} /> },
    { id: "report", label: "Laporan Akhir", icon: <FileText size={15} /> },
  ];

  function doExport() {
    try {
      exportXlsx(project);
      showToast("Excel berhasil diunduh");
    } catch (e) {
      showToast("Gagal mengekspor: " + e.message, "err");
    }
  }

  return (
    <>
      {ToastNode}
      <div className="no-print px-7 py-4 flex items-center justify-between flex-wrap gap-3"
           style={{ background: "#fff", borderBottom: "1px solid " + C.border }}>
        <div className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <button onClick={props.onBack} className="p-2 rounded-lg" style={{ border: "1px solid " + C.border, color: C.navy }}>
            <ChevronLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1 className="font-bold truncate" style={{ fontSize: 17, color: C.ink, letterSpacing: -0.3 }}>
              {project.info.title || "Tanpa Judul"}
            </h1>
            <p className="truncate" style={{ fontSize: 12, color: C.sub }}>
              {project.info.number || "No. —"}{project.info.client ? " · " + project.info.client : ""} · Rev {project.info.rev || "0"}
            </p>
          </div>
        </div>
        <Btn variant="solidRed" onClick={doExport}><Download size={15} /> Ekspor Excel</Btn>
      </div>

      {/* Tab strip */}
      <div className="no-print px-7 flex items-center gap-1 overflow-x-auto" style={{ background: "#fff", borderBottom: "1px solid " + C.border }}>
        {tabs.map(function (t) {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={function () { setTab(t.id); }}
              className="flex items-center gap-2 px-3.5 py-3 whitespace-nowrap transition"
              style={{
                fontSize: 13, fontWeight: active ? 700 : 500,
                color: active ? C.navy : C.sub,
                borderBottom: active ? "2.5px solid " + C.red : "2.5px solid transparent",
              }}>
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6" style={{ background: C.bg }}>
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          {tab === "info" ? <InfoTab project={project} update={props.update} /> : null}
          {tab === "criteria" ? <CriteriaTab /> : null}
          {tab === "nodes" ? <NodesTab project={project} update={props.update} /> : null}
          {tab === "worksheet" ? <WorksheetTab project={project} update={props.update} onNeedNode={function () { setTab("nodes"); showToast("Definisikan Node dulu", "err"); }} /> : null}
          {tab === "actions" ? <ActionsTab project={project} update={props.update} /> : null}
          {tab === "summary" ? <SummaryTab project={project} /> : null}
          {tab === "report" ? <ReportTab project={project} /> : null}
        </div>
      </div>
    </>
  );
}

/* ============================================================================
   EXCEL EXPORT (SheetJS) — mirrors the 6-sheet structure
============================================================================ */
function exportXlsx(project) {
  const wb = XLSX.utils.book_new();
  const info = project.info || {};
  const nodes = project.nodes || [];
  const scenarios = project.scenarios || [];

  // Cover
  const cover = [
    ["HAZARD IDENTIFICATION WORKSHEET"],
    ["Based on CCPS – Guidelines for Hazard Evaluation Procedures, 3rd Edition"],
    [],
    ["Judul Proyek", info.title || ""],
    ["Nomor Dokumen", info.number || ""],
    ["Fasilitas", info.facility || ""],
    ["Lokasi", info.location || ""],
    ["Klien", info.client || ""],
    ["Konsultan", info.consultant || "PT. Nusa Rendra Jayatama (Nusa Safety)"],
    ["Tanggal Studi", info.studyDate || ""],
    ["Ketua Studi", info.leader || ""],
    ["Revisi", info.rev || "0"],
    [],
    ["TIM STUDI"],
    ["Nama", "Perusahaan", "Jabatan", "Disiplin"],
  ];
  (info.team || []).forEach(function (m) { cover.push([m.name, m.company, m.role, m.discipline]); });
  const wsCover = XLSX.utils.aoa_to_sheet(cover);
  wsCover["!cols"] = [{ wch: 24 }, { wch: 30 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsCover, "Cover");

  // Risk Matrix
  const rm = [["KRITERIA KEMUNGKINAN (LIKELIHOOD)"], ["Level", "Rating", "Deskripsi", "Frekuensi/tahun"]];
  LIKELIHOOD.forEach(function (x) { rm.push([x.v, x.name, x.id, x.freq]); });
  rm.push([], ["KRITERIA KONSEKUENSI (CONSEQUENCE)"], ["Level", "Rating", "Keselamatan", "Lingkungan", "Aset"]);
  CONSEQUENCE.forEach(function (x) { rm.push([x.v, x.name, x.safety, x.env, x.asset]); });
  rm.push([], ["MATRIKS RISIKO 5x5 (RPN = L x C)"], ["L \\ C", "1", "2", "3", "4", "5"]);
  LIKELIHOOD.slice().reverse().forEach(function (l) {
    rm.push([l.v].concat(CONSEQUENCE.map(function (c) { return l.v * c.v; })));
  });
  rm.push([], ["TINGKAT TOLERANSI RISIKO"], ["Tingkat", "RPN", "Tolerabilitas", "Tindakan Wajib"]);
  TOLERANCE.forEach(function (t) { rm.push([t.level, t.range, t.tol, t.action]); });
  const wsRM = XLSX.utils.aoa_to_sheet(rm);
  wsRM["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 28 }, { wch: 16 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsRM, "Risk Matrix");

  // Nodes
  const nd = [["NODE STUDI HAZID"], ["No", "Kode", "Deskripsi (ID)", "Description (EN)", "Drawing/P&ID", "Batasan", "Included", "Excluded"]];
  nodes.forEach(function (n, i) { nd.push([i + 1, n.code, n.descId, n.descEn, n.drawing, n.boundaries, n.included, n.excluded]); });
  const wsND = XLSX.utils.aoa_to_sheet(nd);
  wsND["!cols"] = [{ wch: 5 }, { wch: 10 }, { wch: 28 }, { wch: 28 }, { wch: 18 }, { wch: 30 }, { wch: 30 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsND, "HAZID Nodes");

  // HAZID Worksheet
  const hdr = ["No", "Node", "Guideword", "Penyimpangan", "Deskripsi Bahaya", "Penyebab", "Konsekuensi",
    "Safeguard Eksisting", "L (Awal)", "C (Awal)", "RPN (Awal)", "Risk (Awal)",
    "Rekomendasi", "PJ", "Target", "Status", "L (Sisa)", "C (Sisa)", "RPN (Sisa)", "Risk (Sisa)", "Ref"];
  const ws = [["HAZARD IDENTIFICATION (HAZID) WORKSHEET"], hdr];
  scenarios.forEach(function (s, i) {
    const r1 = rpnOf(s.L1, s.C1), r2 = rpnOf(s.L2, s.C2);
    ws.push([
      i + 1, s.nodeCode, s.guideword, s.deviation, s.hazard, s.causes, s.consequences,
      s.safeguards, s.L1 || "", s.C1 || "", r1 || "", levelOf(r1) || "",
      s.recommendation, s.party, s.targetDate, s.status, s.L2 || "", s.C2 || "", r2 || "", levelOf(r2) || "", s.actionRef,
    ]);
  });
  const wsWS = XLSX.utils.aoa_to_sheet(ws);
  wsWS["!cols"] = [{ wch: 5 }, { wch: 8 }, { wch: 16 }, { wch: 18 }, { wch: 34 }, { wch: 30 }, { wch: 30 },
    { wch: 26 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 13 }, { wch: 34 }, { wch: 16 }, { wch: 12 },
    { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 13 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsWS, "HAZID Worksheet");

  // Action Register
  const ar = [["DAFTAR TINDAKAN / ACTION REGISTER"], ["Ref", "No HAZID", "Node", "Rekomendasi", "PJ", "Target", "Prioritas", "Status"]];
  scenarios.filter(function (s) { return (s.recommendation || "").trim(); }).forEach(function (s, i) {
    ar.push([s.actionRef, i + 1, s.nodeCode, s.recommendation, s.party, s.targetDate, priorityOf(rpnOf(s.L1, s.C1)), s.status]);
  });
  const wsAR = XLSX.utils.aoa_to_sheet(ar);
  wsAR["!cols"] = [{ wch: 10 }, { wch: 9 }, { wch: 8 }, { wch: 40 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsAR, "Action Register");

  // Summary
  const init = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
  const resid = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
  const stc = { "Open": 0, "In Progress": 0, "Closed": 0, "Deferred": 0, "N/A": 0 };
  let acts = 0;
  scenarios.forEach(function (s) {
    const l1 = levelOf(rpnOf(s.L1, s.C1)); if (l1) init[l1] += 1;
    const l2 = levelOf(rpnOf(s.L2, s.C2)); if (l2) resid[l2] += 1;
    if ((s.recommendation || "").trim()) { acts += 1; stc[s.status] = (stc[s.status] || 0) + 1; }
  });
  const sm = [["RINGKASAN STUDI HAZID"], [],
    ["Hitungan per Tingkat Risiko"], ["Tingkat", "Awal", "Sisa"]];
  ["Acceptable", "Low", "Medium", "High", "Critical"].forEach(function (lv) { sm.push([lv, init[lv], resid[lv]]); });
  sm.push([], ["Status Tindakan"], ["Status", "Jumlah"]);
  STATUS_OPTS.forEach(function (st) { sm.push([st, stc[st] || 0]); });
  sm.push([], ["Statistik"], ["Total Skenario", scenarios.length], ["Total Tindakan", acts],
    ["Tindakan Selesai", stc["Closed"]], ["% Penyelesaian", acts ? Math.round((stc["Closed"] / acts) * 100) + "%" : "0%"]);
  const wsSM = XLSX.utils.aoa_to_sheet(sm);
  wsSM["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSM, "Summary");

  // Trigger download via Blob (reliable inside artifact iframe)
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = (info.title || "HAZID").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  a.href = url;
  a.download = "HAZID_" + safe + ".xlsx";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}

/* ============================================================================
   DASHBOARDS
============================================================================ */
function blankProject(owner) {
  return {
    id: uid("prj"), owner: owner, createdAt: nowISO(), updatedAt: nowISO(),
    info: { title: "", number: "", facility: "", location: "", client: "",
      consultant: "PT. Nusa Rendra Jayatama (Nusa Safety)", studyDate: "", leader: "", rev: "0", team: [] },
    nodes: [], scenarios: [],
  };
}

function UserDashboard(props) {
  const { confirm, ConfirmDialog } = useConfirm();
  const myProjects = props.projects.filter(function (p) { return p.owner === props.user.username; });
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");

  function create() {
    const p = blankProject(props.user.username);
    p.info.title = title.trim() || "HAZID Baru";
    props.onCreate(p);
    setShowNew(false); setTitle("");
    props.onOpen(p.id);
  }
  async function del(id) {
    const ok = await confirm({ title: "Hapus Proyek", message: "Seluruh data penilaian HAZID pada proyek ini akan dihapus permanen." });
    if (ok) props.onDelete(id);
  }

  return (
    <>
      {ConfirmDialog}
      <PageHead title="Proyek HAZID Saya" sub={myProjects.length + " proyek penilaian"}
                actions={<>
                  <Btn variant="ghost" onClick={props.onLoadExample}><Wind size={15} /> Muat Contoh PLTB</Btn>
                  <Btn variant="solidRed" onClick={function () { setShowNew(true); }}><Plus size={15} /> Proyek Baru</Btn>
                </>} />
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {myProjects.length === 0 ? (
          <div className="text-center py-20 rounded-2xl" style={{ background: "#fff", border: "1px dashed " + C.border }}>
            <div className="flex items-center justify-center rounded-2xl mx-auto mb-4" style={{ width: 56, height: 56, background: C.faint }}>
              <FolderOpen size={26} style={{ color: C.navy }} />
            </div>
            <h3 className="font-bold mb-1" style={{ fontSize: 16, color: C.ink }}>Belum ada proyek</h3>
            <p className="mb-5" style={{ fontSize: 13, color: C.sub }}>Buat proyek baru atau muat contoh PLTB untuk mulai menilai.</p>
            <div className="flex items-center justify-center gap-2">
              <Btn variant="ghost" onClick={props.onLoadExample}><Wind size={15} /> Muat Contoh PLTB</Btn>
              <Btn variant="solidRed" onClick={function () { setShowNew(true); }}><Plus size={15} /> Proyek Baru</Btn>
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {myProjects.map(function (p) {
              return <ProjectCard key={p.id} project={p} onOpen={props.onOpen} onDelete={del} />;
            })}
          </div>
        )}
      </div>

      <Modal open={showNew} onClose={function () { setShowNew(false); }} icon={<Plus size={18} />} title="Proyek HAZID Baru"
             footer={<>
               <Btn variant="ghost" onClick={function () { setShowNew(false); }}>Batal</Btn>
               <Btn onClick={create}><Save size={15} /> Buat & Buka</Btn>
             </>}>
        <Field label="Judul Proyek" required>
          <TextInput autoFocus value={title} onChange={function (e) { setTitle(e.target.value); }}
                     onKeyDown={function (e) { if (e.key === "Enter") create(); }}
                     placeholder="cth. HAZID Studi PLTB 50 MW Jeneponto" />
        </Field>
        <p className="mt-3" style={{ fontSize: 12, color: C.sub }}>
          Detail lain (fasilitas, klien, tim) dapat diisi setelah proyek dibuka.
        </p>
      </Modal>
    </>
  );
}

function AdminDashboard(props) {
  const { confirm, ConfirmDialog } = useConfirm();
  const [section, setSection] = useState("overview"); // overview | users | projects
  const [showUser, setShowUser] = useState(null);
  const [q, setQ] = useState("");

  const totalUsers = props.users.length;
  const totalProjects = props.projects.length;
  const totalScenarios = props.projects.reduce(function (a, p) { return a + (p.scenarios || []).length; }, 0);

  function ownerName(username) {
    const u = props.users.find(function (x) { return x.username === username; });
    return u ? (u.name || u.username) : username;
  }

  function saveUser(u) {
    const exists = props.users.find(function (x) { return x.username === u.username; });
    if (exists && !u._editing) { props.showToast && props.showToast("Username sudah dipakai", "err"); return; }
    props.onSaveUser(u);
    setShowUser(null);
  }
  async function delUser(username) {
    if (username === "admin") { return; }
    const ok = await confirm({ title: "Hapus Pengguna", message: "Pengguna “" + username + "” akan dihapus. Proyek miliknya tetap tersimpan." });
    if (ok) props.onDeleteUser(username);
  }
  async function delProject(id) {
    const ok = await confirm({ title: "Hapus Proyek", message: "Proyek ini akan dihapus permanen." });
    if (ok) props.onDeleteProject(id);
  }

  const filteredProjects = props.projects.filter(function (p) {
    if (!q.trim()) return true;
    const hay = (p.info.title + " " + p.info.facility + " " + p.info.client + " " + ownerName(p.owner)).toLowerCase();
    return hay.indexOf(q.toLowerCase()) >= 0;
  });

  return (
    <>
      {ConfirmDialog}
      <PageHead title="Panel Administrator" sub="Kelola pengguna dan seluruh proyek HAZID" />
      {/* sub-nav */}
      <div className="px-7 flex items-center gap-1" style={{ background: "#fff", borderBottom: "1px solid " + C.border }}>
        {[["overview", "Ikhtisar", <LayoutDashboard size={15} />], ["users", "Pengguna", <Users size={15} />], ["projects", "Semua Proyek", <FolderOpen size={15} />]].map(function (t) {
          const active = section === t[0];
          return (
            <button key={t[0]} onClick={function () { setSection(t[0]); }}
              className="flex items-center gap-2 px-3.5 py-3" style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? C.navy : C.sub, borderBottom: active ? "2.5px solid " + C.red : "2.5px solid transparent" }}>
              {t[2]}{t[1]}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {section === "overview" ? (
          <div className="space-y-6">
            <div className="grid sm:grid-cols-3 gap-4">
              <StatCard label="Total Pengguna" value={totalUsers} icon={<Users size={18} />} tint={C.navy} />
              <StatCard label="Total Proyek" value={totalProjects} icon={<FolderOpen size={18} />} tint={C.red} />
              <StatCard label="Total Skenario" value={totalScenarios} icon={<FileText size={18} />} tint="#1A9E5A" />
            </div>
            <Section title="Proyek Terbaru" icon={<FolderOpen size={16} />}>
              {props.projects.length === 0 ? <Empty text="Belum ada proyek di sistem." /> : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {props.projects.slice().sort(function (a, b) { return (b.updatedAt || "").localeCompare(a.updatedAt || ""); }).slice(0, 6).map(function (p) {
                    return <ProjectCard key={p.id} project={p} ownerName={ownerName(p.owner)} onOpen={props.onOpen} onDelete={delProject} />;
                  })}
                </div>
              )}
            </Section>
          </div>
        ) : null}

        {section === "users" ? (
          <Section title="Manajemen Pengguna" icon={<Users size={16} />}
                   action={<Btn sm onClick={function () { setShowUser({ username: "", name: "", password: "", role: "user", _new: true }); }}><Plus size={14} /> Tambah Pengguna</Btn>}>
            <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid " + C.border }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    {["Nama", "Username", "Peran", "Proyek", "Dibuat", ""].map(function (h, i) {
                      return <th key={i} style={{ background: C.navy, color: "#fff", textAlign: "left", padding: "9px 12px", fontSize: 11.5 }}>{h}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {props.users.map(function (u, i) {
                    const cnt = props.projects.filter(function (p) { return p.owner === u.username; }).length;
                    return (
                      <tr key={u.username} style={{ background: i % 2 ? C.faint : "#fff" }}>
                        <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, fontWeight: 600, color: C.ink }}>{u.name || "—"}</td>
                        <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, fontFamily: "ui-monospace, monospace", color: C.navy }}>{u.username}</td>
                        <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border }}>
                          <span className="rounded font-semibold" style={{ fontSize: 10.5, padding: "2px 8px", background: u.role === "admin" ? "#FBE0E0" : "#DEE9F8", color: u.role === "admin" ? "#9A1B1B" : "#1F4B8E" }}>
                            {u.role === "admin" ? "Administrator" : "Pengguna"}
                          </span>
                        </td>
                        <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{cnt}</td>
                        <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, color: C.sub, fontSize: 11.5 }}>{fmtDate(u.createdAt)}</td>
                        <td style={{ padding: "9px 12px", borderTop: "1px solid " + C.border, whiteSpace: "nowrap" }}>
                          <button onClick={function () { setShowUser(Object.assign({}, u, { _editing: true })); }} className="p-1.5 rounded-md" style={{ color: C.navy, border: "1px solid " + C.border, marginRight: 4 }}><Pencil size={14} /></button>
                          <button onClick={function () { delUser(u.username); }} disabled={u.username === "admin"}
                                  className="p-1.5 rounded-md disabled:opacity-30" style={{ color: C.red, border: "1px solid #E7BcBc" }}><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        {section === "projects" ? (
          <Section title="Semua Proyek" icon={<FolderOpen size={16} />}
                   action={
                     <div className="relative">
                       <Search size={14} style={{ position: "absolute", left: 9, top: 8, color: C.sub }} />
                       <TextInput value={q} onChange={function (e) { setQ(e.target.value); }} placeholder="Cari proyek / klien / pemilik" style={{ paddingLeft: 30, width: 240 }} />
                     </div>
                   }>
            {filteredProjects.length === 0 ? <Empty text="Tidak ada proyek yang cocok." /> : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {filteredProjects.map(function (p) {
                  return <ProjectCard key={p.id} project={p} ownerName={ownerName(p.owner)} onOpen={props.onOpen} onDelete={delProject} />;
                })}
              </div>
            )}
          </Section>
        ) : null}
      </div>

      <UserModal data={showUser} onClose={function () { setShowUser(null); }} onSave={saveUser} />
    </>
  );
}

function UserModal(props) {
  const [u, setU] = useState(null);
  useEffect(function () { setU(props.data ? Object.assign({}, props.data) : null); }, [props.data]);
  if (!u) return null;
  function f(k, v) { setU(function (s) { return Object.assign({}, s, { [k]: v }); }); }
  const valid = u.username.trim() && u.password.trim();
  return (
    <Modal open={true} onClose={props.onClose} icon={<User size={18} />} title={u._editing ? "Edit Pengguna" : "Tambah Pengguna"}
           footer={<>
             <Btn variant="ghost" onClick={props.onClose}>Batal</Btn>
             <Btn onClick={function () { if (valid) props.onSave(u); }} disabled={!valid}><Save size={15} /> Simpan</Btn>
           </>}>
      <div className="space-y-4">
        <Field label="Nama Lengkap"><TextInput value={u.name} onChange={function (e) { f("name", e.target.value); }} /></Field>
        <Field label="Username" required>
          <TextInput value={u.username} disabled={u._editing} onChange={function (e) { f("username", e.target.value); }}
                     style={{ opacity: u._editing ? 0.6 : 1, fontFamily: "ui-monospace, monospace" }} />
        </Field>
        <Field label="Kata Sandi" required><TextInput value={u.password} onChange={function (e) { f("password", e.target.value); }} /></Field>
        <Field label="Peran" required>
          <Select value={u.role} onChange={function (e) { f("role", e.target.value); }} disabled={u.username === "admin"}>
            <option value="user">Pengguna</option>
            <option value="admin">Administrator</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/* ============================================================================
   ROOT APP
============================================================================ */
export default function App() {
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [user, setUser] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [adminView, setAdminView] = useState("dashboard"); // for admin shell nav
  const { showToast, ToastNode } = useToast();

  // boot
  useEffect(function () {
    (async function () {
      let us = await loadJSON(K_USERS, null);
      if (!us || !Array.isArray(us) || us.length === 0) {
        us = [
          { username: "admin", password: "admin123", name: "Administrator", role: "admin", createdAt: nowISO() },
          { username: "pengguna", password: "user123", name: "Pengguna Demo", role: "user", createdAt: nowISO() },
        ];
        await saveJSON(K_USERS, us);
      }
      const ps = await loadJSON(K_PROJECTS, []);
      const sess = await store.get(K_SESSION);
      setUsers(us);
      setProjects(Array.isArray(ps) ? ps : []);
      if (sess) {
        const found = us.find(function (x) { return x.username === sess; });
        if (found) setUser(found);
      }
      setReady(true);
    })();
  }, []);

  const persistUsers = useCallback(function (next) { setUsers(next); saveJSON(K_USERS, next); }, []);
  const persistProjects = useCallback(function (next) { setProjects(next); saveJSON(K_PROJECTS, next); }, []);

  function login(u) { setUser(u); store.set(K_SESSION, u.username); }
  function logout() { setUser(null); setActiveId(null); setAdminView("dashboard"); store.set(K_SESSION, ""); }

  // project ops
  function createProject(p) { persistProjects(projects.concat([p])); }
  function deleteProject(id) {
    persistProjects(projects.filter(function (p) { return p.id !== id; }));
    if (activeId === id) setActiveId(null);
    showToast("Proyek dihapus");
  }
  const updateProject = useCallback(function (updater) {
    setProjects(function (prev) {
      const next = prev.map(function (p) {
        if (p.id !== activeId) return p;
        const copy = JSON.parse(JSON.stringify(p));
        updater(copy);
        copy.updatedAt = nowISO();
        return copy;
      });
      saveJSON(K_PROJECTS, next);
      return next;
    });
  }, [activeId]);

  // user ops (admin)
  function saveUser(u) {
    const clean = { username: u.username.trim(), password: u.password, name: u.name, role: u.role, createdAt: u.createdAt || nowISO() };
    const exists = users.find(function (x) { return x.username === clean.username; });
    let next;
    if (exists) next = users.map(function (x) { return x.username === clean.username ? clean : x; });
    else next = users.concat([clean]);
    persistUsers(next);
    showToast(exists ? "Pengguna diperbarui" : "Pengguna ditambahkan");
  }
  function deleteUser(username) {
    persistUsers(users.filter(function (x) { return x.username !== username; }));
    showToast("Pengguna dihapus");
  }

  // example loader (PLTB)
  function loadExample() {
    const p = buildPltbExample(user.username);
    persistProjects(projects.concat([p]));
    showToast("Contoh PLTB dimuat");
    setActiveId(p.id);
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.deepNavy }}>
        <div className="flex items-center gap-3 text-white">
          <Shield size={22} /> <span style={{ fontSize: 14 }}>Memuat HAZID Tool…</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen users={users} onLogin={login} />;

  const activeProject = projects.find(function (p) { return p.id === activeId; });

  // Editor takes over full screen (with its own header)
  if (activeProject) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: C.bg }}>
        {ToastNode}
        <Editor project={activeProject} update={updateProject} onBack={function () { setActiveId(null); }} />
      </div>
    );
  }

  // Shell for dashboards
  const nav = user.role === "admin"
    ? [{ id: "dashboard", label: "Panel Admin", icon: <LayoutDashboard size={16} /> }]
    : [{ id: "dashboard", label: "Proyek Saya", icon: <FolderOpen size={16} /> }];

  return (
    <>
      {ToastNode}
      <Shell user={user} nav={nav} active="dashboard" onNav={function () {}} onLogout={logout}>
        {user.role === "admin" ? (
          <AdminDashboard
            users={users} projects={projects}
            onOpen={function (id) { setActiveId(id); }}
            onSaveUser={saveUser} onDeleteUser={deleteUser}
            onDeleteProject={deleteProject}
            showToast={showToast}
          />
        ) : (
          <UserDashboard
            user={user} projects={projects}
            onCreate={createProject} onOpen={function (id) { setActiveId(id); }}
            onDelete={deleteProject} onLoadExample={loadExample}
          />
        )}
      </Shell>
    </>
  );
}

/* ============================================================================
   PLTB EXAMPLE DATA (subset of the 25-scenario workbook)
============================================================================ */
function buildPltbExample(owner) {
  const p = blankProject(owner);
  p.info = {
    title: "HAZID Studi PLTB 50 MW – Jeneponto",
    number: "NSJ-PLTB-2026-001",
    facility: "Wind Farm 50 MW – Turbine, Substation & BoP",
    location: "Jeneponto, Sulawesi Selatan",
    client: "PT. Energi Bayu Nusantara (EBN)",
    consultant: "PT. Nusa Rendra Jayatama (Nusa Safety)",
    studyDate: "10 Juni 2026",
    leader: "Ir. Rendra Jayatama, M.T.",
    rev: "0",
    team: [
      { name: "Ir. Rendra Jayatama, M.T.", company: "PT. Nusa Rendra Jayatama", role: "HAZID Leader", discipline: "QHSE / Fire Protection" },
      { name: "Dewi Rahayu, S.T., M.T.", company: "PT. Energi Bayu Nusantara", role: "Electrical Engineer", discipline: "Electrical / Power" },
      { name: "Budi Hartono, S.T.", company: "PT. Energi Bayu Nusantara", role: "Operations Manager", discipline: "O&M / Wind Turbine" },
      { name: "Siti Nuraini, S.K.M.", company: "PT. Nusa Rendra Jayatama", role: "QHSE Specialist", discipline: "Safety / Environment" },
    ],
  };
  p.nodes = [
    { id: uid("node"), code: "N-01", descId: "Turbin Angin – Nacelle & Rotor", descEn: "Wind Turbine Generator – Nacelle & Rotor", drawing: "PLTB-WTG-P&ID-001", boundaries: "Dari rotor hub sampai nacelle transformer", included: "Rotor, gearbox, generator, struktur nacelle, LPS", excluded: "Tower, fondasi, kabel" },
    { id: uid("node"), code: "N-02", descId: "Menara & Pondasi Turbin", descEn: "Wind Turbine Tower & Foundation", drawing: "PLTB-WTG-CIVIL-002", boundaries: "Dasar tower s/d flange interface nacelle", included: "Seksi tower baja, tangga internal, yaw system, anchor bolt", excluded: "Nacelle, rotor" },
    { id: uid("node"), code: "N-03", descId: "Sistem Pengumpul 33 kV", descEn: "MV Collection System 33 kV", drawing: "PLTB-ELEC-MV-003", boundaries: "Dari nacelle transformer s/d RMU", included: "Kabel MV bawah tanah, joint, RMU, surge arrester", excluded: "Gardu HV" },
    { id: uid("node"), code: "N-04", descId: "Gardu Induk 33/150 kV", descEn: "Main Substation 33/150 kV", drawing: "PLTB-GIS-004", boundaries: "Dari busbar LV s/d feeder 150 kV", included: "Trafo daya, GIS, relay proteksi, SCADA, earthing", excluded: "Transmisi di luar pagar" },
    { id: uid("node"), code: "N-05", descId: "Sistem SCADA & Kontrol", descEn: "SCADA & Control System", drawing: "PLTB-SCADA-005", boundaries: "Seluruh kontrol & komunikasi digital", included: "Server SCADA, HMI, fiber optic, PLC, UPS", excluded: "Infrastruktur fisik" },
    { id: uid("node"), code: "N-06", descId: "Area Akses & Pemeliharaan", descEn: "Access & Maintenance Areas", drawing: "PLTB-CIVIL-009", boundaries: "Jalan akses, control building, workshop", included: "Jalan, crane hard standing, control room, pagar", excluded: "Akses laut" },
  ];

  function sc(o) {
    return Object.assign({ id: uid("sc"), deviation: "", causes: "", consequences: "", safeguards: "", recommendation: "", party: "", targetDate: "", status: "Open", L2: "", C2: "" }, o);
  }
  p.scenarios = [
    sc({
      nodeCode: "N-01", guideword: "FIRE", deviation: "Kebakaran Nacelle / Nacelle Fire",
      hazard: "Kebakaran di dalam nacelle akibat overheat gearbox atau kegagalan generator.",
      causes: "Kegagalan sistem pelumas gearbox; generator overload; korsleting panel nacelle; akumulasi minyak lumas pada permukaan panas.",
      consequences: "Kehancuran total nacelle & generator (>USD 2M); fatality personil; penyebaran api ke WTG lain; outage 6–12 bulan.",
      safeguards: "Deteksi asap/panas nacelle; CO₂ suppression otomatis; lube oil high-temp shutdown; LPS & surge arrester.",
      L1: 3, C1: 5,
      recommendation: "Pasang VESDA di nacelle; inspeksi lube oil tiap 500 jam; rescue plan personil; automatic shutdown high-temp; flame detector backup.",
      party: "O&M Manager / QHSE", targetDate: "Q3 2026", status: "Open", L2: 2, C2: 5, actionRef: "ACT-001",
    }),
    sc({
      nodeCode: "N-01", guideword: "OVERPRESSURE", deviation: "Overspeed Rotor",
      hazard: "Overspeed saat angin ekstrem atau kegagalan pitch system.",
      causes: "Grid loss mendadak; kegagalan pitch controller; mechanical brake failure; gust >25 m/s.",
      consequences: "Blade failure/throw (radius >300 m); kegagalan struktural tower & nacelle; fatality di exclusion zone.",
      safeguards: "Independent pitch control (fail-safe feather); mechanical brake; storm shutdown; exclusion zone.",
      L1: 2, C1: 5,
      recommendation: "Verifikasi setpoint overspeed trip (IEC 61400-1); uji brake & pitch 6-bulanan; perbaiki exclusion zone; hardware OVS protection SIL 2.",
      party: "OEM / Maint. Engr.", targetDate: "Q2 2026", status: "Open", L2: 1, C2: 5, actionRef: "ACT-002",
    }),
    sc({
      nodeCode: "N-02", guideword: "WIND / LIGHTNING", deviation: "Sambaran Petir pada Tower/Nacelle",
      hazard: "Petir langsung menyerang WTG tower atau nacelle.",
      causes: "Konduktivitas tinggi struktur baja; lokasi terbuka perbukitan; LPS rusak/tidak terpasang.",
      consequences: "Kebakaran nacelle; kerusakan SCADA (overvoltage); blade rusak; gangguan operasi wind farm.",
      safeguards: "LPS IEC 61400-24; SPD pada panel listrik; earthing terintegrasi.",
      L1: 4, C1: 3,
      recommendation: "Verifikasi & uji kontinuitas LPS tiap tahun; SPD kelas I+II+III; stop kerja di atas tower bila petir <10 km; retrofit receptor blade.",
      party: "Electrical Engr. / O&M", targetDate: "Q2 2026", status: "In Progress", L2: 3, C2: 2, actionRef: "ACT-003",
    }),
    sc({
      nodeCode: "N-04", guideword: "FIRE", deviation: "Kebakaran Transformator Utama",
      hazard: "Kebakaran oil-filled power transformer 33/150 kV.",
      causes: "Internal fault (bushing/winding); oil leak + arc; overload jangka panjang; kegagalan pendingin.",
      consequences: "Total loss trafo (USD 2–5M); loss of export power; kontaminasi lingkungan; api meluas ke GIS.",
      safeguards: "Buchholz relay & PRD; oil containment bund; deluge system; DGA monitoring.",
      L1: 2, C1: 5,
      recommendation: "Automatic deluge di transformer bay; DGA minyak tiap 6 bulan; bund 110% volume minyak; thermal imaging bushing tahunan.",
      party: "Electrical Engr. / QHSE", targetDate: "Q3 2026", status: "Open", L2: 1, C2: 5, actionRef: "ACT-004",
    }),
    sc({
      nodeCode: "N-05", guideword: "MANAGEMENT OF CHANGE", deviation: "Serangan Siber / Cyber Attack",
      hazard: "Akses tidak sah ke sistem SCADA/kontrol wind farm.",
      causes: "Firewall lemah; credential bocor; patch tidak update; social engineering personil O&M.",
      consequences: "Trip seluruh wind farm jarak jauh; manipulasi setpoint proteksi; manipulasi data; isu kepatuhan BSSN/ESDM.",
      safeguards: "Firewall & network segmentation; VPN remote access; access control log.",
      L1: 3, C1: 4,
      recommendation: "Cyber Security Assessment (IEC 62443); segmentasi IT/OT; MFA semua akses remote; patch management bulanan; pelatihan awareness.",
      party: "IT/OT Security / SCADA Engr.", targetDate: "Q2 2026", status: "Open", L2: 2, C2: 3, actionRef: "ACT-005",
    }),
    sc({
      nodeCode: "N-06", guideword: "WRONG OPERATION", deviation: "Jatuh dari Ketinggian",
      hazard: "Personil jatuh saat mendaki tower, bekerja di nacelle, atau inspeksi blade.",
      causes: "Tidak memakai fall arrest; permukaan licin; kelelahan; tangga tower rusak; tanpa penilaian risiko.",
      consequences: "Fatality/cedera berat dari ketinggian 80–120 m; trauma tim; kewajiban hukum.",
      safeguards: "Fall arrest system; izin kerja ketinggian; tower lift; buddy system.",
      L1: 3, C1: 5,
      recommendation: "Sertifikasi Working at Heights semua teknisi; anchor point tiap level; 100% tie-off policy; inspeksi tower ladder; rescue plan & drill tahunan.",
      party: "QHSE / O&M Manager", targetDate: "Q1 2026", status: "Closed", L2: 1, C2: 5, actionRef: "ACT-006",
    }),
  ];
  return p;
}
