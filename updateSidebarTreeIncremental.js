const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const NOTES_DIR = path.join(ROOT_DIR, "notes");
const INDEX_MD = path.join(ROOT_DIR, "index.md");
const ROOT_TITLE = "## table of contents";
const INDENT = "    ";
const INCLUDE_EXTS = [".md", ".html"];
const EXCLUDE_NAMES = new Set(["index.md", ".DS_Store", "Thumbs.db"]);

// URL 安全处理

function safeUrl(relPath) {
    // 强制以 ./notes/... 开头
    const norm = "./notes/" + path.posix.relative("", relPath).replace(/\\/g, "/").replace(/^notes\//, "");
    return norm.split("/").map((seg, i) => {
        if (i === 0 && seg === ".") return seg;
        return seg.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, ch => encodeURIComponent(ch));
    }).join("/");
}

// 遍历 notes 目录，生成树状结构
function listTree(dir, relDir = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => !d.name.startsWith(".") && !EXCLUDE_NAMES.has(d.name));
    const dirs = [], files = [];
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            dirs.push({ name: e.name, full, rel: path.posix.join(relDir, e.name) });
        } else if (e.isFile()) {
            const ext = path.extname(e.name);
            if (!INCLUDE_EXTS.includes(ext)) continue;
            files.push({ name: path.basename(e.name, ext), rel: path.posix.join(relDir, e.name) });
        }
    }

    const collator = new Intl.Collator("zh");
    dirs.sort((a, b) => collator.compare(a.name, b.name));
    files.sort((a, b) => collator.compare(a.name, b.name));

    const children = dirs.map(d => ({ type: "dir", name: d.name, path: d.rel, children: listTree(d.full, d.rel) }));
    const fileNodes = files.map(f => ({ type: "file", name: f.name, path: f.rel }));
    return [...children, ...fileNodes];
}

// 解析现有 Markdown 的链接
function parseLinks(mdText) {
    const lines = mdText.split(/\r?\n/);
    const linkSet = new Set();
    const linkRe = /\]\(([^)]+)\)/g;
    for (const line of lines) {
        let m;
        while ((m = linkRe.exec(line)) !== null) {
            linkSet.add(m[1]);
        }
    }
    return { lines, linkSet };
}

// 根据树状结构生成 Markdown
function generateMdLines(tree, parentPath = "", depth = 0) {
    const lines = [];
    for (const n of tree) {
        if (n.type === "dir") {
            lines.push(`${INDENT.repeat(depth)}- ${n.name}/`);
            lines.push(...generateMdLines(n.children, n.path, depth + 1));
        } else {
            lines.push(`${INDENT.repeat(depth)}- [${n.name}](${safeUrl(n.path)})`);
        }
    }
    return lines;
}

function run() {
    if (!fs.existsSync(NOTES_DIR)) {
        console.error("❌ notes 目录不存在：", NOTES_DIR);
        process.exit(1);
    }

    let mdText = fs.existsSync(INDEX_MD) ? fs.readFileSync(INDEX_MD, "utf-8") : ROOT_TITLE + "\n";
    const { lines, linkSet } = parseLinks(mdText);

    // 找到目录标题行
    let dirIdx = lines.findIndex(l => l.trim() === ROOT_TITLE.trim());
    if (dirIdx === -1) {
        lines.push(ROOT_TITLE);
        dirIdx = lines.length - 1;
    }

    const tree = listTree(NOTES_DIR);
    const newLines = generateMdLines(tree);

    // 过滤掉已存在的链接（增量更新）
    const filteredLines = newLines.filter(l => {
        const match = l.match(/\]\(([^)]+)\)/);
        if (match) {
            return !linkSet.has(match[1]);
        }
        return true; // 目录行
    });

    if (filteredLines.length === 0) {
        console.log("ℹ️ index.md 已经是最新，无需更新。");
        return;
    }

    // 插入到目录最后
    let insertAt = lines.length;
    lines.splice(insertAt, 0, ...filteredLines);

    fs.writeFileSync(INDEX_MD, lines.join("\n").replace(/\r?\n\s*$/, "") + "\n", "utf-8");
    console.log(`✅ index.md 已增量更新（新增 ${filteredLines.length} 条）`);
}

run();
