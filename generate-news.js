// 生成修复后的 news.html（内嵌公告数据 + 移除 fetch 调用）
const fs = require('fs');
const path = require('path');

// 公告数据（从 API 同步，去重）
const INJECTED_NEWS = [
    {
        title: 'CYX俱乐部正式上线运营',
        date: '2025-01-01',
        summary: 'CYX俱乐部正式上线运营，支持多款热门游戏，专业团队为您服务。',
        category: 'announce',
        url: '#',
        source: 'CYX俱乐部'
    },
    {
        title: '新春限时优惠活动开启',
        date: '2025-01-20',
        summary: '春节期间推出托管月卡限时折扣，至尊月托立减30元，优惠不容错过！',
        category: 'activity',
        url: '#',
        source: 'CYX俱乐部'
    },
    {
        title: '网站全新改版上线',
        date: '2025-02-15',
        summary: '官网全新升级改版，优化用户体验，服务项目一目了然，下单更便捷。',
        category: 'maintain',
        url: '#',
        source: 'CYX俱乐部'
    },
    {
        title: '新增支持游戏：王者荣耀、无畏契约',
        date: '2025-03-01',
        summary: '应广大玩家需求，现新增王者荣耀代练及无畏契约上分服务，欢迎咨询客服。',
        category: 'announce',
        url: '#',
        source: 'CYX俱乐部'
    },
    {
        title: '五一劳动节福利放送',
        date: '2025-04-25',
        summary: '五一假期托管88折，代练满100减15，优惠不容错过。',
        category: 'activity',
        url: '#',
        source: 'CYX俱乐部'
    }
];

const newsItems = INJECTED_NEWS.map(item => `{
        title: ${JSON.stringify(item.title)},
        date: ${JSON.stringify(item.date)},
        summary: ${JSON.stringify(item.summary)},
        category: ${JSON.stringify(item.category)},
        url: ${JSON.stringify(item.url)},
        source: ${JSON.stringify(item.source)}
    }`).join(',\n');

const CATEGORY_MAP_STR = JSON.stringify({
    announce: '官方公告',
    activity: '活动快报',
    maintain: '网站维护'
}, null, 4).replace(/\n/g, '\n    ');

const scriptContent = `
    <script>
        const INJECTED_NEWS = [
        ${newsItems}
        ];

        const CATEGORY_MAP = ${CATEGORY_MAP_STR};

        function buildArticleHTML(item) {
            const linkHTML = item.url && item.url !== '#'
                ? \`<a href="\${item.url}" target="_blank" class="news-link">查看原文 <i class="fas fa-external-link-alt"></i></a>\`
                : '';
            const sourceText = item.source || 'CYX俱乐部';
            return \`
                <article class="news-item">
                    <div class="news-item-header">
                        <h3>\${item.title}</h3>
                        <span class="news-date">\${item.date}</span>
                    </div>
                    <p>\${item.summary}</p>
                    <div class="news-item-footer">
                        <span class="news-source">\${sourceText}</span>
                        \${linkHTML}
                    </div>
                </article>\`;
        }

        function groupByCategory(news) {
            const groups = { announce: [], activity: [], maintain: [] };
            news.forEach(item => {
                const cat = item.category || 'announce';
                if (groups[cat]) groups[cat].push(item);
            });
            return groups;
        }

        function renderNews(news) {
            const allList = document.querySelector('[data-category="all"] .news-list');
            const grouped = groupByCategory(news);
            allList.innerHTML = news.map(buildArticleHTML).join('');
            Object.keys(grouped).forEach(cat => {
                const listEl = document.getElementById('list-' + cat);
                if (listEl) listEl.innerHTML = grouped[cat].map(buildArticleHTML).join('');
            });
            const counts = {
                all: news.length,
                announce: grouped.announce.length,
                activity: grouped.activity.length,
                maintain: grouped.maintain.length
            };
            document.querySelectorAll('.news-tab').forEach(tab => {
                const cat = tab.dataset.category;
                const countEl = tab.querySelector('.tab-count');
                if (countEl && counts[cat] !== undefined) countEl.textContent = counts[cat];
            });
            document.querySelectorAll('.news-item').forEach((el, i) => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(20px)';
                el.style.transition = 'opacity 0.5s ease ' + (i % 5) * 80 + 'ms, transform 0.5s ease ' + (i % 5) * 80 + 'ms';
                setTimeout(() => {
                    el.style.opacity = '1';
                    el.style.transform = 'translateY(0)';
                }, 50);
            });
        }

        // 分类切换
        document.querySelectorAll('.news-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const category = tab.dataset.category;
                document.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.news-category').forEach(cat => {
                    if (cat.dataset.category === 'all') {
                        cat.style.display = category === 'all' ? 'block' : 'none';
                    } else {
                        cat.style.display = cat.dataset.category === category ? 'block' : 'none';
                    }
                });
            });
        });

        // 直接使用内嵌数据，不再发 fetch 请求
        renderNews(INJECTED_NEWS);
    </script>
`;

// 生成 HTML 模板
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="CYX俱乐部官方公告列表，包括官方通知、活动快报及网站更新动态">
    <meta property="og:title" content="公告列表 - CYX俱乐部">
    <meta property="og:description" content="官方公告、活动快报、网站维护通知">
    <meta property="og:type" content="website">
    <title>公告列表 - CYX俱乐部</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        .news-page { padding-top: 100px; min-height: 100vh; }
        .back-home { display: inline-flex; align-items: center; gap: 8px; color: var(--primary-color); margin-bottom: 40px; font-weight: 500; transition: all 0.3s; font-size: 14px; }
        .back-home:hover { opacity: 0.8; gap: 12px; }
        .back-home i { transition: transform 0.3s; }
        .back-home:hover i { transform: translateX(-4px); }
        .news-tabs { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 50px; justify-content: center; }
        .news-tab { padding: 10px 24px; border-radius: 50px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-gray); font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1); display: flex; align-items: center; gap: 8px; }
        .news-tab i { font-size: 13px; transition: transform 0.3s; }
        .news-tab:hover { border-color: var(--primary-color); color: var(--primary-color); transform: translateY(-2px); }
        .news-tab.active { background: var(--primary-color); color: var(--dark-bg); border-color: var(--primary-color); font-weight: 700; box-shadow: 0 6px 25px rgba(249, 249, 0, 0.35); }
        .news-tab .tab-count { background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 20px; font-size: 12px; transition: background 0.3s; }
        .news-tab.active .tab-count { background: rgba(0,0,0,0.15); }
        .news-category { margin-bottom: 70px; }
        .news-category:last-child { margin-bottom: 0; }
        .category-header { display: flex; align-items: center; gap: 15px; margin-bottom: 30px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color); }
        .category-icon { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; }
        .category-icon.announce { background: linear-gradient(135deg, #667eea, #764ba2); }
        .category-icon.greeting { background: linear-gradient(135deg, #f39c12, #e67e22); }
        .category-icon.update { background: linear-gradient(135deg, #2ecc71, #27ae60); }
        .category-info h3 { font-size: 20px; color: var(--text-light); font-weight: 700; margin-bottom: 2px; }
        .category-info p { font-size: 13px; color: var(--text-gray); }
        .category-count { margin-left: auto; color: var(--primary-color); font-size: 28px; font-weight: 900; opacity: 0.5; }
        .news-list { display: flex; flex-direction: column; gap: 20px; }
        .news-item { background: var(--card-bg); border-radius: 18px; padding: 30px 35px; border: 1px solid var(--border-color); transition: all 0.4s cubic-bezier(0.22, 1, 0.36, 1); position: relative; overflow: hidden; cursor: pointer; }
        .news-item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--primary-color); transform: scaleY(0); transform-origin: bottom; transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1); }
        .news-item:hover { border-color: var(--primary-color); transform: translateX(6px); box-shadow: 0 12px 40px rgba(249, 249, 0, 0.1); }
        .news-item:hover::before { transform: scaleY(1); }
        .news-item-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
        .news-item h3 { font-size: 18px; color: var(--text-light); font-weight: 600; line-height: 1.5; flex: 1; transition: color 0.3s; }
        .news-item:hover h3 { color: var(--primary-color); }
        .news-item .news-date { font-size: 13px; color: var(--text-gray); white-space: nowrap; padding-top: 3px; }
        .news-item p { color: var(--text-gray); line-height: 1.75; font-size: 14px; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .news-item-footer { display: flex; align-items: center; justify-content: space-between; gap: 15px; }
        .news-item .news-source { font-size: 12px; color: var(--text-gray); font-style: italic; opacity: 0.7; }
        .news-item .news-link { color: var(--primary-color); font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; transition: all 0.3s; text-decoration: none; }
        .news-item .news-link:hover { gap: 12px; }
        .news-item .news-link i { font-size: 12px; transition: transform 0.3s; }
        .news-item .news-link:hover i { transform: translateX(3px); }
        .news-empty { text-align: center; padding: 80px 20px; color: var(--text-gray); }
        .news-empty i { font-size: 64px; margin-bottom: 20px; opacity: 0.3; }
        .news-empty p { font-size: 16px; }
        .news-item.expanded p { -webkit-line-clamp: unset; overflow: visible; }
        @media (max-width: 600px) { .news-item { padding: 20px; } .news-item-header { flex-direction: column; gap: 5px; } .category-count { display: none; } .news-tabs { gap: 8px; } .news-tab { padding: 8px 16px; font-size: 13px; } }
    </style>
</head>
<body>
    <header>
        <nav class="navbar">
            <div class="logo">
                <a href="index.html" class="logo-text">CYX</a>
                <span class="logo-sub">俱乐部</span>
            </div>
            <ul class="nav-links">
                <li><a href="index.html#home">首页</a></li>
                <li><a href="index.html#games">支持游戏</a></li>
                <li><a href="index.html#services">服务项目</a></li>
                <li><a href="services.html">套餐购买</a></li>
                <li><a href="news.html" class="active">公告列表</a></li>
                <li><a href="community.html">社区</a></li>
                <li><a href="index.html#contact">联系我们</a></li>
            </ul>
            <div class="hamburger"><span></span><span></span><span></span></div>
        </nav>
    </header>

    <section class="news-page section">
        <div class="container">
            <a href="index.html" class="back-home">
                <i class="fas fa-arrow-left"></i> 返回首页
            </a>
            <h2 class="section-title">公告列表</h2>
            <p class="section-subtitle">来自 CYX俱乐部官方微信公众号码</p>

            <div class="news-tabs">
                <button class="news-tab active" data-category="all"><i class="fas fa-border-all"></i>全部<span class="tab-count">5</span></button>
                <button class="news-tab" data-category="announce"><i class="fas fa-bullhorn"></i>官方公告<span class="tab-count">2</span></button>
                <button class="news-tab" data-category="activity"><i class="fas fa-bolt"></i>活动快报<span class="tab-count">2</span></button>
                <button class="news-tab" data-category="maintain"><i class="fas fa-wrench"></i>网站维护<span class="tab-count">1</span></button>
            </div>

            <div class="news-category" data-category="all">
                <div class="news-list" id="news-list-all"></div>
            </div>

            <div class="news-category" data-category="announce" style="display:none">
                <div class="category-header">
                    <div class="category-icon announce"><i class="fas fa-bullhorn"></i></div>
                    <div class="category-info"><h3>官方公告</h3><p>来自 CYX俱乐部官方的重要通知与声明</p></div>
                    <span class="category-count">02</span>
                </div>
                <div class="news-list" id="list-announce"></div>
            </div>

            <div class="news-category" data-category="activity" style="display:none">
                <div class="category-header">
                    <div class="category-icon greeting"><i class="fas fa-bolt"></i></div>
                    <div class="category-info"><h3>活动快报</h3><p>节日活动、限时福利与优惠资讯</p></div>
                    <span class="category-count">02</span>
                </div>
                <div class="news-list" id="list-activity"></div>
            </div>

            <div class="news-category" data-category="maintain" style="display:none">
                <div class="category-header">
                    <div class="category-icon update"><i class="fas fa-wrench"></i></div>
                    <div class="category-info"><h3>网站维护</h3><p>官网功能更新与版本动态记录</p></div>
                    <span class="category-count">01</span>
                </div>
                <div class="news-list" id="list-maintain"></div>
            </div>

            <div class="wechat-qr-notice" style="margin-top:30px;text-align:center;">
                <p><i class="fab fa-weixin"></i> 关注「CYX电竞」微信公众号，获取更多资讯</p>
            </div>
        </div>
    </section>

    <footer>
        <div class="container">
            <div class="footer-content">
                <div class="footer-logo"><span class="logo-text">CYX</span><span class="logo-sub">俱乐部</span></div>
                <p class="footer-desc">专业游戏代练托管平台</p>
                <p class="footer-copyright">© 2026 CYX俱乐部 All rights reserved.</p>
            </div>
        </div>
    </footer>

${scriptContent}
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'news.html'), html, 'utf8');
console.log('✅ news.html 生成成功，共 ' + INJECTED_NEWS.length + ' 条公告');
