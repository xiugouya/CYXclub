-- ============================================================
-- CYX俱乐部 Cloudflare D1 数据库结构
-- ============================================================

-- 公告表
CREATE TABLE IF NOT EXISTS announcements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'announce',
    date        TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'CYX俱乐部',
    url         TEXT NOT NULL DEFAULT 'news.html',
    sticky      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 计数器表
CREATE TABLE IF NOT EXISTS counter (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    count INTEGER NOT NULL DEFAULT 0,
    sessions TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

INSERT OR IGNORE INTO counter (id, count, sessions) VALUES (1, 0, '{}');

-- 可配置项表
CREATE TABLE IF NOT EXISTS config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'text',
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 管理员表
CREATE TABLE IF NOT EXISTS admins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 商品表
CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 卡密表（关联商品编号）
CREATE TABLE IF NOT EXISTS card_keys (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    card_key    TEXT NOT NULL UNIQUE,
    product_code TEXT,
    used         INTEGER NOT NULL DEFAULT 0,
    used_by     TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    used_at     TEXT
);

-- ============================================================
-- 注意：如果数据库已有 admins 表和数据，请手动更新密码：
-- UPDATE admins SET password = 'caea77217c7fb89f9431b3135336a4fea72a5b946801906f9afab05ed9da1828' WHERE username = 'admin';
-- ============================================================
-- 默认数据
-- ============================================================

-- 管理员: admin / CYXclub2026!
-- 密码 = SHA256('CYXclub2026!' + 'cyxclub_salt_2026')
-- 哈希: caea77217c7fb89f9431b3135336a4fea72a5b946801906f9afab05ed9da1828
INSERT OR IGNORE INTO admins (username, password) VALUES
    ('admin', 'caea77217c7fb89f9431b3135336a4fea72a5b946801906f9afab05ed9da1828');

-- 默认配置项
INSERT OR IGNORE INTO config (key, value, label, type) VALUES
    ('wechat',        'fwCYXclub',   '微信客服',      'text'),
    ('price_monthly', '68',          '托管月卡价格', 'number'),
    ('price_vip',     '168',         '至尊月托价格', 'number'),
    ('hours_weekday', '12:00-23:00', '工作日营业时间', 'text'),
    ('hours_weekend', '09:00-22:00', '周末营业时间',   'text'),
    ('announce_count','5',            '首页展示公告数', 'number');

-- 默认公告
INSERT OR IGNORE INTO announcements (title, content, summary, category, date, source, url, sticky) VALUES
    ('CYX俱乐部 正式上线运营',
     'CYX俱乐部专注于游戏代练托管服务，支持原神、崩铁、绝区零等多款热门游戏，专业团队为您保驾护航。',
     'CYX俱乐部正式上线运营，支持多款热门游戏，专业团队为您服务。',
     'announce', '2025-01-01', 'CYX俱乐部', 'news.html', 1);
