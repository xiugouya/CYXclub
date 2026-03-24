# CYX俱乐部 - 生成含内置公告数据的 news.html
# 用法: .\build-news.ps1
# 先安装依赖: npm i node-fetch

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const API = 'https://cyxclub-api.3604596288.workers.dev/api/announcements?count=50';
const TEMPLATE = path.join(__dirname, 'news.html');
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
    let html = fs.readFileSync(TEMPLATE, 'utf8');

    // 把 DEFAULT_NEWS 替换为真实数据
    const newsJSON = JSON.stringify(news, null, 4).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

    // 修改内嵌数据为真实数据，注释掉 fetch 调用
    html = html.replace(
        /\/\/ 内嵌默认公告[\s\S]*?^\s*\];/m,
        `// 内嵌公告数据（构建时从 API 获取）
        const INJECTED_NEWS = ${newsJSON};`
    );

    // 把 loadNews 函数改为直接使用注入数据，不再 fetch
    html = html.replace(
        /async function loadNews\(\)[\s\S]*?^        loadNews\(\);/m,
        `// 公告已内嵌，直接渲染
        function loadNews() {
            renderNews(INJECTED_NEWS);
        }
        loadNews();`
    );

    fs.writeFileSync(OUTPUT, html, 'utf8');
    console.log('已生成含公告数据的 news.html，共 ' + news.length + ' 条');
}

build().catch(e => { console.error(e); process.exit(1); });
