"use strict";

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const { Pool, types } = require("pg");

// ==================================================
// 0. CONFIGURAÇÕES GERAIS
// ==================================================

const PORT = Number(process.env.PORT) || 3000;

// O Render define RENDER=true automaticamente.
const EM_PRODUCAO =
  process.env.NODE_ENV === "production" || Boolean(process.env.RENDER);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ATENÇÃO: a variável DATABASE_URL não foi definida.");
  console.error(
    "No Render, copie a Internal Database URL do Postgres para o Web Service."
  );
  process.exit(1);
}

if (EM_PRODUCAO && !process.env.SESSION_SECRET) {
  console.error("ATENÇÃO: defina a variável SESSION_SECRET em produção.");
  console.error("Sem ela, todos os usuários seriam deslogados a cada deploy.");
  process.exit(1);
}

// Mesmo custo para os hashes reais e para o hash falso do login.
const CUSTO_BCRYPT = 10;

// O pg devolve NUMERIC e BIGINT como texto. Aqui eles viram número,
// para o front-end conseguir somar valores normalmente.
types.setTypeParser(1700, (valor) => parseFloat(valor)); // NUMERIC
types.setTypeParser(20, (valor) => parseInt(valor, 10)); // BIGINT / COUNT

// A URL externa do Render (…render.com) exige SSL; a interna, não.
function configuracaoSSL(url) {
  if (process.env.DATABASE_SSL === "false") return false;
  if (process.env.DATABASE_SSL === "true" || /\.render\.com/i.test(url)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: configuracaoSSL(DATABASE_URL),
  max: 10
});

pool.on("error", (erro) => {
  console.error("Erro inesperado na conexão com o Postgres:", erro);
});

const app = express();

// ==================================================
// 1. CONFIGURAÇÃO DO CORS
// ==================================================

const origensPermitidas = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  // Endereço público do serviço (ex.: https://fleetcontrol.onrender.com),
  // definido automaticamente pelo Render.
  process.env.RENDER_EXTERNAL_URL,
  // Outras origens, separadas por vírgula (ex.: um domínio próprio).
  ...(process.env.ORIGENS_PERMITIDAS || "").split(",")
]
  .map((origem) => (origem || "").trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(cors({
  origin: function (origem, callback) {
    if (!origem || origensPermitidas.includes(origem)) {
      return callback(null, true);
    }

    return callback(new Error("Origem não autorizada pelo CORS."));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());

// Impede o navegador de guardar páginas e respostas da API em cache.
// Assim, ao clicar em "voltar" depois de sair, o servidor é consultado
// de novo e pede login.
app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Expires": "0"
  });
  next();
});

if (EM_PRODUCAO) {
  app.set("trust proxy", 1); // necessário atrás do HTTPS do Render
}

// As sessões ficam na tabela "sessoes" do próprio Postgres,
// então ninguém é deslogado quando o servidor reinicia.
app.use(session({
  name: "fleetcontrol.sid",
  store: new PgSession({
    pool,
    tableName: "sessoes",
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: EM_PRODUCAO,
    maxAge: 8 * 60 * 60 * 1000 // fica logado por 8 horas
  }
}));

// Rota pública para o Health Check do Render.
app.get("/healthz", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (erro) {
    res.status(503).json({ ok: false });
  }
});

// ==================================================
// 2. ARQUIVOS DO FRONT-END
// ==================================================
// O sistema (index.html) exige login. Só o login.html,
// o style.css e o script.js são públicos.

const pastaProjeto = __dirname;

function paginaProtegida(req, res, next) {
  if (req.session.usuario) return next();
  res.redirect("/login.html");
}

app.get("/", paginaProtegida, (req, res) => {
  res.sendFile(path.join(pastaProjeto, "index.html"));
});

app.get("/index.html", paginaProtegida, (req, res) => {
  res.sendFile(path.join(pastaProjeto, "index.html"));
});

["login.html", "style.css", "script.js"].forEach((nome) => {
  app.get(`/${nome}`, (req, res) => {
    res.sendFile(path.join(pastaProjeto, nome));
  });
});

// ==================================================
// 3. ESTRUTURA DO BANCO
// ==================================================
// As tabelas só são criadas se ainda não existirem.
// Se você migrar o banco antigo com "npm run migrar",
// as tabelas migradas são mantidas como estão.

const tabelasPermitidas = [
  "veiculos",
  "motoristas",
  "manutencoes",
  "abastecimentos",
  "multas"
];

// Data no mesmo formato que o SQLite usava (AAAA-MM-DD HH:MM:SS).
const AGORA_TEXTO =
  "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

// Colunas iguais às que o script.js envia e lê.
// motoristas vem antes de veiculos porque veiculos aponta para ela.
const ESQUEMA_PADRAO = `
  CREATE TABLE IF NOT EXISTS motoristas (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    nome TEXT NOT NULL,
    cpf TEXT,
    cnh TEXT,
    telefone TEXT,
    validade TEXT,
    status TEXT,
    criado_em TEXT DEFAULT ${AGORA_TEXTO}
  );

  CREATE TABLE IF NOT EXISTS veiculos (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    placa TEXT NOT NULL UNIQUE,
    marca TEXT,
    modelo TEXT,
    ano INTEGER,
    tipo TEXT,
    status TEXT,
    motorista_id INTEGER REFERENCES motoristas(id),
    criado_em TEXT DEFAULT ${AGORA_TEXTO}
  );

  CREATE TABLE IF NOT EXISTS manutencoes (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id),
    tipo TEXT,
    data TEXT,
    valor NUMERIC(12, 2),
    descricao TEXT,
    criado_em TEXT DEFAULT ${AGORA_TEXTO}
  );

  CREATE TABLE IF NOT EXISTS abastecimentos (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id),
    data TEXT,
    litros NUMERIC(10, 3),
    valor_litro NUMERIC(10, 3),
    valor_total NUMERIC(12, 2),
    km INTEGER,
    combustivel TEXT,
    posto TEXT,
    criado_em TEXT DEFAULT ${AGORA_TEXTO}
  );

  CREATE TABLE IF NOT EXISTS multas (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    veiculo_id INTEGER NOT NULL REFERENCES veiculos(id),
    motorista_id INTEGER REFERENCES motoristas(id),
    data TEXT,
    valor NUMERIC(12, 2),
    vencimento TEXT,
    descricao TEXT,
    status TEXT,
    criado_em TEXT DEFAULT ${AGORA_TEXTO}
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TEXT DEFAULT ${AGORA_TEXTO}
  );
`;

// Colunas que o site usa e que podem faltar num banco migrado.
const colunasExtras = [
  ["motoristas", "cpf", "TEXT"],
  ["abastecimentos", "combustivel", "TEXT"]
];

// Colunas de cada tabela, lidas do banco uma vez ao iniciar.
const colunasPorTabela = new Map();

async function carregarColunas() {
  const { rows } = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ANY($1)
    ORDER BY table_name, ordinal_position
  `, [tabelasPermitidas]);

  colunasPorTabela.clear();

  for (const tabela of tabelasPermitidas) {
    colunasPorTabela.set(tabela, []);
  }

  for (const linha of rows) {
    colunasPorTabela.get(linha.table_name).push(linha.column_name);
  }

  for (const tabela of tabelasPermitidas) {
    if (!colunasPorTabela.get(tabela).includes("id")) {
      throw new Error(`A tabela "${tabela}" precisa ter uma coluna "id".`);
    }
  }
}

async function garantirAdmin() {
  const { rows } = await pool.query(
    "SELECT COUNT(*) AS total FROM usuarios"
  );

  if (rows[0].total > 0) return;

  const usuario = String(process.env.ADMIN_USUARIO || "admin")
    .trim()
    .toLowerCase();

  let senha = process.env.ADMIN_SENHA;
  let senhaGerada = false;

  if (!senha) {
    senha = crypto.randomBytes(12).toString("base64url");
    senhaGerada = true;
  }

  const senhaHash = await bcrypt.hash(senha, CUSTO_BCRYPT);

  // ON CONFLICT evita erro se duas instâncias subirem ao mesmo tempo.
  const resultado = await pool.query(`
    INSERT INTO usuarios (usuario, senha_hash)
    VALUES ($1, $2)
    ON CONFLICT (usuario) DO NOTHING
  `, [usuario, senhaHash]);

  if (resultado.rowCount === 0) return;

  console.log("==================================");
  console.log(`Usuário administrador criado: ${usuario}`);

  if (senhaGerada) {
    console.log(`Senha gerada automaticamente: ${senha}`);
    console.log("Guarde essa senha: ela não será mostrada de novo.");
  } else {
    console.log("Senha: a definida em ADMIN_SENHA.");
  }

  console.log("==================================");
}

async function prepararBanco() {
  await pool.query(ESQUEMA_PADRAO);

  for (const [tabela, coluna, tipo] of colunasExtras) {
    await pool.query(
      `ALTER TABLE "${tabela}" ADD COLUMN IF NOT EXISTS "${coluna}" ${tipo}`
    );
  }

  await carregarColunas();
  await garantirAdmin();
}

// ==================================================
// 4. FUNÇÕES AUXILIARES
// ==================================================

// Erro causado pelo cliente: a mensagem pode ser mostrada na tela.
class ErroCliente extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

function nomeTabela(tipo) {
  if (!tabelasPermitidas.includes(tipo)) {
    throw new ErroCliente("Tipo de registro inválido.", 404);
  }

  return tipo;
}

function obterColunas(tabela) {
  return colunasPorTabela.get(tabela) || [];
}

function lerId(valor) {
  const id = Number(valor);

  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) {
    throw new ErroCliente("ID inválido.");
  }

  return id;
}

// Nomes alternativos: se o banco usa outro nome de coluna,
// o valor enviado pelo site é copiado para a coluna certa.

const apelidos = {
  abastecimentos: {
    km: ["quilometragem"],
    valor_total: ["valor", "total"],
    combustivel: ["tipo_combustivel"]
  },
  motoristas: {
    validade: ["validade_cnh", "cnh_validade"]
  },
  manutencoes: {
    valor: ["custo"]
  }
};

function aplicarApelidos(tabela, dadosRecebidos) {
  const colunas = obterColunas(tabela);
  const saida = { ...(dadosRecebidos || {}) };
  const mapa = apelidos[tabela] || {};

  for (const [chave, alternativas] of Object.entries(mapa)) {
    if (saida[chave] === undefined || colunas.includes(chave)) continue;

    const destino = alternativas.find((nome) => colunas.includes(nome));

    if (destino && saida[destino] === undefined) {
      saida[destino] = saida[chave];
    }
  }

  return saida;
}

function filtrarDados(tabela, dadosRecebidos) {
  const colunas = obterColunas(tabela);
  const dadosComApelidos = aplicarApelidos(tabela, dadosRecebidos);

  const ignorados = Object.keys(dadosComApelidos).filter(
    (chave) => !colunas.includes(chave)
  );

  if (ignorados.length > 0) {
    console.warn(
      `Aviso (${tabela}): campos ignorados por não existirem na tabela:`,
      ignorados.join(", ")
    );
  }

  const dados = {};

  for (const [chave, valor] of Object.entries(dadosComApelidos)) {
    if (!colunas.includes(chave) || valor === undefined) continue;

    // O SQLite aceitava "" em colunas numéricas; o Postgres não.
    // Campo vazio vira NULL.
    let final = valor === "" ? null : valor;

    // O site manda Number("") = 0 quando nenhum veículo é escolhido.
    // Nenhum id válido é 0, então isso também vira NULL.
    if (chave.endsWith("_id") && (final === 0 || final === "0")) {
      final = null;
    }

    dados[chave] = final;
  }

  // O identificador é sempre gerado pelo banco.
  delete dados.id;

  return dados;
}

function erroServidor(res, erro) {
  if (erro instanceof ErroCliente) {
    return res.status(erro.status).json({ erro: erro.message });
  }

  // Códigos de erro do Postgres:
  // https://www.postgresql.org/docs/current/errcodes-appendix.html
  switch (erro.code) {
    case "23505":
      return res.status(409).json({
        erro: "Já existe um registro com esses dados."
      });

    case "23503":
      return res.status(400).json({
        erro: "O registro está relacionado a outro cadastro."
      });

    case "23502":
      return res.status(400).json({
        erro: `Falta preencher um campo obrigatório: ${erro.column}`
      });

    case "22P02": // texto onde deveria ser número
    case "22003": // número grande demais
    case "22007": // data inválida
    case "22008":
      return res.status(400).json({
        erro: "Algum campo foi preenchido em formato inválido."
      });
  }

  console.error("Erro na API:", erro);

  return res.status(500).json({
    erro: "Erro interno ao processar a solicitação."
  });
}

// ==================================================
// 5. LOGIN
// ==================================================

// Hash falso: faz o tempo de resposta ser igual para
// usuário existente e inexistente.
const HASH_FALSO = bcrypt.hashSync("senha-falsa", CUSTO_BCRYPT);

app.post("/api/login", async (req, res) => {
  try {
    const usuario = String(req.body?.usuario || "").trim().toLowerCase();
    const senha = String(req.body?.senha || "");

    const { rows } = await pool.query(
      "SELECT id, usuario, senha_hash FROM usuarios WHERE usuario = $1",
      [usuario]
    );

    const encontrado = rows[0];

    const senhaCorreta = await bcrypt.compare(
      senha,
      encontrado ? encontrado.senha_hash : HASH_FALSO
    );

    if (!encontrado || !senhaCorreta) {
      return res.status(401).json({ erro: "Login ou senha incorretos." });
    }

    // regenerate cria uma sessão nova a cada login
    req.session.regenerate((erro) => {
      if (erro) {
        console.error("Erro ao criar sessão:", erro);
        return res.status(500).json({
          erro: "Não foi possível iniciar a sessão."
        });
      }

      req.session.usuario = { id: encontrado.id, nome: encontrado.usuario };
      res.json({ usuario: encontrado.usuario });
    });
  } catch (erro) {
    erroServidor(res, erro);
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("fleetcontrol.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: EM_PRODUCAO
    });
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.usuario) {
    return res.status(401).json({ erro: "Não autenticado." });
  }

  res.json({ usuario: req.session.usuario.nome });
});

// Tudo que vier depois destas rotas em /api exige login.
app.use("/api", (req, res, next) => {
  if (req.session.usuario) return next();

  res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
});

// ==================================================
// 6. STATUS E DIAGNÓSTICO
// ==================================================

app.get("/api/status", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT current_database() AS banco");

    res.json({
      servidor: "FleetControl",
      funcionando: true,
      banco: rows[0].banco
    });
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// Mostra as colunas reais de cada tabela (útil para conferir).
app.get("/api/esquema", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT table_name, column_name, data_type,
             is_nullable, column_default, is_identity
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1)
      ORDER BY table_name, ordinal_position
    `, [tabelasPermitidas]);

    const esquema = {};

    for (const tabela of tabelasPermitidas) {
      esquema[tabela] = rows
        .filter((c) => c.table_name === tabela)
        .map((c) => ({
          coluna: c.column_name,
          tipo: c.data_type,
          obrigatoria:
            c.is_nullable === "NO" &&
            c.column_default === null &&
            c.is_identity !== "YES"
        }));
    }

    res.json(esquema);
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 7. LISTAR REGISTROS
// ==================================================

app.get("/api/:tipo", async (req, res) => {
  try {
    const tabela = nomeTabela(req.params.tipo);

    const { rows } = await pool.query(
      `SELECT * FROM "${tabela}" ORDER BY id DESC`
    );

    res.json(rows);
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 8. CADASTRAR REGISTROS
// ==================================================

app.post("/api/:tipo", async (req, res) => {
  try {
    const tabela = nomeTabela(req.params.tipo);
    const dados = filtrarDados(tabela, req.body);
    const colunas = Object.keys(dados);

    if (colunas.length === 0) {
      return res.status(400).json({
        erro: "Nenhum campo válido foi enviado."
      });
    }

    const nomesColunas = colunas
      .map((coluna) => `"${coluna}"`)
      .join(", ");

    const placeholders = colunas.map((_, i) => `$${i + 1}`).join(", ");

    const { rows } = await pool.query(
      `INSERT INTO "${tabela}" (${nomesColunas})
       VALUES (${placeholders})
       RETURNING *`,
      colunas.map((coluna) => dados[coluna])
    );

    return res.status(201).json(rows[0]);
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 9. ATUALIZAR REGISTROS
// ==================================================

app.put("/api/:tipo/:id", async (req, res) => {
  try {
    const tabela = nomeTabela(req.params.tipo);
    const id = lerId(req.params.id);
    const dados = filtrarDados(tabela, req.body);
    const colunas = Object.keys(dados);

    if (colunas.length === 0) {
      return res.status(400).json({
        erro: "Nenhum campo válido foi enviado para atualização."
      });
    }

    const atribuicoes = colunas
      .map((coluna, i) => `"${coluna}" = $${i + 1}`)
      .join(", ");

    const { rows } = await pool.query(
      `UPDATE "${tabela}"
       SET ${atribuicoes}
       WHERE id = $${colunas.length + 1}
       RETURNING *`,
      [...colunas.map((coluna) => dados[coluna]), id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ erro: "Registro não encontrado." });
    }

    return res.json(rows[0]);
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 10. EXCLUIR REGISTROS
// ==================================================

app.delete("/api/:tipo/:id", async (req, res) => {
  try {
    const tabela = nomeTabela(req.params.tipo);
    const id = lerId(req.params.id);

    const resultado = await pool.query(
      `DELETE FROM "${tabela}" WHERE id = $1`,
      [id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ erro: "Registro não encontrado." });
    }

    return res.json({ mensagem: "Registro excluído com sucesso." });
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 11. TRATAMENTO DE ERROS E ROTAS NÃO ENCONTRADAS
// ==================================================

app.use("/api", (req, res) => {
  res.status(404).json({
    erro: `Rota da API não encontrada: ${req.method} ${req.originalUrl}`
  });
});

app.use((erro, req, res, next) => {
  console.error("Erro no servidor:", erro);

  if (res.headersSent) {
    return next(erro);
  }

  res.status(500).json({
    erro: "Ocorreu um erro no servidor."
  });
});

// ==================================================
// 12. INICIAR O SERVIDOR
// ==================================================

let servidor;

prepararBanco()
  .then(() => {
    servidor = app.listen(PORT, () => {
      console.log("==================================");
      console.log("FleetControl iniciado!");
      console.log(`Porta: ${PORT}`);
      console.log(`Site: ${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/`);
      console.log("Banco: Postgres (DATABASE_URL)");
      console.log("==================================");
    });

    servidor.on("error", (erro) => {
      if (erro.code === "EADDRINUSE") {
        console.error(
          `A porta ${PORT} já está em uso. Feche o servidor antigo e rode de novo.`
        );
        process.exit(1);
      }

      throw erro;
    });
  })
  .catch((erro) => {
    console.error("Não foi possível preparar o banco de dados:", erro);
    pool.end().finally(() => process.exit(1));
  });

function encerrarServidor() {
  const fecharBanco = () => pool.end().finally(() => process.exit(0));

  if (servidor) {
    servidor.close(fecharBanco);
  } else {
    fecharBanco();
  }
}

process.on("SIGINT", encerrarServidor);
process.on("SIGTERM", encerrarServidor);