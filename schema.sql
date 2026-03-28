-- ============================================================
-- CYX俱乐部 Cloudflare D1 数据库结构 (v2 - 完整版)
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
-- 新增表
-- ============================================================

-- Session 表（Cookie 认证）
CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user', -- user, employee, admin
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 用户表（通过订单号+密码登录）
CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    order_number TEXT UNIQUE,
    product_code TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE INDEX IF NOT EXISTS idx_users_order_number ON users(order_number);

-- 员工/打手表
CREATE TABLE IF NOT EXISTS employees (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    game_types   TEXT, -- JSON array
    created_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 订单表
CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    game        TEXT NOT NULL,
    service_type TEXT NOT NULL,
    employee_id INTEGER NOT NULL,
    details     TEXT,
    status      TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, in_progress, completed, cancelled
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
);

-- ============================================================
-- 默认数据
-- ============================================================

-- 管理员: admin / CYXclub2026!
-- 密码 = SHA256('CYXclub2026!' + 'cyxclub_salt_2026')
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

-- 示例员工（密码: emp123456）
INSERT OR IGNORE INTO employees (username, password_hash, display_name, game_types) VALUES
    ('emp01', 'e8cf2e12da9f92b60f874a3b2f0e0b8d6d8a5d2e7b4c1a9f3e6d8b2c5a7f1e4d', '小明', '["原神","崩铁"]');
-- 注意：上面的密码哈希需要通过 API 重新生成，这里仅为占位
-- 请通过管理后台创建员工账号
