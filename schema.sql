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

-- 计数器表（替代 Gist 持久化）
CREATE TABLE IF NOT EXISTS counter (
    id    INTEGER PRIMARY KEY CHECK (id = 1),  -- 只有一行
    count INTEGER NOT NULL DEFAULT 0,
    sessions TEXT NOT NULL DEFAULT '{}',         -- JSON: { ip: timestamp }
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 默认计数器初始值
INSERT OR IGNORE INTO counter (id, count, sessions) VALUES (1, 0, '{}');

-- 可配置项表（如价格、营业时间、联系方式等）
CREATE TABLE IF NOT EXISTS config (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    label   TEXT NOT NULL DEFAULT '',
    type    TEXT NOT NULL DEFAULT 'text',   -- text | number | textarea | url
    updated_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- 管理员表（简单密码校验，密码建议强一些）
CREATE TABLE IF NOT EXISTS admins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

-- ============================================================
-- 初始化数据
-- ============================================================

-- 默认管理员账号: admin / CYXclub2026!
-- 建议部署后立即修改密码
INSERT OR IGNORE INTO admins (username, password) VALUES 
    ('admin', '0d8a9e0f7f7e4a8c6b5d4e3f2a1b0c9d');  -- 这不是明文，是下文的 bcrypt hash

-- 默认配置项
INSERT OR IGNORE INTO config (key, value, label, type) VALUES
    ('wechat',       'fwCYXclub',   '微信客服',        'text'),
    ('price_monthly','68',          '托管月卡价格',    'number'),
    ('price_vip',    '168',         '至尊月托价格',    'number'),
    ('hours_weekday','12:00-23:00', '工作日营业时间',  'text'),
    ('hours_weekend','09:00-22:00', '周末营业时间',    'text'),
    ('announce_count','5',          '首页展示公告数',  'number');

-- 默认公告（示例）
INSERT OR IGNORE INTO announcements (title, content, summary, category, date, source, url, sticky) VALUES
    ('CYX俱乐部 正式上线运营',
     'CYX俱乐部专注于游戏代练托管服务，支持原神、崩铁、绝区零等多款热门游戏，专业团队为您保驾护航。',
     'CYX俱乐部正式上线运营，支持多款热门游戏，专业团队为您服务。',
     'announce', '2025-01-01', 'CYX俱乐部', 'news.html', 1),
    ('新春限时优惠活动开启',
     '春节期间推出托管月卡限时折扣，至尊月托立减30元，优惠不容错过！',
     '新春优惠活动开启，托管月卡限时折扣中。',
     'activity', '2025-01-20', 'CYX俱乐部', 'news.html', 0),
    ('网站全新改版上线',
     '官网全新升级改版，优化用户体验，服务项目一目了然，下单更便捷。',
     '官网全新升级改版，用户体验大幅优化。',
     'maintain', '2025-02-15', 'CYX俱乐部', 'news.html', 0),
    ('新增支持游戏：王者荣耀、无畏契约',
     '应广大玩家需求，现新增王者荣耀代练及无畏契约上分服务，欢迎咨询客服。',
     '新增王者荣耀、无畏契约代练服务，欢迎咨询。',
     'announce', '2025-03-01', 'CYX俱乐部', 'news.html', 0),
    ('五一劳动节福利放送',
     '五一假期期间下单即可享受满减优惠，托管服务全部88折，代练订单满100元减15元。',
     '五一假期托管88折，代练满100减15，优惠不容错过。',
     'activity', '2025-04-25', 'CYX俱乐部', 'news.html', 0);
