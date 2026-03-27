-- 卡密表迁移（如果数据库已存在，执行此文件添加卡密表）
CREATE TABLE IF NOT EXISTS card_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_key TEXT UNIQUE NOT NULL,
  used INTEGER DEFAULT 0,
  used_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME
);
