/* ==================================================
   FLEETCONTROL — SCRIPT.JS
   Front-end conectado à API Express + SQLite
   Execute em http://localhost:3000
   ================================================== */

"use strict";

const API = "/api";
const $ = (id) => document.getElementById(id);

let dados = {
  veiculos: [],
  motoristas: [],
  manutencoes: [],
  abastecimentos: [],
  multas: []
};

const titulos = {
  dashboard: "Painel",
  veiculos: "Cadastro de veículos",
  motoristas: "Cadastro de motoristas",
  abastecimentos: "Abastecimento",
  multas: "Multas",
  manutencoes: "Manutenção",
  relatorios: "Relatórios"
};

/* ---------- utilitários ---------- */

const moeda = (valor) =>
  Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });

const escapar = (valor) =>
  String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);

function dataBR(valor) {
  if (!valor) return "—";
  const texto = String(valor).slice(0, 10);
  const partes = texto.split("-");
  return partes.length === 3
    ? `${partes[2]}/${partes[1]}/${partes[0]}`
    : escapar(texto);
}

function hojeISO() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

let temporizadorToast;

function notificar(mensagem) {
  const toast = $("toast");

  if (!toast) {
    window.alert(mensagem);
    return;
  }

  toast.textContent = mensagem;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => {
    toast.textContent = "";
  }, 5000);
}

function definirTexto(id, valor) {
  const elemento = $(id);
  if (elemento) elemento.textContent = valor;
}

function valorBusca(id) {
  return ($(id)?.value || "").toLowerCase();
}

function textoVazio(colunas, mensagem) {
  return `<tr><td colspan="${colunas}">${escapar(mensagem)}</td></tr>`;
}

function preencherTabela(id, linhas, colunas, mensagemVazia) {
  const corpo = $(id);
  if (!corpo) return;

  corpo.innerHTML = linhas.length
    ? linhas.join("")
    : textoVazio(colunas, mensagemVazia);
}

const somar = (lista) =>
  lista.reduce((total, item) => total + Number(item.valor || 0), 0);

/* ---------- API ---------- */

async function requisicaoAPI(caminho, opcoes = {}) {
  let resposta;

  try {
    resposta = await fetch(`${API}${caminho}`, {
      cache: "no-store",
      ...opcoes,
      headers: {
        ...(opcoes.body ? { "Content-Type": "application/json" } : {}),
        ...opcoes.headers
      }
    });
  } catch (erro) {
    throw new Error(
      "Não foi possível acessar o servidor. " +
      "Inicie o Node.js e abra http://localhost:3000. " +
      erro.message
    );
  }

  const texto = await resposta.text();
  let resultado = null;

  try {
    resultado = texto ? JSON.parse(texto) : null;
  } catch {
    resultado = { erro: texto || "Resposta inválida do servidor." };
  }

  if (resposta.status === 401) {
    window.location.replace("/login.html");
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  if (!resposta.ok) {
    throw new Error(
      resultado?.erro ||
      `Erro HTTP ${resposta.status} ao acessar ${caminho}.`
    );
  }

  return resultado;
}

function normalizar(tipo, item) {
  const registro = { ...item };

  if (tipo === "veiculos") {
    registro.motoristaId = item.motorista_id ?? item.motoristaId;
  }

  if (tipo === "motoristas") {
    registro.validade = item.validade ?? item.validade_cnh ?? "";
  }

  if (tipo === "manutencoes") {
    registro.veiculoId = item.veiculo_id ?? item.veiculoId;
    registro.valor = Number(item.valor ?? item.custo ?? 0);
  }

  if (tipo === "abastecimentos") {
    registro.veiculoId = item.veiculo_id ?? item.veiculoId;
    registro.valor = Number(item.valor_total ?? item.valor ?? 0);
    registro.litros = Number(item.litros ?? 0);
    registro.valorLitro = Number(item.valor_litro ?? 0);
    registro.km = item.km ?? item.quilometragem ?? "";
  }

  if (tipo === "multas") {
    registro.veiculoId = item.veiculo_id ?? item.veiculoId;
    registro.motoristaId = item.motorista_id ?? item.motoristaId;
    registro.valor = Number(item.valor ?? 0);
  }

  return registro;
}

async function carregarDados() {
  const tipos = Object.keys(dados);

  const resultados = await Promise.all(
    tipos.map(async (tipo) => {
      const lista = await requisicaoAPI(`/${tipo}`);

      if (!Array.isArray(lista)) {
        throw new Error(`A rota /api/${tipo} não retornou uma lista.`);
      }

      return [tipo, lista.map((item) => normalizar(tipo, item))];
    })
  );

  dados = Object.fromEntries(resultados);
  renderizarTudo();
}

/* ---------- navegação entre as telas ---------- */

function abrirTela(nome) {
  const tela = $(`screen-${nome}`);
  if (!tela) return;

  document.querySelectorAll(".screen").forEach((secao) => {
    secao.hidden = true;
  });

  tela.hidden = false;

  document.querySelectorAll(".nav-link").forEach((link) => {
    const ativa = link.dataset.screen === nome;
    link.classList.toggle("active", ativa);

    if (ativa) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  definirTexto("pageTitle", titulos[nome] || "FleetControl");

  $("sidebar").classList.remove("mobile-open");

  if (window.innerWidth <= 700) {
    $("sidebar").classList.remove("collapsed");
  }

  window.scrollTo({ top: 0 });
}

function configurarNavegacao() {
  document.querySelectorAll(".nav-link[data-screen]").forEach((link) => {
    link.addEventListener("click", (evento) => {
      evento.preventDefault();
      abrirTela(link.dataset.screen);
    });
  });

  document.querySelectorAll("[data-go]").forEach((botao) => {
    botao.addEventListener("click", () => {
      abrirTela(botao.dataset.go);
    });
  });

  $("menuToggle").addEventListener("click", () => {
    const sidebar = $("sidebar");

    if (window.innerWidth <= 700) {
      sidebar.classList.toggle("mobile-open");
      return;
    }

    const recolhido = sidebar.classList.toggle("collapsed");
    $("menuToggle").setAttribute("aria-expanded", String(!recolhido));
    $("menuToggle").setAttribute(
      "aria-label",
      recolhido ? "Expandir menu" : "Recolher menu"
    );

    const rotulo = $("menuToggle").querySelector(".toggle-label");
    if (rotulo) rotulo.textContent = recolhido ? "Expandir menu" : "Recolher menu";
  });

  $("mobileMenuToggle").addEventListener("click", () => {
    $("sidebar").classList.toggle("mobile-open");
  });

  document.addEventListener("click", (evento) => {
    if (
      window.innerWidth <= 700 &&
      $("sidebar").classList.contains("mobile-open") &&
      !$("sidebar").contains(evento.target) &&
      !$("mobileMenuToggle").contains(evento.target)
    ) {
      $("sidebar").classList.remove("mobile-open");
    }
  });
}

/* ---------- status coloridos ---------- */

function classificarStatus(status) {
  const s = String(status || "").toLowerCase();

  if (s.includes("manuten") || s.includes("oficina")) return "manutencao";
  if (s.includes("inativo") || s.includes("baixado")) return "inativo";

  if (
    s.includes("ativo") ||
    s.includes("disponível") ||
    s.includes("disponivel") ||
    s.includes("em uso")
  ) {
    return "disponivel";
  }

  return "outro";
}

function statusHTML(status) {
  const texto = String(status || "Ativo");
  const normalizado = texto.toLowerCase();
  const tipo = classificarStatus(texto);

  let classe = "status-badge";

  if (normalizado.includes("vencida")) {
    classe = "status-inativo";
  } else if (tipo === "manutencao") {
    classe = "status-manutencao";
  } else if (tipo === "inativo") {
    classe = "status-inativo";
  } else if (tipo === "disponivel") {
    classe = "status-ativo";
  } else if (normalizado.includes("pendente")) {
    classe = "status-pendente";
  } else if (normalizado.includes("paga")) {
    classe = "status-paga";
  }

  return `<span class="${classe}">${escapar(texto)}</span>`;
}

function nomeVeiculo(id) {
  const veiculo = dados.veiculos.find((v) => String(v.id) === String(id));

  return veiculo
    ? `${veiculo.placa} — ${veiculo.modelo}`
    : "Veículo não encontrado";
}

/* ---------- veículos ---------- */

function renderizarVeiculos() {
  const busca = valorBusca("buscaVeiculos");

  const lista = dados.veiculos.filter((v) =>
    `${v.placa || ""} ${v.marca || ""} ${v.modelo || ""} ${v.tipo || ""}`
      .toLowerCase().includes(busca)
  );

  definirTexto("contadorVeiculos", `${dados.veiculos.length} veículo(s)`);

  preencherTabela(
    "tabelaVeiculos",
    lista.map((v) => `
      <tr>
        <td><strong>${escapar(v.placa)}</strong></td>
        <td>${escapar(v.marca || "—")}</td>
        <td>${escapar(v.modelo || "—")}</td>
        <td>${escapar(v.ano || "—")}</td>
        <td>${escapar(v.tipo || "—")}</td>
        <td>${statusHTML(v.status)}</td>
        <td>
          <button class="secondary-button" type="button"
            data-editar-veiculo="${escapar(v.id)}">Editar</button>
          <button class="danger-button" type="button"
            data-excluir-veiculo="${escapar(v.id)}">Excluir</button>
        </td>
      </tr>`),
    7,
    dados.veiculos.length
      ? "Nenhum veículo encontrado."
      : "Nenhum veículo cadastrado."
  );
}

/* ---------- motoristas ---------- */

function renderizarMotoristas() {
  const busca = valorBusca("buscaMotoristas");

  const lista = dados.motoristas.filter((m) =>
    `${m.nome || ""} ${m.cpf || ""} ${m.cnh || ""} ${m.telefone || ""}`
      .toLowerCase().includes(busca)
  );

  definirTexto("contadorMotoristas", `${dados.motoristas.length} motorista(s)`);

  preencherTabela(
    "tabelaMotoristas",
    lista.map((m) => {
      const vencida = m.validade && String(m.validade).slice(0, 10) < hojeISO();

      return `
        <tr>
          <td><strong>${escapar(m.nome)}</strong></td>
          <td>${escapar(m.cpf || "—")}</td>
          <td>${escapar(m.cnh || "—")}</td>
          <td>${dataBR(m.validade)}</td>
          <td>${escapar(m.telefone || "—")}</td>
          <td>${statusHTML(vencida ? "CNH vencida" : (m.status || "Ativo"))}</td>
          <td>
            <button class="danger-button" type="button"
              data-excluir="motoristas" data-id="${escapar(m.id)}">
              Excluir
            </button>
          </td>
        </tr>`;
    }),
    7,
    dados.motoristas.length
      ? "Nenhum motorista encontrado."
      : "Nenhum motorista cadastrado."
  );
}

/* ---------- selects dos formulários ---------- */

function preencherSelect(id, registros, rotulo) {
  const select = $(id);
  if (!select) return;

  const anterior = select.value;
  const opcaoInicial = select.options[0]?.textContent || "Selecione";

  select.innerHTML =
    `<option value="">${escapar(opcaoInicial)}</option>` +
    registros.map((registro) =>
      `<option value="${escapar(registro.id)}">${escapar(rotulo(registro))}</option>`
    ).join("");

  if ([...select.options].some((o) => o.value === String(anterior))) {
    select.value = String(anterior);
  }
}

function renderizarSelects() {
  preencherSelect("motorista", dados.motoristas, (m) => m.nome);

  ["veiculoAbastecimento", "veiculoMulta", "veiculoManutencao"]
    .forEach((id) => {
      preencherSelect(id, dados.veiculos, (v) => `${v.placa} — ${v.modelo}`);
    });
}

/* ---------- manutenções ---------- */

function renderizarManutencoes() {
  const busca = valorBusca("buscaManutencoes");

  const lista = dados.manutencoes.filter((m) =>
    `${nomeVeiculo(m.veiculoId)} ${m.tipo || ""} ${m.descricao || ""}`
      .toLowerCase().includes(busca)
  );

  definirTexto("contadorManutencoes", `${dados.manutencoes.length} manutenção(ões)`);

  preencherTabela(
    "tabelaManutencoes",
    lista.map((m) => `
      <tr>
        <td>${escapar(nomeVeiculo(m.veiculoId))}</td>
        <td>${dataBR(m.data)}</td>
        <td>${escapar(m.tipo || "—")}</td>
        <td>${escapar(m.descricao || "—")}</td>
        <td>${moeda(m.valor)}</td>
        <td>
          <button class="danger-button" type="button"
            data-excluir="manutencoes" data-id="${escapar(m.id)}">
            Excluir
          </button>
        </td>
      </tr>`),
    6,
    dados.manutencoes.length
      ? "Nenhuma manutenção encontrada."
      : "Nenhuma manutenção cadastrada."
  );
}

/* ---------- abastecimentos ---------- */

function renderizarAbastecimentos() {
  const busca = valorBusca("buscaAbastecimentos");

  const lista = dados.abastecimentos.filter((a) =>
    `${nomeVeiculo(a.veiculoId)} ${a.combustivel || ""}`
      .toLowerCase().includes(busca)
  );

  definirTexto(
    "contadorAbastecimentos",
    `${dados.abastecimentos.length} abastecimento(s)`
  );

  preencherTabela(
    "tabelaAbastecimentos",
    lista.map((a) => {
      const valorLitro = a.valorLitro || (a.litros > 0 ? a.valor / a.litros : 0);

      return `
        <tr>
          <td>${escapar(nomeVeiculo(a.veiculoId))}</td>
          <td>${dataBR(a.data)}</td>
          <td>${Number(a.litros || 0).toLocaleString("pt-BR")} L</td>
          <td>${moeda(valorLitro)}</td>
          <td>${moeda(a.valor)}</td>
          <td>${a.km ? `${escapar(a.km)} km` : "—"}</td>
          <td>${escapar(a.combustivel || "—")}</td>
          <td>
            <button class="danger-button" type="button"
              data-excluir="abastecimentos" data-id="${escapar(a.id)}">
              Excluir
            </button>
          </td>
        </tr>`;
    }),
    8,
    dados.abastecimentos.length
      ? "Nenhum abastecimento encontrado."
      : "Nenhum abastecimento cadastrado."
  );
}

/* ---------- multas ---------- */

function renderizarMultas() {
  const busca = valorBusca("buscaMultas");

  const lista = dados.multas.filter((m) =>
    `${nomeVeiculo(m.veiculoId)} ${m.descricao || ""} ${m.status || ""}`
      .toLowerCase().includes(busca)
  );

  definirTexto("contadorMultas", `${dados.multas.length} multa(s)`);

  preencherTabela(
    "tabelaMultas",
    lista.map((m) => `
      <tr>
        <td>${escapar(nomeVeiculo(m.veiculoId))}</td>
        <td>${dataBR(m.data)}</td>
        <td>${escapar(m.descricao || "—")}</td>
        <td>${moeda(m.valor)}</td>
        <td>${statusHTML(m.status || "Pendente")}</td>
        <td>${dataBR(m.vencimento)}</td>
        <td>
          <button class="danger-button" type="button"
            data-excluir="multas" data-id="${escapar(m.id)}">
            Excluir
          </button>
        </td>
      </tr>`),
    7,
    dados.multas.length
      ? "Nenhuma multa encontrada."
      : "Nenhuma multa cadastrada."
  );
}

/* ---------- painel e relatórios ---------- */

function renderizarPainel() {
  definirTexto("totalVeiculos", dados.veiculos.length);
  definirTexto("totalMotoristas", dados.motoristas.length);
  definirTexto("totalManutencoes", dados.manutencoes.length);
  definirTexto("totalAbastecimentos", dados.abastecimentos.length);
  definirTexto("totalMultas", dados.multas.length);

  const contar = (tipo) =>
    dados.veiculos.filter((v) => classificarStatus(v.status) === tipo).length;

  definirTexto("veiculosDisponiveis", contar("disponivel"));
  definirTexto("veiculosManutencao", contar("manutencao"));
  definirTexto("veiculosInativos", contar("inativo"));
}

function renderizarRelatorios() {
  const manutencoes = somar(dados.manutencoes);
  const abastecimentos = somar(dados.abastecimentos);
  const multas = somar(dados.multas);
  const total = manutencoes + abastecimentos + multas;

  definirTexto("totalCustoManutencao", moeda(manutencoes));
  definirTexto("totalCustoAbastecimento", moeda(abastecimentos));
  definirTexto("totalCustoMultas", moeda(multas));

  definirTexto("relatorioManutencao", moeda(manutencoes));
  definirTexto("relatorioAbastecimento", moeda(abastecimentos));
  definirTexto("relatorioMultas", moeda(multas));
  definirTexto("relatorioTotal", moeda(total));
}

function renderizarTudo() {
  renderizarVeiculos();
  renderizarMotoristas();
  renderizarManutencoes();
  renderizarAbastecimentos();
  renderizarMultas();
  renderizarSelects();
  renderizarPainel();
  renderizarRelatorios();
}

/* ---------- cadastros ---------- */

async function enviarCadastro(tipo, payload, form) {
  try {
    await requisicaoAPI(`/${tipo}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    form.reset();
    preencherDatas();
    await carregarDados();
    notificar("Cadastro realizado com sucesso!");
  } catch (erro) {
    console.error(`Erro ao cadastrar ${tipo}:`, erro);
    notificar(`Não foi possível salvar: ${erro.message}`);
  }
}

function configurarFormularios() {
  $("formVeiculo").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    await enviarCadastro("veiculos", {
      placa: $("placa").value.trim().toUpperCase(),
      marca: $("marca").value.trim(),
      modelo: $("modelo").value.trim(),
      ano: Number($("ano").value),
      tipo: $("tipoVeiculo").value || "Veículo",
      status: $("status").value,
      motorista_id: $("motorista").value
        ? Number($("motorista").value)
        : null
    }, evento.currentTarget);
  });

  $("formMotorista").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    await enviarCadastro("motoristas", {
      nome: $("nomeMotorista").value.trim(),
      cpf: $("cpfMotorista").value.trim(),
      cnh: $("cnhMotorista").value.trim(),
      telefone: $("telefoneMotorista").value.trim(),
      validade: $("validadeCnh").value,
      status: $("statusMotorista").value
    }, evento.currentTarget);
  });

  $("formManutencao").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    await enviarCadastro("manutencoes", {
      veiculo_id: Number($("veiculoManutencao").value),
      tipo: $("tipoManutencao").value,
      data: $("dataManutencao").value,
      valor: Number($("valorManutencao").value),
      descricao: $("descricaoManutencao").value.trim()
    }, evento.currentTarget);
  });

  $("formAbastecimento").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    const litros = Number($("litrosAbastecimento").value);
    const valorLitro = Number($("valorLitro").value);
    const total = Math.round(litros * valorLitro * 100) / 100;

    await enviarCadastro("abastecimentos", {
      veiculo_id: Number($("veiculoAbastecimento").value),
      data: $("dataAbastecimento").value,
      litros,
      valor_total: total,
      valor_litro: valorLitro,
      km: Number($("kmAbastecimento").value || 0),
      combustivel: $("combustivel").value,
      posto: ""
    }, evento.currentTarget);
  });

  $("formMulta").addEventListener("submit", async (evento) => {
    evento.preventDefault();

    await enviarCadastro("multas", {
      veiculo_id: Number($("veiculoMulta").value),
      data: $("dataMulta").value,
      valor: Number($("valorMulta").value),
      vencimento: $("vencimentoMulta").value,
      descricao: $("descricaoMulta").value.trim(),
      status: $("statusMulta").value
    }, evento.currentTarget);
  });
}

/* ---------- exclusão ---------- */

async function excluirRegistro(tipo, id) {
  if (tipo === "motoristas") {
    const emUso = dados.veiculos.some(
      (v) => String(v.motoristaId ?? v.motorista_id) === String(id)
    );

    if (emUso) {
      notificar(
        "Este motorista está atribuído a um veículo. " +
        "Remova a atribuição antes de excluir."
      );
      return;
    }
  }

  if (!window.confirm("Deseja realmente excluir este registro?")) return;

  try {
    await requisicaoAPI(`/${tipo}/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    await carregarDados();
    notificar("Registro excluído com sucesso!");
  } catch (erro) {
    notificar(`Não foi possível excluir: ${erro.message}`);
  }
}

async function excluirVeiculo(id) {
  const relacionado = [
    ...dados.manutencoes,
    ...dados.abastecimentos,
    ...dados.multas
  ].some((item) =>
    String(item.veiculoId ?? item.veiculo_id) === String(id)
  );

  if (relacionado) {
    notificar(
      "Este veículo possui registros relacionados. " +
      "Mantenha o cadastro para preservar o histórico."
    );
    return;
  }

  if (!window.confirm("Deseja realmente excluir este veículo?")) return;

  try {
    await requisicaoAPI(`/veiculos/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    await carregarDados();
    notificar("Veículo excluído com sucesso!");
  } catch (erro) {
    notificar(`Não foi possível excluir: ${erro.message}`);
  }
}

function configurarAcoesTabelas() {
  $("tabelaVeiculos").addEventListener("click", async (evento) => {
    const excluir = evento.target.closest("[data-excluir-veiculo]");
    const editar = evento.target.closest("[data-editar-veiculo]");

    if (excluir) {
      await excluirVeiculo(excluir.dataset.excluirVeiculo);
      return;
    }

    if (editar) {
      const veiculo = dados.veiculos.find(
        (v) => String(v.id) === String(editar.dataset.editarVeiculo)
      );

      if (!veiculo) return;

      $("placa").value = veiculo.placa || "";
      $("marca").value = veiculo.marca || "";
      $("modelo").value = veiculo.modelo || "";
      $("ano").value = veiculo.ano || "";
      $("tipoVeiculo").value = veiculo.tipo || "";
      $("status").value = veiculo.status === "Disponível"
        ? "Ativo"
        : (veiculo.status || "Ativo");
      $("motorista").value = veiculo.motoristaId ?? "";

      $("formVeiculo").scrollIntoView({ behavior: "smooth", block: "center" });

      notificar(
        "Os dados foram preenchidos para consulta. " +
        "A edição ainda depende de uma rota de atualização compatível."
      );
    }
  });

  document.addEventListener("click", async (evento) => {
    const botao = evento.target.closest("[data-excluir]");
    if (!botao) return;

    await excluirRegistro(botao.dataset.excluir, botao.dataset.id);
  });
}

/* ---------- pesquisa e exportação ---------- */

function configurarPesquisas() {
  const buscas = {
    buscaVeiculos: renderizarVeiculos,
    buscaMotoristas: renderizarMotoristas,
    buscaAbastecimentos: renderizarAbastecimentos,
    buscaMultas: renderizarMultas,
    buscaManutencoes: renderizarManutencoes
  };

  Object.entries(buscas).forEach(([id, renderizar]) => {
    $(id)?.addEventListener("input", renderizar);
  });
}

function exportarCSV() {
  const linhas = [
    ["Tipo", "Quantidade", "Custo total"],
    ["Veículos", dados.veiculos.length, ""],
    ["Motoristas", dados.motoristas.length, ""],
    ["Manutenções", dados.manutencoes.length, somar(dados.manutencoes)],
    ["Abastecimentos", dados.abastecimentos.length, somar(dados.abastecimentos)],
    ["Multas", dados.multas.length, somar(dados.multas)]
  ];

  const csv = linhas.map((linha) =>
    linha.map((valor) =>
      `"${String(valor ?? "").replace(/"/g, '""')}"`
    ).join(";")
  ).join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fleetcontrol-relatorio.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function preencherDatas() {
  definirTexto(
    "todayLabel",
    new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    })
  );

  ["dataManutencao", "dataAbastecimento", "dataMulta"].forEach((id) => {
    if ($(id) && !$(id).value) $(id).value = hojeISO();
  });
}

/* ---------- inicialização ---------- */

async function iniciarFleetControl() {
  configurarNavegacao();
  configurarFormularios();
  configurarAcoesTabelas();
  configurarPesquisas();
  preencherDatas();

  $("exportarRelatorio").addEventListener("click", exportarCSV);

  $("btnSair").addEventListener("click", async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch { /* ignora */ }

    window.location.replace("/login.html");
  });

  // Mostra as iniciais do usuário logado no avatar
  try {
    const eu = await requisicaoAPI("/me");
    const avatar = document.querySelector(".avatar");

    if (avatar && eu?.usuario) {
      avatar.textContent = eu.usuario.slice(0, 2).toUpperCase();
      avatar.title = eu.usuario;
    }
  } catch { /* ignora */ }

  document.querySelectorAll('form button[type="reset"]').forEach((botao) => {
    botao.addEventListener("click", () => {
      setTimeout(preencherDatas, 0);
    });
  });

  try {
    await carregarDados();
  } catch (erro) {
    console.error("Erro ao iniciar FleetControl:", erro);

    notificar(
      "O site abriu, mas não conseguiu carregar os dados.\n" +
      "Confirme se o servidor Express está rodando e se as rotas " +
      "/api/veiculos, /api/motoristas, /api/manutencoes, " +
      "/api/abastecimentos e /api/multas existem.\n" +
      erro.message
    );
  }
}

// Se a página for restaurada pelo botão "voltar", confere a sessão de novo.
window.addEventListener("pageshow", (evento) => {
  if (!evento.persisted) return;

  fetch("/api/me", { cache: "no-store" })
    .then((resposta) => {
      if (resposta.status === 401) {
        window.location.replace("/login.html");
      }
    })
    .catch(() => {});
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", iniciarFleetControl);
} else {
  iniciarFleetControl();
}