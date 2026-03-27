-- 迁移：为 card_keys 表添加 product_code 字段
-- 运行: npx wrangler d1 execute cyx-club-db --file=migration-cards.sql --remote
-- 或本地: npx wrangler d1 execute cyx-club-db --file=migration-cards.sql

ALTER TABLE card_keys ADD COLUMN product_code TEXT;

-- 同时确保 products 表存在（如果不存在则创建）
CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);
