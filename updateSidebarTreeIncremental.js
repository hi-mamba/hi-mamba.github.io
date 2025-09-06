const fs = require("fs");
const path = require("path");

// ===== 可配置区域 =====
const NOTES_DIR = path.join(__dirname, "notes");
const SIDEBAR = path.join(NOTES_DIR, "_sidebar.md");
const ROOT_TITLE = "Happy-LLM";
const ROOT_LINK = "./README.md";
const INDENT = "    "; // 每层四个空格
const INCLUDE_EXTS = [".md", ".html"];
const EXCLUDE_NAMES = new Set(["_sidebar.md", ".DS_Store", "Thumbs.db"]);
// 根目录下的 README 已通过根锚点展示，这里避免重复加入到子项
const EXCLUDE_ROOT_FILES = new Set(["README.md", "readme.md"]);
// =====================

function escReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRel(p) {
    return "./" + path.relative(NOTES_DIR, p).replace(/\\/g, "/");
}

function listTree(dir, relDir = "") {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => !d.name.startsWith(".") && !EXCLUDE_NAMES.has(d.name));
    const dirs = [];
    const files = [];
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            dirs.push({ name: e.name, full, rel: path.posix.join(relDir, e.name) });
        } else if (e.isFile()) {
            const ext = path.extname(e.name);
            if (!INCLUDE_EXTS.includes(ext)) continue;
            if (!relDir && EXCLUDE_ROOT_FILES.has(e.name)) continue;
            files.push({
                name: path.basename(e.name, ext),
                full,
                rel: path.posix.join(relDir, e.name),
                ext
            });
        }
    }

    // 排序：目录优先，再文件；中文友好排序
    const collator = new Intl.Collator("zh");
    dirs.sort((a, b) => collator.compare(a.name, b.name));
    files.sort((a, b) => collator.compare(a.name, b.name));

    // 递归
    const children = dirs.map(d => ({
        type: "dir",
        name: d.name,
        path: d.rel, // 相对 notes 的目录路径（无 ./）
        children: listTree(path.join(dir, d.name), d.rel)
    }));

    const fileNodes = files.map(f => ({
        type: "file",
        name: f.name,
        path: f.rel // 相对 notes 的文件路径（无 ./）
    }));

    return [...children, ...fileNodes];
}

// 提取现有 _sidebar.md 中已存在的“链接路径”和“目录标题行”
function parseExisting(sidebarText) {
    const linkPathSet = new Set();
    const lines = sidebarText.split(/\r?\n/);

    // 提取形如 [text](./some/path) 的路径
    const linkRe = /\]\(([^)]+)\)/g;
    for (const line of lines) {
        let m;
        while ((m = linkRe.exec(line)) !== null) {
            // 保留原样路径（例如 ./a b/c.md）
            linkPathSet.add(m[1]);
        }
    }

    return { lines, linkPathSet };
}

// 找到根锚点行（- [Happy-LLM](./README.md)）及其子块末尾
function locateRootBlock(lines) {
    const rootLineRe = new RegExp("^\\s*-\\s*\\[" + escReg(ROOT_TITLE) + "\\]\\(" + escReg(ROOT_LINK) + "\\)\\s*$");
    let rootIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (rootLineRe.test(lines[i])) {
            rootIdx = i;
            break;
        }
    }
    if (rootIdx === -1) return { rootIdx: -1, insertAt: lines.length };

    // 根块的范围：从根行的下一行开始，直到遇到下一个“顶级项”（开头无空格且以“- ”起）的前一行
    let insertAt = lines.length;
    for (let i = rootIdx + 1; i < lines.length; i++) {
        const l = lines[i];
        const leadingSpaces = (l.match(/^\s*/) || [""])[0].length;
        const isTopLevelList = leadingSpaces === 0 && l.trimStart().startsWith("- ");
        if (isTopLevelList) {
            insertAt = i; // 在下一个顶级项之前插入
            break;
        }
    }
    return { rootIdx, insertAt };
}

function hasLink(existingLinkSet, relPathNoDotSlash) {
    // 现有集合中存的是形如 ./xxx 的路径
    const candidate = "./" + relPathNoDotSlash.replace(/\\/g, "/");
    return existingLinkSet.has(candidate);
}

function ensureDirHeadingPresent(lines, rootIdx, insertAt, dirPath) {
    // dirPath 形如 "深度学习" 或 "A/B"
    const depth = dirPath.split("/").length; // 深度=1 表示根下一级目录
    const dirName = dirPath.split("/").pop();
    const dirLine = INDENT.repeat(depth) + "- " + dirName;

    // 粗略检查：同缩进、同目录名的标题行是否已存在
    const dirRe = new RegExp("^" + escReg(INDENT.repeat(depth)) + "-\\s+" + escReg(dirName) + "\\s*$", "m");
    const text = lines.join("\n");
    if (dirRe.test(text)) return { lines, insertAt };

    // 插入位置：优先插到“父目录块”后面，否则就在根块末尾
    let targetIdx = insertAt;
    if (depth > 1) {
        const parentPath = dirPath.split("/").slice(0, -1).join("/");
        const parentDepth = depth - 1;
        const parentName = parentPath.split("/").pop();
        const parentRe = new RegExp("^" + escReg(INDENT.repeat(parentDepth)) + "-\\s+" + escReg(parentName) + "\\s*$", "m");

        // 找到父目录行索引
        let parentLineIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (parentRe.test(lines[i])) { parentLineIdx = i; break; }
        }
        if (parentLineIdx !== -1) {
            // 找到父目录块末尾（直到遇到缩进 <= 父目录缩进的下一条顶级/同级目录）
            const parentIndent = INDENT.repeat(parentDepth);
            let j = parentLineIdx + 1;
            while (j < lines.length) {
                const leading = (lines[j].match(/^\s*/) || [""])[0];
                if (leading.length <= parentIndent.length && lines[j].trim().startsWith("- ")) break;
                j++;
            }
            targetIdx = j;
        }
    }

    lines.splice(targetIdx, 0, dirLine);
    // 插入后，若目标位置小于原 insertAt，需要顺延
    if (targetIdx <= insertAt) insertAt++;
    return { lines, insertAt };
}

function run() {
    if (!fs.existsSync(NOTES_DIR)) {
        console.error("❌ notes 目录不存在：", NOTES_DIR);
        process.exit(1);
    }
    let sidebarText = fs.existsSync(SIDEBAR) ? fs.readFileSync(SIDEBAR, "utf-8") : `- [${ROOT_TITLE}](${ROOT_LINK})\n`;

    const { lines, linkPathSet } = parseExisting(sidebarText);
    let { rootIdx, insertAt } = locateRootBlock(lines);

    // 如果根锚点不存在，先补上
    if (rootIdx === -1) {
        lines.push(`- [${ROOT_TITLE}](${ROOT_LINK})`);
        rootIdx = lines.length - 1;
        insertAt = lines.length;
    }

    const tree = listTree(NOTES_DIR, "");
    const newLines = [];

    // 深度优先：目录→文件
    function walk(nodes, parentPath = "") {
        for (const n of nodes) {
            if (n.type === "dir") {
                // 确保目录标题行存在（缩进=目录深度 * INDENT）
                const ensured = ensureDirHeadingPresent(lines, rootIdx, insertAt, n.path);
                // 更新 lines 和 insertAt（目录行可能插入）
                // 但我们只用于检测目录是否已存在，不直接在此处插文件行
                insertAt = ensured.insertAt;
                // 继续下探
                walk(n.children, n.path);
            } else {
                // 文件：若不存在则在根块末尾或父目录块末尾追加
                if (!hasLink(linkPathSet, n.path)) {
                    const depth = n.path.includes("/") ? n.path.split("/").length : 0; // 文件深度：根下文件 depth=0
                    const parentDepth = n.path.includes("/") ? n.path.split("/").length - 1 : 0;

                    // 计算缩进：根下文件应作为“根锚点的子项”，故缩进=1层；
                    // 位于目录 A/B 下的文件，缩进=（目录深度+1）层
                    const fileIndentLevel = (parentPath ? parentPath.split("/").length : 0) + 1;
                    const indent = INDENT.repeat(fileIndentLevel);

                   // newLines.push(`${indent}- [${n.name}](${normalizeRel(path.join(NOTES_DIR, n.path))})`);
                    newLines.push(`${indent}- [${n.name}](${safeUrl(n.path)})`);
                    linkPathSet.add("./" + n.path);
                }
            }
        }
    }

    // 先确保所有需要的目录标题存在，再统一把缺失文件插入到“根块末尾”（或父块末尾）
    walk(tree);

    if (newLines.length === 0) {
        console.log("ℹ️ 没有需要追加的文件/目录。");
        return;
    }

    // 把所有新增文件行统一插到根块末尾（insertAt 位置）
    // 这样可以保证：根下文件缩进 1 层；目录下文件因 ensureDirHeadingPresent 已有对应目录行。
    lines.splice(insertAt, 0, ...newLines);

    fs.writeFileSync(SIDEBAR, lines.join("\n").replace(/\r?\n\s*$/,"") + "\n", "utf-8");
    console.log(`✅ _sidebar.md 已增量更新（新增 ${newLines.length} 条）`);
}

function safeUrl(relPath) {
    const norm = "./" + relPath.replace(/\\/g, "/");
    return norm.split("/").map((seg, i) => {
        if (i === 0 && seg === ".") return seg;
        // 只转义特殊字符，不转义中文
        return seg.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, ch => encodeURIComponent(ch));
    }).join("/");
}



run();
