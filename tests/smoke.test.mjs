import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const sw = readFileSync(join(root, "sw.js"), "utf8");
const scripts = ["admin.js", "team.js", "app.js", "organizer.js", "features.js", "deadline-calc.js", "sw.js"];

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

test("arquivos JavaScript têm sintaxe válida", () => {
  for (const file of scripts) {
    const result = spawnSync(process.execPath, ["--check", join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test("IDs da página são únicos", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test("scripts locais referenciados existem", () => {
  const sources = [...html.matchAll(/<script[^>]+src="(\.\/[^"?]+)(?:\?[^\"]*)?"/g)].map((match) => match[1]);
  for (const source of sources) assert.ok(existsSync(join(root, source)), `Arquivo ausente: ${source}`);
});

test("versão do cache combina com os arquivos da página", () => {
  const version = sw.match(/const ASSET_VERSION = "(\d+)"/)?.[1];
  assert.ok(version, "ASSET_VERSION não encontrado");
  const localAssets = [...html.matchAll(/(?:src|href)="\.\/[^"?]+\?v=(\d+)"/g)].map((match) => match[1]);
  assert.ok(localAssets.length > 0, "Nenhum ativo versionado encontrado");
  assert.deepEqual([...new Set(localAssets)], [version]);
});

test("campos de busca possuem nome acessível", () => {
  const searchFields = [...html.matchAll(/<input\b[^>]*type="search"[^>]*>/g)].map((match) => match[0]);
  assert.ok(searchFields.length > 0);
  for (const tag of searchFields) {
    const attrs = attributes(tag);
    assert.ok(attrs["aria-label"] || attrs["aria-labelledby"], `Busca sem rótulo: ${attrs.id || tag}`);
  }
});

test("diálogos apontam para um título existente", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const dialogs = [...html.matchAll(/<dialog\b[^>]*>/g)].map((match) => attributes(match[0]));
  for (const dialog of dialogs) {
    assert.ok(dialog["aria-labelledby"], `Diálogo sem aria-labelledby: ${dialog.id}`);
    assert.ok(ids.has(dialog["aria-labelledby"]), `Título ausente no diálogo ${dialog.id}`);
  }
});

test("seletores de ID literais apontam para elementos existentes", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  for (const file of scripts.filter((name) => name !== "sw.js")) {
    const source = readFileSync(join(root, file), "utf8");
    const references = [...source.matchAll(/\$\(\s*["']#([A-Za-z][\w:-]*)["']/g)].map((match) => match[1]);
    const missing = [...new Set(references.filter((id) => !ids.has(id)))];
    assert.deepEqual(missing, [], `${file} referencia IDs inexistentes`);
  }
});
