
/* ==========================================
   FLEETCONTROL - GESTÃO DE FROTA
   Arquivo: script.js
   ========================================== */

"use strict";

// ==========================================
// 1. FUNÇÕES AUXILIARES
// ==========================================

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "fleetControlDadosV1";

function gerarId() {
    return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 8)
    );
}

function escaparHTML(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caractere]);
}

function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function formatarData(data) {
    if (!data) return "-";

    const partes = String(data).split("-");

    if (partes.length !== 3) return escaparHTML(data);

    return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function obterValor(id) {
    return $(id).value.trim();
}

function obterNumero(id) {
    return Number($(id).value);
}

function notificar(mensagem) {
    alert(mensagem);
}

// ==========================================
// 2. DADOS DO SISTEMA
// ==========================================

const dadosPadrao = {
    veiculos: [],
    motoristas: [],
    manutencoes: [],
    abastecimentos: [],
    multas: []
};

function carregarDados() {
    try {
        const salvo = localStorage.getItem(STORAGE_KEY);

        if (!salvo) {
            return structuredClone(dadosPadrao);
        }

        const dados = JSON.parse(salvo);

        return {
            veiculos: Array.isArray(dados.veiculos) ? dados.veiculos : [],
            motoristas: Array.isArray(dados.motoristas) ? dados.motoristas : [],
            manutencoes: Array.isArray(dados.manutencoes) ? dados.manutencoes : [],
            abastecimentos: Array.isArray(dados.abastecimentos) ? dados.abastecimentos : [],
            multas: Array.isArray(dados.multas) ? dados.multas : []
        };
    } catch (erro) {
        console.error("Erro ao carregar os dados:", erro);
        return structuredClone(dadosPadrao);
    }
}

let dados = carregarDados();

function salvarDados() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(dados));
        return true;
    } catch (erro) {
        console.error("Erro ao salvar os dados:", erro);
        notificar("Não foi possível salvar os dados neste navegador.");
        return false;
    }
}

// ==========================================
// 3. NAVEGAÇÃO ENTRE AS TELAS
// ==========================================

const titulos = {
    painel: "Painel",
    veiculos: "Cadastro de veículos",
    motoristas: "Cadastro de motoristas",
    manutencao: "Manutenção",
    abastecimento: "Abastecimento",
    multas: "Multas",
    relatorios: "Relatórios"
};

function abrirPagina(nomePagina) {
    const pagina = $(nomePagina);

    if (!pagina || !pagina.classList.contains("page")) {
        return;
    }

    document.querySelectorAll(".page").forEach((elemento) => {
        elemento.classList.remove("active");
    });

    pagina.classList.add("active");

    document.querySelectorAll(".menu-item").forEach((botao) => {
        const ativo = botao.dataset.page === nomePagina;

        botao.classList.toggle("active", ativo);

        if (ativo) {
            botao.setAttribute("aria-current", "page");
        } else {
            botao.removeAttribute("aria-current");
        }
    });

    $("pageTitle").textContent = titulos[nomePagina] || "FleetControl";

    // Atualiza os dados da tela aberta.
    renderizarTudo();
}

document.querySelectorAll(".menu-item").forEach((botao) => {
    botao.addEventListener("click", () => {
        abrirPagina(botao.dataset.page);
    });
});

// Botões de acesso rápido no painel.
document.querySelectorAll("[data-go]").forEach((botao) => {
    botao.addEventListener("click", () => {
        abrirPagina(botao.dataset.go);
    });
});

// Recolher ou expandir o menu lateral.
$("menuToggle").addEventListener("click", () => {
    $("sidebar").classList.toggle("collapsed");
});

// ==========================================
// 4. CADASTRO DE VEÍCULOS
// ==========================================

$("formVeiculo").addEventListener("submit", (evento) => {
    evento.preventDefault();

    const id = obterValor("veiculoId");
    const placa = obterValor("placa").toUpperCase();

    if (!placa) {
        notificar("Informe a placa do veículo.");
        return;
    }

    const placaDuplicada = dados.veiculos.some((veiculo) =>
        veiculo.placa.toUpperCase() === placa && veiculo.id !== id
    );

    if (placaDuplicada) {
        notificar("Já existe um veículo cadastrado com essa placa.");
        return;
    }

    const veiculo = {
        id: id || gerarId(),
        placa,
        modelo: obterValor("modelo"),
        marca: obterValor("marca"),
        ano: obterNumero("ano"),
        tipo: obterValor("tipoVeiculo"),
        status: obterValor("statusVeiculo")
    };

    if (id) {
        dados.veiculos = dados.veiculos.map((item) =>
            item.id === id ? veiculo : item
        );
    } else {
        dados.veiculos.push(veiculo);
    }

    if (!salvarDados()) return;

    $("formVeiculo").reset();
    $("veiculoId").value = "";

    renderizarTudo();

    notificar(id
        ? "Veículo atualizado com sucesso!"
        : "Veículo cadastrado com sucesso!"
    );
});

function renderizarVeiculos() {
    const tabela = $("listaVeiculos");

    if (dados.veiculos.length === 0) {
        tabela.innerHTML = `
            <tr>
                <td colspan="6">Nenhum veículo cadastrado.</td>
            </tr>
        `;
        return;
    }

    tabela.innerHTML = dados.veiculos.map((veiculo) => `
        <tr>
            <td><strong>${escaparHTML(veiculo.placa)}</strong></td>
            <td>${escaparHTML(veiculo.modelo)}</td>
            <td>${escaparHTML(veiculo.marca)}</td>
            <td>${escaparHTML(veiculo.ano)}</td>
            <td>${criarStatus(veiculo.status)}</td>
            <td>
                <button class="secondary-button"
                    data-editar-veiculo="${escaparHTML(veiculo.id)}">
                    Editar
                </button>
                <button class="danger-button"
                    data-excluir-veiculo="${escaparHTML(veiculo.id)}">
                    Excluir
                </button>
            </td>
        </tr>
    `).join("");
}

$("listaVeiculos").addEventListener("click", (evento) => {
    const editar = evento.target.closest("[data-editar-veiculo]");
    const excluir = evento.target.closest("[data-excluir-veiculo]");

    if (editar) {
        editarVeiculo(editar.dataset.editarVeiculo);
    }

    if (excluir) {
        excluirVeiculo(excluir.dataset.excluirVeiculo);
    }
});

function editarVeiculo(id) {
    const veiculo = dados.veiculos.find((item) => item.id === id);

    if (!veiculo) return;

    $("veiculoId").value = veiculo.id;
    $("placa").value = veiculo.placa;
    $("modelo").value = veiculo.modelo;
    $("marca").value = veiculo.marca;
    $("ano").value = veiculo.ano;
    $("tipoVeiculo").value = veiculo.tipo;
    $("statusVeiculo").value = veiculo.status;

    abrirPagina("veiculos");
    $("placa").focus();
}

function excluirVeiculo(id) {
    const relacionado = [
        ...dados.manutencoes,
        ...dados.abastecimentos,
        ...dados.multas
    ].some((item) => item.veiculoId === id);

    if (relacionado) {
        notificar(
            "Este veículo possui registros de manutenção, abastecimento ou multas. " +
            "Mantenha o cadastro para preservar o histórico."
        );
        return;
    }

    if (!confirm("Deseja realmente excluir este veículo?")) return;

    dados.veiculos = dados.veiculos.filter((item) => item.id !== id);

    if (salvarDados()) {
        renderizarTudo();
        notificar("Veículo excluído.");
    }
}

// ==========================================
// 5. CADASTRO DE MOTORISTAS
// ==========================================

$("formMotorista").addEventListener("submit", (evento) => {
    evento.preventDefault();

    const id = obterValor("motoristaId");
    const cpf = obterValor("cpfMotorista");

    const cpfDuplicado = dados.motoristas.some((motorista) =>
        motorista.cpf === cpf && motorista.id !== id
    );

    if (cpfDuplicado) {
        notificar("Já existe um motorista cadastrado com esse CPF.");
        return;
    }

    const motorista = {
        id: id || gerarId(),
        nome: obterValor("nomeMotorista"),
        cpf,
        cnh: obterValor("cnhMotorista"),
        validade: obterValor("validadeCnh"),
        telefone: obterValor("telefoneMotorista"),
        status: obterValor("statusMotorista")
    };

    if (id) {
        dados.motoristas = dados.motoristas.map((item) =>
            item.id === id ? motorista : item
        );
    } else {
        dados.motoristas.push(motorista);
    }

    if (!salvarDados()) return;

    $("formMotorista").reset();
    $("motoristaId").value = "";

    renderizarTudo();

    notificar(id
        ? "Motorista atualizado com sucesso!"
        : "Motorista cadastrado com sucesso!"
    );
});

function renderizarMotoristas() {
    const tabela = $("listaMotoristas");

    if (dados.motoristas.length === 0) {
        tabela.innerHTML = `
            <tr>
                <td colspan="6">Nenhum motorista cadastrado.</td>
            </tr>
        `;
        return;
    }

    tabela.innerHTML = dados.motoristas.map((motorista) => `
        <tr>
            <td>${escaparHTML(motorista.nome)}</td>
            <td>${escaparHTML(motorista.cpf)}</td>
            <td>${escaparHTML(motorista.cnh)}</td>
            <td>${formatarData(motorista.validade)}</td>
            <td>${criarStatus(motorista.status)}</td>
            <td>
                <button class="secondary-button"
                    data-editar-motorista="${escaparHTML(motorista.id)}">
                    Editar
                </button>
                <button class="danger-button"
                    data-excluir-motorista="${escaparHTML(motorista.id)}">
                    Excluir
                </button>
            </td>
        </tr>
    `).join("");
}

$("listaMotoristas").addEventListener("click", (evento) => {
    const editar = evento.target.closest("[data-editar-motorista]");
    const excluir = evento.target.closest("[data-excluir-motorista]");

    if (editar) editarMotorista(editar.dataset.editarMotorista);
    if (excluir) excluirMotorista(excluir.dataset.excluirMotorista);
});

function editarMotorista(id) {
    const motorista = dados.motoristas.find((item) => item.id === id);

    if (!motorista) return;

    $("motoristaId").value = motorista.id;
    $("nomeMotorista").value = motorista.nome;
    $("cpfMotorista").value = motorista.cpf;
    $("cnhMotorista").value = motorista.cnh;
    $("validadeCnh").value = motorista.validade;
    $("telefoneMotorista").value = motorista.telefone;
    $("statusMotorista").value = motorista.status;

    abrirPagina("motoristas");
    $("nomeMotorista").focus();
}

function excluirMotorista(id) {
    if (!confirm("Deseja realmente excluir este motorista?")) return;

    dados.motoristas = dados.motoristas.filter((item) => item.id !== id);

    if (salvarDados()) {
        renderizarTudo();
        notificar("Motorista excluído.");
    }
}

// ==========================================
// 6. LISTAS DE VEÍCULOS NOS FORMULÁRIOS
// ==========================================

function atualizarSeletoresVeiculos() {
    const seletores = [
        "veiculoManutencao",
        "veiculoAbastecimento",
        "veiculoMulta"
    ];

    seletores.forEach((id) => {
        const select = $(id);
        const valorAnterior = select.value;

        select.innerHTML = `
            <option value="">Selecione um veículo</option>
            ${dados.veiculos.map((veiculo) => `
                <option value="${escaparHTML(veiculo.id)}">
                    ${escaparHTML(veiculo.placa)} - ${escaparHTML(veiculo.modelo)}
                </option>
            `).join("")}
        `;

        if (dados.veiculos.some((veiculo) => veiculo.id === valorAnterior)) {
            select.value = valorAnterior;
        }
    });
}

function nomeDoVeiculo(id) {
    const veiculo = dados.veiculos.find((item) => item.id === id);

    return veiculo
        ? `${veiculo.placa} - ${veiculo.modelo}`
        : "Veículo não encontrado";
}

// ==========================================
// 7. REGISTRO DE MANUTENÇÕES
// ==========================================

$("formManutencao").addEventListener("submit", (evento) => {
    evento.preventDefault();

    const manutencao = {
        id: gerarId(),
        veiculoId: obterValor("veiculoManutencao"),
        tipo: obterValor("tipoManutencao"),
        data: obterValor("dataManutencao"),
        valor: obterNumero("valorManutencao"),
        descricao: obterValor("descricaoManutencao")
    };

    if (!dados.veiculos.some((item) => item.id === manutencao.veiculoId)) {
        notificar("Cadastre um veículo antes de registrar a manutenção.");
        return;
    }

    dados.manutencoes.push(manutencao);

    if (!salvarDados()) return;

    $("formManutencao").reset();
    renderizarTudo();
    notificar("Manutenção registrada com sucesso!");
});

function renderizarManutencoes() {
    const tabela = $("listaManutencoes");

    if (!dados.manutencoes.length) {
        tabela.innerHTML = `
            <tr><td colspan="4">Nenhuma manutenção registrada.</td></tr>
        `;
        return;
    }

    tabela.innerHTML = dados.manutencoes.slice().reverse().map((item) => `
        <tr>
            <td>${escaparHTML(nomeDoVeiculo(item.veiculoId))}</td>
            <td>${escaparHTML(item.tipo)}</td>
            <td>${formatarData(item.data)}</td>
            <td>${formatarMoeda(item.valor)}</td>
        </tr>
    `).join("");
}

// ==========================================
// 8. REGISTRO DE ABASTECIMENTOS
// ==========================================

$("formAbastecimento").addEventListener("submit", (evento) => {
    evento.preventDefault();

    const abastecimento = {
        id: gerarId(),
        veiculoId: obterValor("veiculoAbastecimento"),
        data: obterValor("dataAbastecimento"),
        combustivel: obterValor("combustivel"),
        litros: obterNumero("litros"),
        valor: obterNumero("valorAbastecimento")
    };

    if (!dados.veiculos.some((item) => item.id === abastecimento.veiculoId)) {
        notificar("Cadastre um veículo antes de registrar o abastecimento.");
        return;
    }

    if (abastecimento.litros <= 0 || abastecimento.valor < 0) {
        notificar("Informe litros válidos e um valor não negativo.");
        return;
    }

    dados.abastecimentos.push(abastecimento);

    if (!salvarDados()) return;

    $("formAbastecimento").reset();
    renderizarTudo();
    notificar("Abastecimento registrado com sucesso!");
});

function renderizarAbastecimentos() {
    const tabela = $("listaAbastecimentos");

    if (!dados.abastecimentos.length) {
        tabela.innerHTML = `
            <tr><td colspan="5">Nenhum abastecimento registrado.</td></tr>
        `;
        return;
    }

    tabela.innerHTML = dados.abastecimentos.slice().reverse().map((item) => `
        <tr>
            <td>${escaparHTML(nomeDoVeiculo(item.veiculoId))}</td>
            <td>${formatarData(item.data)}</td>
            <td>${escaparHTML(item.combustivel)}</td>
            <td>${escaparHTML(item.litros.toLocaleString("pt-BR"))} L</td>
            <td>${formatarMoeda(item.valor)}</td>
        </tr>
    `).join("");
}

// ==========================================
// 9. REGISTRO DE MULTAS
// ==========================================

$("formMulta").addEventListener("submit", (evento) => {
    evento.preventDefault();

    const multa = {
        id: gerarId(),
        veiculoId: obterValor("veiculoMulta"),
        data: obterValor("dataMulta"),
        descricao: obterValor("descricaoMulta"),
        valor: obterNumero("valorMulta"),
        vencimento: obterValor("vencimentoMulta"),
        status: obterValor("statusMulta")
    };

    if (!dados.veiculos.some((item) => item.id === multa.veiculoId)) {
        notificar("Cadastre um veículo antes de registrar uma multa.");
        return;
    }

    if (multa.valor < 0) {
        notificar("O valor da multa não pode ser negativo.");
        return;
    }

    dados.multas.push(multa);

    if (!salvarDados()) return;

    $("formMulta").reset();
    renderizarTudo();
    notificar("Multa registrada com sucesso!");
});

function renderizarMultas() {
    const tabela = $("listaMultas");

    if (!dados.multas.length) {
        tabela.innerHTML = `
            <tr><td colspan="5">Nenhuma multa registrada.</td></tr>
        `;
        return;
    }

    tabela.innerHTML = dados.multas.slice().reverse().map((item) => `
        <tr>
            <td>${escaparHTML(nomeDoVeiculo(item.veiculoId))}</td>
            <td>${formatarData(item.data)}</td>
            <td>${escaparHTML(item.descricao)}</td>
            <td>${formatarMoeda(item.valor)}</td>
            <td>${criarStatus(item.status)}</td>
        </tr>
    `).join("");
}

// ==========================================
// 10. STATUS VISUAIS
// ==========================================

function criarStatus(status) {
    const valor = String(status || "");
    const normalizado = valor.toLowerCase();

    let classe = "inactive";

    if (["ativo", "paga"].includes(normalizado)) {
        classe = "active";
    } else if (["pendente", "em manutenção", "em recurso"].includes(normalizado)) {
        classe = "pending";
    } else if (normalizado === "inativo" || normalizado === "afastado") {
        classe = "inactive";
    }

    return `<span class="status ${classe}">${escaparHTML(valor || "-")}</span>`;
}

// ==========================================
// 11. PAINEL PRINCIPAL
// ==========================================

function renderizarPainel() {
    $("totalVeiculos").textContent = dados.veiculos.length;
    $("totalMotoristas").textContent = dados.motoristas.length;
    $("totalManutencoes").textContent = dados.manutencoes.length;
    $("totalMultas").textContent = dados.multas.length;

    const lista = $("ultimosVeiculos");

    if (!dados.veiculos.length) {
        lista.className = "empty-state";
        lista.textContent = "Nenhum veículo cadastrado ainda.";
        return;
    }

    lista.className = "table-wrapper";

    lista.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Placa</th>
                    <th>Modelo</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${dados.veiculos.slice(-5).reverse().map((veiculo) => `
                    <tr>
                        <td><strong>${escaparHTML(veiculo.placa)}</strong></td>
                        <td>${escaparHTML(veiculo.modelo)}</td>
                        <td>${criarStatus(veiculo.status)}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

// ==========================================
// 12. RELATÓRIOS FINANCEIROS
// ==========================================

function renderizarRelatorios() {
    const totalManutencao = dados.manutencoes.reduce(
        (total, item) => total + Number(item.valor || 0), 0
    );

    const totalAbastecimento = dados.abastecimentos.reduce(
        (total, item) => total + Number(item.valor || 0), 0
    );

    const totalMultas = dados.multas.reduce(
        (total, item) => total + Number(item.valor || 0), 0
    );

    $("relatorioManutencao").textContent = formatarMoeda(totalManutencao);
    $("relatorioAbastecimento").textContent = formatarMoeda(totalAbastecimento);
    $("relatorioMultas").textContent = formatarMoeda(totalMultas);
}

// ==========================================
// 13. EXPORTAR ARQUIVOS CSV
// ==========================================

function exportarCSV(nomeArquivo, cabecalhos, linhas) {
    const conteudo = [
        cabecalhos,
        ...linhas
    ].map((linha) => linha.map((valor) => {
        let texto = String(valor ?? "");

        // Evita que valores exportados sejam interpretados
        // como fórmulas por programas de planilha.
        if (/^[\s]*[=+\-@]/.test(texto)) {
            texto = "'" + texto;
        }

        return `"${texto.replace(/"/g, '""')}"`;
    }).join(";")).join("\r\n");

    const blob = new Blob(
        ["\uFEFF" + conteudo],
        { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

$("exportarVeiculos").addEventListener("click", () => {
    const linhas = dados.veiculos.map((item) => [
        item.placa,
        item.modelo,
        item.marca,
        item.ano,
        item.tipo,
        item.status
    ]);

    exportarCSV(
        "relatorio-veiculos.csv",
        ["Placa", "Modelo", "Marca", "Ano", "Tipo", "Status"],
        linhas
    );
});

$("exportarMotoristas").addEventListener("click", () => {
    const linhas = dados.motoristas.map((item) => [
        item.nome,
        item.cpf,
        item.cnh,
        item.validade,
        item.telefone,
        item.status
    ]);

    exportarCSV(
        "relatorio-motoristas.csv",
        ["Nome", "CPF", "CNH", "Validade CNH", "Telefone", "Status"],
        linhas
    );
});

$("exportarDespesas").addEventListener("click", () => {
    const linhas = [
        ...dados.manutencoes.map((item) => [
            "Manutenção",
            nomeDoVeiculo(item.veiculoId),
            item.data,
            item.tipo,
            item.valor
        ]),
        ...dados.abastecimentos.map((item) => [
            "Abastecimento",
            nomeDoVeiculo(item.veiculoId),
            item.data,
            item.combustivel,
            item.valor
        ]),
        ...dados.multas.map((item) => [
            "Multa",
            nomeDoVeiculo(item.veiculoId),
            item.data,
            item.descricao,
            item.valor
        ])
    ];

    exportarCSV(
        "relatorio-despesas.csv",
        ["Categoria", "Veículo", "Data", "Descrição", "Valor"],
        linhas
    );
});

// ==========================================
// 14. ATUALIZAÇÃO GERAL DO SISTEMA
// ==========================================

function renderizarTudo() {
    renderizarVeiculos();
    renderizarMotoristas();
    atualizarSeletoresVeiculos();
    renderizarManutencoes();
    renderizarAbastecimentos();
    renderizarMultas();
    renderizarPainel();
    renderizarRelatorios();
}

// ==========================================
// 15. INICIALIZAÇÃO
// ==========================================

renderizarTudo();
abrirPagina("painel");

console.log("FleetControl iniciado com sucesso!");
