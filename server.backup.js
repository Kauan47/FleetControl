"use strict";

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = 3000;

// ==================================================
// 1. CONFIGURAÇÃO DO CORS
// ==================================================

const origensPermitidas = [
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

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

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1); // necessário atrás de hospedagem com HTTPS
}

app.use(session({
  name: "fleetcontrol.sid",
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000 // fica logado por 8 horas
  }
}));

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
// 3. CONEXÃO COM O BANCO SQLITE
// ==================================================

const caminhoBanco = path.join(__dirname, "fleetcontrol.db");

if (!fs.existsSync(caminhoBanco)) {
  console.error(
    "ATENÇÃO: fleetcontrol.db não foi encontrado em:",
    caminhoBanco
  );
  console.error(
    "Confira a localização do banco original antes de continuar."
  );
  process.exit(1);
}

const db = new Database(caminhoBanco);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ==================================================
// 4. CONFERÊNCIA DAS TABELAS EXISTENTES
// ==================================================

const tabelasPermitidas = [
  "veiculos",
  "motoristas",
  "manutencoes",
  "abastecimentos",
  "multas"
];

const tabelasExistentes = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
`).all().map((tabela) => tabela.name);

for (const tabela of tabelasPermitidas) {
  if (!tabelasExistentes.includes(tabela)) {
    console.error(`A tabela "${tabela}" não existe no banco atual.`);
    console.error(
      "O servidor foi interrompido para evitar alterações automáticas no banco."
    );
    db.close();
    process.exit(1);
  }
}

// ==================================================
// 5. FUNÇÕES AUXILIARES
// ==================================================

function nomeTabela(tipo) {
  if (!tabelasPermitidas.includes(tipo)) {
    throw new Error("Tipo de registro inválido.");
  }

  return tipo;
}

function obterColunas(tabela) {
  return db.prepare(`PRAGMA table_info("${tabela}")`)
    .all()
    .map((coluna) => coluna.name);
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

  return Object.fromEntries(
    Object.entries(dadosComApelidos).filter(
      ([chave, valor]) =>
        colunas.includes(chave) &&
        valor !== undefined
    )
  );
}

function erroServidor(res, erro) {
  console.error("Erro na API:", erro);

  if (String(erro.message).includes("UNIQUE constraint")) {
    return res.status(409).json({
      erro: "Já existe um registro com esses dados."
    });
  }

  if (String(erro.message).includes("FOREIGN KEY constraint")) {
    return res.status(400).json({
      erro: "O registro está relacionado a outro cadastro."
    });
  }

  if (String(erro.message).includes("NOT NULL constraint")) {
    return res.status(400).json({
      erro: "Falta preencher um campo obrigatório: " + erro.message
    });
  }

  return res.status(400).json({
    erro: erro.message || "Erro interno ao processar a solicitação."
  });
}

// ==================================================
// 5.1 OPCIONAL: CRIA COLUNAS QUE O SITE USA
// ==================================================

const colunasExtras = [
  ["motoristas", "cpf", "TEXT"],
  ["abastecimentos", "combustivel", "TEXT"]
];

for (const [tabela, coluna, tipo] of colunasExtras) {
  if (!obterColunas(tabela).includes(coluna)) {
    db.exec(`ALTER TABLE "${tabela}" ADD COLUMN "${coluna}" ${tipo}`);
    console.log(`Coluna criada: ${tabela}.${coluna}`);
  }
}

// ==================================================
// 5.2 LOGIN
// ==================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Hash falso: faz o tempo de resposta ser igual para
// usuário existente e inexistente.
const HASH_FALSO = bcrypt.hashSync("senha-falsa", 10);

app.post("/api/login", (req, res) => {
  const usuario = String(req.body?.usuario || "").trim().toLowerCase();
  const senha = String(req.body?.senha || "");

  const encontrado = db.prepare(
    "SELECT id, usuario, senha_hash FROM usuarios WHERE usuario = ?"
  ).get(usuario);

  const senhaCorreta = bcrypt.compareSync(
    senha,
    encontrado ? encontrado.senha_hash : HASH_FALSO
  );

  if (!encontrado || !senhaCorreta) {
    return res.status(401).json({ erro: "Login ou senha incorretos." });
  }

  // regenerate cria uma sessão nova a cada login
  req.session.regenerate((erro) => {
    if (erro) {
      return res.status(500).json({
        erro: "Não foi possível iniciar a sessão."
      });
    }

    req.session.usuario = { id: encontrado.id, nome: encontrado.usuario };
    res.json({ usuario: encontrado.usuario });
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("fleetcontrol.sid");
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

app.get("/api/status", (req, res) => {
  res.json({
    servidor: "FleetControl",
    funcionando: true,
    banco: path.basename(caminhoBanco)
  });
});

// Mostra as colunas reais de cada tabela (útil para conferir).
app.get("/api/esquema", (req, res) => {
  const esquema = {};

  for (const tabela of tabelasPermitidas) {
    esquema[tabela] = db.prepare(`PRAGMA table_info("${tabela}")`)
      .all()
      .map((c) => ({
        coluna: c.name,
        tipo: c.type,
        obrigatoria: c.notnull === 1 && c.dflt_value === null && c.pk === 0
      }));
  }

  res.json(esquema);
});

// ==================================================
// 7. LISTAR REGISTROS
// ==================================================

app.get("/api/:tipo", (req, res) => {
  try {
    const tabela = nomeTabela(req.params.tipo);

    const registros = db.prepare(
      `SELECT * FROM "${tabela}" ORDER BY id DESC`
    ).all();

    res.json(registros);
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 8. CADASTRAR REGISTROS
// ==================================================

app.post("/api/:tipo", (req, res) => {
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

    const placeholders = colunas.map(() => "?").join(", ");

    const sql = `
      INSERT INTO "${tabela}" (${nomesColunas})
      VALUES (${placeholders})
    `;

    const resultado = db.prepare(sql).run(
      colunas.map((coluna) => dados[coluna])
    );

    const registro = db.prepare(
      `SELECT * FROM "${tabela}" WHERE id = ?`
    ).get(resultado.lastInsertRowid);

    return res.status(201).json(registro);
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 9. ATUALIZAR REGISTROS
// ==================================================

app.put("/api/:tipo/:id", (req, res) => {
  try {
    const tabela = nomeTabela(req.params.tipo);
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ erro: "ID inválido." });
    }

    const dados = filtrarDados(tabela, req.body);

    // Não permitir alteração do identificador.
    delete dados.id;

    const colunas = Object.keys(dados);

    if (colunas.length === 0) {
      return res.status(400).json({
        erro: "Nenhum campo válido foi enviado para atualização."
      });
    }

    const atribuicoes = colunas
      .map((coluna) => `"${coluna}" = ?`)
      .join(", ");

    const resultado = db.prepare(`
      UPDATE "${tabela}"
      SET ${atribuicoes}
      WHERE id = ?
    `).run(
      [...colunas.map((coluna) => dados[coluna]), id]
    );

    if (resultado.changes === 0) {
      const existe = db.prepare(
        `SELECT id FROM "${tabela}" WHERE id = ?`
      ).get(id);

      if (!existe) {
        return res.status(404).json({ erro: "Registro não encontrado." });
      }
    }

    const registro = db.prepare(
      `SELECT * FROM "${tabela}" WHERE id = ?`
    ).get(id);

    return res.json(registro);
  } catch (erro) {
    erroServidor(res, erro);
  }
});

// ==================================================
// 10. EXCLUIR REGISTROS
// ==================================================

app.delete("/api/:tipo/:id", (req, res) => {
  try {
    const tabela = nomeTabela(req.params.tipo);
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ erro: "ID inválido." });
    }

    const resultado = db.prepare(
      `DELETE FROM "${tabela}" WHERE id = ?`
    ).run(id);

    if (resultado.changes === 0) {
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

const servidor = app.listen(PORT, () => {
  console.log("==================================");
  console.log("FleetControl iniciado!");
  console.log(`Site: http://localhost:${PORT}/`);
  console.log(`API: http://localhost:${PORT}/api/status`);
  console.log(`Banco: ${caminhoBanco}`);
  console.log("==================================");
});

servidor.on("error", (erro) => {
  if (erro.code === "EADDRINUSE") {
    console.error(
      `A porta ${PORT} já está em uso. Feche o servidor antigo ` +
      "(taskkill /F /IM node.exe) e rode de novo."
    );
    process.exit(1);
  }

  throw erro;
});

function encerrarServidor() {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", encerrarServidor);
process.on("SIGTERM", encerrarServidor);