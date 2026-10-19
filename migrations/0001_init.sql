PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shop (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  recommended_id TEXT NOT NULL DEFAULT '',
  open INTEGER NOT NULL DEFAULT 1 CHECK (open IN (0, 1)),
  catalog_revision INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS beans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT '',
  variety TEXT NOT NULL DEFAULT '',
  roast TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  scales_json TEXT NOT NULL DEFAULT '[]',
  front TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  finish TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  english TEXT NOT NULL DEFAULT '',
  category_id TEXT NOT NULL,
  desc TEXT NOT NULL DEFAULT '',
  story TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT 'builtin:0',
  beans_json TEXT NOT NULL DEFAULT '[]',
  temps_json TEXT NOT NULL DEFAULT '[]',
  milks_json TEXT NOT NULL DEFAULT '[]',
  arts_json TEXT NOT NULL DEFAULT '[]',
  extra_label TEXT NOT NULL DEFAULT '',
  extra_options_json TEXT NOT NULL DEFAULT '[]',
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS ingredients (
  name TEXT PRIMARY KEY,
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY CHECK (id >= 0 AND id <= 999),
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  joined TEXT NOT NULL,
  prefs_json TEXT NOT NULL DEFAULT '{"temp":"","milk":"","art":""}'
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER,
  owner INTEGER NOT NULL DEFAULT 0 CHECK (owner IN (0, 1)),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  username_snapshot TEXT NOT NULL,
  product_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'making', 'done', 'cancelled')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  owner_note TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  UNIQUE (user_id, idempotency_key),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_created ON orders(status, created_at);

CREATE TABLE IF NOT EXISTS reviews (
  order_id TEXT PRIMARY KEY,
  stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
  tags_json TEXT NOT NULL DEFAULT '[]',
  text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  config_json TEXT NOT NULL,
  product_name TEXT NOT NULL,
  photo TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, product_id, config_json),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS favorites_user_created ON favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  blob BLOB NOT NULL,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO shop (id, name, message, recommended_id, open, catalog_revision)
VALUES (1, '杯序', '今天也有一杯，为你慢慢做。', 'latte', 1, 1);

INSERT OR IGNORE INTO categories (id, name, enabled, position) VALUES
  ('espresso', '意式咖啡', 1, 0),
  ('dirty', 'Dirty', 1, 1),
  ('pour', '手冲', 1, 2),
  ('special', '特调', 1, 3),
  ('cocktail', '调酒', 1, 4);

INSERT OR IGNORE INTO beans (id, name, origin, variety, roast, tags_json, scales_json, front, body, finish, note, available) VALUES
  ('blend', '意式拼配', '巴西 · 哥伦比亚', '卡杜艾 × 卡杜拉拼配', '中深烘焙', '["烤坚果","黑巧克力","焦糖"]', '[2,3,4]', '烤杏仁的温柔香气', '黑巧克力与焦糖的饱满甜感', '绵长、圆润的坚果余韵', '加上牛奶像一颗融化的太妃糖，今天最想请你喝这款。', 1),
  ('blue', '蓝山豆', '牙买加 · 蓝山产区', '铁皮卡', '中烘焙', '["可可","榛果","红糖"]', '[2,2,4]', '轻柔的可可香', '榛果与红糖的平衡口感', '干净柔和，甜感慢慢浮现', '适合慢慢喝，放凉一点也很舒服。', 1),
  ('geisha', '埃塞瑰夏', '埃塞俄比亚 · 瑰夏村', '瑰夏', '浅烘焙', '["茉莉","柑橘","蜂蜜"]', '[4,1,2]', '清新的白花香', '明亮的柑橘和蜂蜜甜感', '像一小口温柔的花茶', '这包已经喝完了，下次来再一起试试。', 0);

INSERT OR IGNORE INTO products (id, name, english, category_id, desc, story, photo, beans_json, temps_json, milks_json, arts_json, extra_label, extra_options_json, available) VALUES
  ('latte', '拿铁', 'Caffè Latte', 'espresso', '丝滑柔和，奶香饱满。', '浓缩与温热牛奶相遇，留下一口柔软的甜。熟悉的那一杯，也可以有今天的小心情。', 'builtin:0', '["blend","blue"]', '["热","冰"]', '["牛奶","燕麦奶"]', '["不指定","爱心","树叶","郁金香"]', '', '[]', 1),
  ('americano', '美式', 'Americano', 'espresso', '干净清爽，喝见咖啡本味。', '一份浓缩，一点水。让豆子的香气和风味清清楚楚地展开。', 'builtin:1', '["blend","blue"]', '["热","冰"]', '[]', '[]', '', '[]', 1),
  ('dirty', '经典 Dirty', 'Classic Dirty', 'dirty', '冷热交错，浓郁又顺滑。', '热浓缩缓缓落入冰冷的牛奶。先别搅拌，第一口的层次最有趣。', 'builtin:2', '["blend"]', '["冷饮"]', '["牛奶","燕麦奶"]', '[]', '', '[]', 1),
  ('pour', '手冲咖啡', 'Pour Over', 'pour', '花香与果韵，慢慢展开。', '一杯一点点冲出来的耐心。跟着温度变化，找找你喜欢的那一口。', 'builtin:3', '["blue","geisha"]', '["热","冰"]', '[]', '[]', '', '[]', 1);

INSERT OR IGNORE INTO ingredients (name, available) VALUES ('牛奶', 1), ('燕麦奶', 1);
