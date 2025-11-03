/**
 * Catálogo Saudável — Front-end (vanilla JS + Firestore v9 modular)
 * - Leitura em tempo real com onSnapshot
 * - Filtros por categoria e busca por nome
 * - Link para WhatsApp com mensagem montada e codificada
 * - Paginação opcional (fallback com getDocs, desativada por padrão)
 */

import { firebaseConfig, WHATSAPP_NUMBER } from "./firebase-config.js";
import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore, collection, query, where, orderBy,
  onSnapshot, limit, getDocs, startAfter, serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ===== Inicialização Firebase/Firestore =====
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ===== DOM =====
const menu = document.getElementById("menu");
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const busca = document.getElementById("busca");
const btnMais = document.getElementById("btn-mais");

// ===== Config =====
const COLECAO = "itens";
const PAGE_SIZE = 20;
const ENABLE_PAGINATION_FALLBACK = false; // defina true se quiser paginação por getDocs

// ===== Estado =====
let categoriaAtual = "Comidas Saudáveis";
let buscaAtual = "";
let unsubscribe = null; // para parar listener em tempo real
let lastDoc = null;     // paginação fallback

// ===== Utils =====
const precoBR = (v) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const sanitizeText = (s) => (s ?? "").toString();

function cardTemplate(item) {
  const nome = sanitizeText(item.nome);
  const categoria = sanitizeText(item.categoria);
  const preco = precoBR(item.preco ?? 0);
  const img = item.imagem_url || "images/placeholder.jpg";
  const desc = sanitizeText(item.descricao);

  const msg = encodeURIComponent(
`Olá! Quero pedir:
${nome} (Categoria: ${categoria})
Preço: ${preco}`
  );
  const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;

  return `
    <article class="card">
      <img src="${img}" alt="${nome}" loading="lazy" />
      <div class="content">
        <h3>${nome}</h3>
        <p>${desc}</p>
        <div class="price">${preco}</div>
      </div>
      <a class="cta" href="${wa}" target="_blank" rel="noopener">Pedir no WhatsApp</a>
    </article>
  `;
}

function renderLista(docs) {
  if (!docs.length) {
    grid.innerHTML = `<p>Nenhum item encontrado.</p>`;
    return;
  }
  grid.innerHTML = docs.map(cardTemplate).join("");
}

// ===== Query builder =====
function baseQuery(cat, textoBusca = "") {
  const base = collection(db, COLECAO);

  // Promoção do dia = flag específica
  if (cat === "Promoção") {
    // orderBy('ordem') requer índice composto com where(... == true)
    return query(
      base,
      where("public", "==", true),
      where("disponivel", "==", true),
      where("promocao_do_dia", "==", true),
      orderBy("ordem", "asc")
    );
  }

  // Demais categorias
  return query(
    base,
    where("public", "==", true),
    where("disponivel", "==", true),
    where("categoria", "==", cat),
    orderBy("ordem", "asc")
  );
}

// ===== Tempo real (onSnapshot) =====
function listenCategoria(cat) {
  // encerrar listener anterior
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }

  statusEl.textContent = "Carregando…";
  grid.innerHTML = "";

  const q = baseQuery(cat, buscaAtual);
  unsubscribe = onSnapshot(q, (snap) => {
    const data = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d =>
        !buscaAtual
        ? true
        : d.nome?.toLowerCase().includes(buscaAtual.toLowerCase())
      );
    renderLista(data);
    statusEl.textContent = data.length ? "" : "Sem itens nesta categoria.";
  }, (err) => {
    console.error(err);
    statusEl.textContent = "Erro ao carregar. Tente novamente.";
  });
}

// ===== Paginação (fallback com getDocs) =====
async function carregarPagina(cat, append = false) {
  // NOTA: Paginação tradicional com getDocs não é em tempo real.
  statusEl.textContent = append ? "Carregando mais…" : "Carregando…";
  const constraints = [orderBy("ordem", "asc"), limit(PAGE_SIZE)];

  let q = baseQuery(cat);
  // Reaplica orderBy/limit porque baseQuery já inclui orderBy('ordem')
  // (para garantir limit e startAfter, refazemos a query abaixo)
  q = lastDoc
    ? query(
        collection(db, COLECAO),
        where("public", "==", true),
        where("disponivel", "==", true),
        ...(cat === "Promoção" ? [where("promocao_do_dia", "==", true)] : [where("categoria", "==", cat)]),
        orderBy("ordem", "asc"),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      )
    : query(
        collection(db, COLECAO),
        where("public", "==", true),
        where("disponivel", "==", true),
        ...(cat === "Promoção" ? [where("promocao_do_dia", "==", true)] : [where("categoria", "==", cat)]),
        orderBy("ordem", "asc"),
        limit(PAGE_SIZE)
      );

  try {
    const snap = await getDocs(q);
    const data = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(d =>
        !buscaAtual
        ? true
        : d.nome?.toLowerCase().includes(buscaAtual.toLowerCase())
      );

    if (!append) grid.innerHTML = "";
    grid.insertAdjacentHTML("beforeend", data.map(cardTemplate).join(""));

    lastDoc = snap.docs[snap.docs.length - 1] || null;
    btnMais.hidden = !lastDoc;
    statusEl.textContent = data.length ? "" : "Sem itens nesta categoria.";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Erro ao carregar.";
  }
}

// ===== Interações =====
menu.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-cat]");
  if (!btn) return;

  // estado visual do menu
  menu.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  // troca categoria
  categoriaAtual = btn.dataset.cat;
  lastDoc = null;

  if (ENABLE_PAGINATION_FALLBACK) {
    btnMais.hidden = true;
    carregarPagina(categoriaAtual, false);
  } else {
    listenCategoria(categoriaAtual);
  }
});

busca.addEventListener("input", () => {
  buscaAtual = busca.value.trim();
  // Reaplica o filtro: com realtime, basta re-renderizar no listener (já filtra)
  // Para simplificar, quando em realtime, apenas reiniciamos a escuta.
  if (ENABLE_PAGINATION_FALLBACK) {
    lastDoc = null;
    carregarPagina(categoriaAtual, false);
  } else {
    listenCategoria(categoriaAtual);
  }
});

btnMais.addEventListener("click", () => carregarPagina(categoriaAtual, true));

// ===== Inicialização =====
// Para itens novos, defina updated_at com serverTimestamp() no painel/admin do Firebase.
// Aqui, apenas disparamos o primeiro carregamento.
if (ENABLE_PAGINATION_FALLBACK) {
  carregarPagina(categoriaAtual, false);
} else {
  listenCategoria(categoriaAtual);
}
