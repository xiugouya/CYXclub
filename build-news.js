// CYX俱乐部 - 生成含内置公告数据的 news.html
// 用法: node build-news.js
// 需要 Node.js 18+

const fs = require('fs');
const path = require('path');

const API = 'https://cyxclub-api.3604596288.workers.dev/api/announcements?count=50';
const OUTPUT = path.join(__dirname, 'news.html');

async function build() {
    console.log('正在从 API 获取公告...');
    let news = [];
    try {
        const res = await fetch(API);
        const json = await res.json();
        news = json.data || [];
    } catch (e) {
        console.error('API 请求失败:', e.message);
        process.exit(1);
    }

    if (!news.length) {
        console.error('没有获取到公告数据');
        process.exit(1);
    }

    console.log(`获取到 ${news.length} 条公告`);
    console.log('正在读取模板...');
    let html = fs.readFileSync(OUTPUT, 'utf8');

    // 生成干净的 JS 数组字面量
    const newsItems = news.map(item => `{
        title: ${JSON.stringify(item.title)},
        date: ${JSON.stringify(item.date)},
        summary: ${JSON.stringify(item.summary || '')},
        category: ${JSON.stringify(item.category)},
        url: ${JSON.stringify(item.url || '#')},
        source: ${JSON.stringify(item.source || 'CYX俱乐部')}
    }`).join(',\n        ');

    const newsArray = `[\n        ${newsItems}\n    ]`;

    // 替换 DEFAULT_NEWS 为真实数据
    html = html.replace(
        /\/\/ 内嵌默认公告[\s\S]*?^\s*\];/m,
        `// 内嵌公告数据（构建时从 API 获取）\n        const INJECTED_NEWS = ${newsArray};`
    );

    // 替换 loadNews，不再发 fetch，直接用内嵌数据
    html = html.replace(
        /async function loadNews\(\)[\s\S]*?loadNews\(\);/m,
        `// 公告已内嵌，直接渲染\n        function loadNews() {\n            renderNews(INJECTED_NEWS);\n        }\n        loadNews();`
    );

    fs.writeFileSync(OUTPUT, html, 'utf8');
    console.log('✅ 已生成含公告数据的 news.html，共 ' + news.length + ' 条');
}

build().catch(e => { console.error(e); process.exit(1); });
