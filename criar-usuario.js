"use strict";

const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const [, , usuario, senha] = process.argv;

if (!usuario || !senha) {
  console.log('Uso: node criar-usuario.js NOME "SENHA"');
  process.exit(1);
}

if (senha.length < 8) {
  console.log("A senha precisa ter pelo menos 8 caracteres.");
  process.exit(1);
}

const db = new Database(path.join(__dirname, "fleetcontrol.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

const hash = bcrypt.hashSync(senha, 12);

// Cria o usuário. Se já existir, troca a senha.
db.prepare(`
  INSERT INTO usuarios (usuario, senha_hash) VALUES (?, ?)
  ON CONFLICT(usuario) DO UPDATE SET senha_hash = excluded.senha_hash
`).run(usuario.trim().toLowerCase(), hash);

console.log(`Usuário "${usuario.trim().toLowerCase()}" salvo com sucesso.`);
db.close();