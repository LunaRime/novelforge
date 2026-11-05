// 章节存储原型：文件是真相，索引是可重建的派生
// 验证 6 个场景：创建 / 重排 / 外部改名 / 外部编辑 / 索引重建 / 崩溃残留
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : await fs.mkdtemp(path.join(os.tmpdir(), 'novelforge-prototype-'));
const DIR = path.join(ROOT, 'chapters');
const IDX = path.join(ROOT, '.index.json');

const pad = (n) => String(n).padStart(4, '0');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const now = () => new Date().toISOString();

// ---------- frontmatter ----------
function parse(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error('missing frontmatter');
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (v.startsWith('[')) v = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else if (/^\d+$/.test(v)) v = Number(v);
    meta[k] = v;
  }
  return { meta, body: m[2] };
}

function serialize(meta, body) {
  const kv = Object.entries(meta).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`);
  return `---\n${kv.join('\n')}\n---\n${body}`;
}

// ---------- 原子写 ----------
async function atomicWrite(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();               // 落盘，不靠 OS 缓存
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);      // 同目录 rename 是原子的
}

// ---------- 索引 ----------
async function readIndex() {
  try { return JSON.parse(await fs.readFile(IDX, 'utf8')); } catch { return {}; }
}
async function writeIndex(idx) { await atomicWrite(IDX, JSON.stringify(idx, null, 2)); }

async function rescan() {
  const idx = {};
  let names = [];
  try { names = await fs.readdir(DIR); } catch { names = []; }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(DIR, name);
    const text = await fs.readFile(file, 'utf8');
    const { meta, body } = parse(text);
    const st = await fs.stat(file);
    idx[meta.id] = {
      id: meta.id, path: `chapters/${name}`, number: Number(meta.number),
      title: String(meta.title), status: String(meta.status),
      wordCount: body.replace(/\s/g, '').length,
      hash: sha(text), mtime: Math.round(st.mtimeMs),
    };
  }
  await writeIndex(idx);
  return idx;
}

// ---------- 仓储 ----------
const fileName = (ch) => `${pad(ch.number)}.md`;

async function save(ch, body) {
  const file = path.join(DIR, fileName(ch));
  // 单进程原型：其它章节占用序号时必须拒绝。
  try {
    const existing = parse(await fs.readFile(file, 'utf8'));
    if (existing.meta.id !== ch.id) throw new Error('chapter path occupied: ' + file);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const meta = {
    id: ch.id, number: ch.number, title: ch.title, status: ch.status,
    createdAt: ch.createdAt, updatedAt: now(),
    contentHash: sha(body).slice(0, 16),
  };
  const text = serialize(meta, body);

  // 旧版本快照（保留最近 N 个由上层策略决定，这里先落盘）
  const histDir = path.join(ROOT, 'history', ch.id);
  await fs.mkdir(histDir, { recursive: true });
  try {
    const old = await fs.readFile(file, 'utf8');
    await atomicWrite(path.join(histDir, `${Date.now()}.md`), old);
  } catch { /* 新章节没有历史 */ }

  await fs.mkdir(DIR, { recursive: true });
  await atomicWrite(file, text);

  const idx = await readIndex();
  const st = await fs.stat(file);
  idx[ch.id] = {
    id: ch.id, path: `chapters/${fileName(ch)}`, number: ch.number, title: ch.title,
    status: ch.status, wordCount: body.replace(/\s/g, '').length,
    hash: sha(text), mtime: Math.round(st.mtimeMs),
  };
  await writeIndex(idx);
  return idx[ch.id];
}

async function byId(id) {
  const idx = await readIndex();
  const entry = idx[id];
  if (!entry) return null;
  let text;
  try { text = await fs.readFile(path.join(ROOT, entry.path), 'utf8'); }
  catch { return { stale: true, id, reason: 'file-missing' }; }

  const h = sha(text);
  if (h !== entry.hash) {
    // 索引过期（外部编辑）：重读文件，回写索引
    const { meta, body } = parse(text);
    const st = await fs.stat(path.join(ROOT, entry.path));
    idx[id] = { ...entry, hash: h, mtime: Math.round(st.mtimeMs),
      title: String(meta.title), status: String(meta.status),
      wordCount: body.replace(/\s/g, '').length };
    await writeIndex(idx);
    return { ...idx[id], reloadedFromDisk: true };
  }
  return entry;
}

// ---------- 场景验证 ----------
const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); };

async function main() {
  try {
    if ((await fs.readdir(ROOT)).length) throw new Error('refuse non-empty directory: ' + ROOT);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(DIR, { recursive: true });

  // 1. 创建
  const ch1 = { id: 'ch_7f3a9b21', number: 1, title: '雨夜', status: 'draft', createdAt: now() };
  const ch2 = { id: 'ch_b21c40de', number: 2, title: '旧书店', status: 'draft', createdAt: now() };
  await save(ch1, '第一章正文……');
  await save(ch2, '第二章正文……');
  const files = (await fs.readdir(DIR)).sort();
  ok('1 创建：文件名只含序号', files.join(',') === '0001.md,0002.md', files.join(','));
  const back = await byId('ch_7f3a9b21');
  ok('1 创建：按 id 可读回', back && back.title === '雨夜', JSON.stringify(back));

  try {
    await save({ ...ch2, id: 'ch_other' }, '不应覆盖');
    ok('序号冲突：拒绝覆盖', false);
  } catch {
    ok('序号冲突：拒绝覆盖', (await byId(ch2.id))?.id === ch2.id);
  }

  // 2. 重排章号（id 不变）
  ch1.number = 3;
  await save(ch1, '第一章正文……');
  await fs.rm(path.join(DIR, '0001.md'));
  const afterRenumber = await byId('ch_7f3a9b21');
  ok('2 重排：id 稳定，路径已更新', afterRenumber && afterRenumber.number === 3
    && afterRenumber.path === 'chapters/0003.md', JSON.stringify(afterRenumber?.path));

  // 3. 外部改名（用户手动改文件名）
  await fs.rename(path.join(DIR, '0002.md'), path.join(DIR, '0002-renamed.md'));
  const orphan = await byId('ch_b21c40de');
  ok('3 外部改名：索引路径失效可被发现', orphan && orphan.stale === true, JSON.stringify(orphan));

  const rebuilt = await rescan();
  const found = rebuilt['ch_b21c40de'];
  ok('3 外部改名：rescan 后 id 仍能定位', found && found.path === 'chapters/0002-renamed.md',
    JSON.stringify(found?.path));

  // 4. 外部编辑内容（不动文件名）
  const target = path.join(DIR, '0002-renamed.md');
  const text = await fs.readFile(target, 'utf8');
  await fs.writeFile(target, text.replace('第二章正文', '第二章正文（外部改过）'), 'utf8');
  const reloaded = await byId('ch_b21c40de');
  ok('4 外部编辑：hash 不一致→自动重载', reloaded && reloaded.reloadedFromDisk === true,
    JSON.stringify(reloaded?.reloadedFromDisk));

  // 5. 删掉索引，重建
  await fs.rm(IDX, { force: true });
  const empty = await readIndex();
  ok('5 索引删除：读为空', Object.keys(empty).length === 0);
  const rebuilt2 = await rescan();
  ok('5 索引重建：两章都在', Object.keys(rebuilt2).length === 2, Object.keys(rebuilt2).join(','));

  // 6. 崩溃残留（.tmp 未 rename）
  await fs.writeFile(path.join(DIR, '0004-半截.md.999.tmp'), '写到一半', 'utf8');
  const before = Object.keys(await rescan()).length;
  const leftovers = (await fs.readdir(DIR)).filter((n) => n.endsWith('.tmp'));
  ok('6 崩溃残留：.tmp 不算正式章节', before === 2 && leftovers.length === 1,
    `chapters=${before}, tmp=${leftovers.length}`);

  // 7. 删掉整个索引 + 用旧版兼容：内容不丢
  const bodyOfCh1 = parse(await fs.readFile(path.join(DIR, '0003.md'), 'utf8')).body;
  ok('7 真相在文件：正文可独立读出', bodyOfCh1.includes('第一章正文'));

  console.log('\n场景验证：');
  for (const r of results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} 通过\n`);

  console.log('原型产物（保留供检查）：' + ROOT);
  console.log('产物结构：');
  const walk = async (d, p = '') => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const rel = path.join(p, e.name);
      if (e.isDirectory()) await walk(path.join(d, e.name), rel);
      else console.log(`  ${rel}`);
    }
  };
  await walk(ROOT);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
